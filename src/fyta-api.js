// -----------------------------------------------------------------------------
// HTTP client of the FYTA Public API (official documentation:
// https://fyta-io.notion.site/FYTA-Public-API-d2f4c30306f74504924c9a40402a3afd,
// base https://web.fyta.de/api). Read only, apart from the login:
//
//   POST auth/login        { email, password } -> { access_token, token_type:
//                          "Bearer", expires_in (seconds, 5184000 = 60 days in
//                          the documentation), refresh_token, scope }
//   GET  user-plant        { gardens: [...], plants: [...] }: every plant of
//                          the account with its statuses (no measured value)
//   GET  user-plant/{id}   { plant: {...} }: one plant, with its measurements,
//                          thresholds, sensor, hub, fertilisation and pictures
//   GET  <picture URL>     a picture of a plant (Bearer sent to fyta.de only)
//
// Errors seen live (2026-10-25) and in the reference library fyta_cli (MIT,
// used by Home Assistant):
//   - login with an unknown account: HTTP 404 {"statusCode":404,"error":"Not Found"};
//   - login with a wrong password (fyta_cli): HTTP 401 {"statusCode":401,
//     "error":"Unauthorized","errors":[{"message":"Could not authenticate user"}]};
//   - data with a well-formed but wrong Bearer: HTTP 403 {"Message":"User is
//     not authorized to access this resource with an explicit deny ..."};
//   - data with a malformed Bearer: HTTP 500 {"message":null}.
// The refresh token has no documented endpoint: like fyta_cli, a new login
// replaces an expired token.
//
// Pace: no documented quota. One request at a time, one second apart at
// least; a 429 (never seen) holds every request until its Retry-After (30 s
// to 1 h).
// -----------------------------------------------------------------------------

const BASE_URL = 'https://web.fyta.de/api';
const TIMEOUT_MS = 30000;
const SPACING_MS = 1000;
const MIN_PAUSE_MS = 30 * 1000;
const MAX_PAUSE_MS = 60 * 60 * 1000;
// A picture of a plant is shown by a widget: at most 300 KB decoded.
const MAX_IMAGE_BYTES = 300 * 1024;
// Renew a token one day before it expires.
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_SECONDS = 24 * 60 * 60;

/**
 * @description An error of the FYTA API.
 */
class FytaError extends Error {
  /**
   * @param {string} kind - `auth` (credentials refused), `token` (the
   * access token refused), `rate_limit`, `server`, `http`, `unreachable`,
   * `failed`.
   * @param {string} message - What went wrong (never a credential).
   * @param {object} [extra] - `{ status, code, endpoint, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'FytaError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description Whether a picture URL may receive the access token: https on
 * fyta.de only (the pictures could live on a CDN of another host).
 * @param {string} url - The URL.
 * @returns {boolean} True for an https fyta.de host.
 */
function isFytaHost(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'fyta.de' || hostname.endsWith('.fyta.de'));
  } catch {
    return false;
  }
}

/**
 * @description The type of an image from its first bytes.
 * @param {Buffer} bytes - The bytes.
 * @returns {string|null} `png`, `jpeg`, `webp`, or null.
 */
function imageType(bytes) {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * @description The FYTA client.
 * @param {object} options - Options.
 * @param {Function} options.getCredentials - `() => ({ email, password })`.
 * @param {Function} options.getToken - `() => ({ accessToken, expiresAt } | null)`, the token kept.
 * @param {Function} options.setToken - `(token | null) => void`, keep (or forget) a token.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {number} [options.spacingMs] - Minimum time between two requests.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} The client.
 */
function createFytaClient({
  getCredentials,
  getToken,
  setToken,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  spacingMs = SPACING_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let chain = Promise.resolve();
  let lastEnd = 0;
  let pausedUntil = 0;
  let requests = 0;
  let logins = 0;

  /**
   * @description Run a function in the queue: one request at a time, spaced.
   * @param {Function} run - `() => Promise`.
   * @returns {Promise<*>} Its result.
   */
  function queued(run) {
    const result = chain.then(async () => {
      const wait = lastEnd + spacingMs - now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await run();
      } finally {
        lastEnd = now();
      }
    });
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Send one HTTP request now.
   * @param {string} url - The URL.
   * @param {object} init - The fetch options.
   * @param {string} endpoint - A short name for the messages.
   * @returns {Promise<Response>} The response.
   */
  async function send(url, init, endpoint) {
    if (pausedUntil > now()) {
      throw new FytaError('rate_limit', 'FYTA asked to wait (429)', {
        endpoint,
        retryAfter: Math.ceil((pausedUntil - now()) / 1000),
      });
    }
    requests += 1;
    try {
      return await fetchFn(url, {
        ...init,
        headers: { 'user-agent': userAgent, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new FytaError('unreachable', `FYTA unreachable: ${err.message}`, { endpoint });
    }
  }

  /**
   * @description Read a JSON body; null when it is not JSON.
   * @param {Response} response - The response.
   * @returns {Promise<object|null>} The body.
   */
  async function jsonOf(response) {
    const text = await response.text().catch(() => '');
    try {
      const body = JSON.parse(text);
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * @description Turn a 429 into a pause and an error.
   * @param {Response} response - The response.
   * @param {string} endpoint - The endpoint.
   * @returns {FytaError} The error.
   */
  function rateLimited(response, endpoint) {
    const retryAfter = retryAfterSeconds(response.headers.get('retry-after'), now());
    const pause = Math.min(Math.max((retryAfter ?? 0) * 1000, MIN_PAUSE_MS), MAX_PAUSE_MS);
    pausedUntil = Math.max(pausedUntil, now() + pause);
    return new FytaError('rate_limit', `HTTP 429 on ${endpoint}`, {
      status: 429,
      endpoint,
      retryAfter,
    });
  }

  /**
   * @description Log in with the e-mail and the password, keep the token.
   * @returns {Promise<object>} `{ accessToken, expiresAt }`.
   */
  async function login() {
    const { email, password } = getCredentials();
    if (!email || !password) {
      throw new FytaError('auth', 'No e-mail or password', { code: 'missing', endpoint: 'login' });
    }
    logins += 1;
    const response = await send(
      `${baseUrl}/auth/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      },
      'login',
    );
    const body = await jsonOf(response);
    if (response.status === 429) {
      throw rateLimited(response, 'login');
    }
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      // 404: no such account; 401: wrong password (fyta_cli).
      const code = response.status === 404 ? 'unknown_account' : 'wrong_password';
      setToken(null);
      throw new FytaError('auth', `FYTA refused the login (HTTP ${response.status})`, {
        status: response.status,
        code,
        endpoint: 'login',
      });
    }
    if (response.status >= 500) {
      throw new FytaError('server', `HTTP ${response.status} on login`, {
        status: response.status,
        endpoint: 'login',
      });
    }
    if (!response.ok) {
      throw new FytaError('http', `HTTP ${response.status} on login`, {
        status: response.status,
        endpoint: 'login',
      });
    }
    const accessToken = typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    if (!accessToken) {
      throw new FytaError('failed', 'The login gave no access token', { endpoint: 'login' });
    }
    const seconds = Number(body.expires_in);
    const token = {
      accessToken,
      expiresAt:
        now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TOKEN_SECONDS) * 1000,
    };
    setToken(token);
    return token;
  }

  /**
   * @description The token to use: the one kept while valid, else a new login.
   * @returns {Promise<string>} The access token.
   */
  async function accessToken() {
    const token = getToken();
    if (token?.accessToken && token.expiresAt - RENEW_BEFORE_MS > now()) {
      return token.accessToken;
    }
    return (await queued(login)).accessToken;
  }

  /**
   * @description GET a JSON endpoint with the Bearer token, with one new login
   * when the token is refused.
   * @param {string} path - The path under the base.
   * @param {string} endpoint - A short name for the messages.
   * @returns {Promise<object>} The JSON body.
   */
  async function getJson(path, endpoint) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bearer = await accessToken();
      const result = await queued(async () => {
        const response = await send(
          `${baseUrl}/${path}`,
          {
            method: 'GET',
            headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
          },
          endpoint,
        );
        // fyta_cli: an HTML page instead of JSON is an error of the server.
        const html = /text\/html/i.test(response.headers.get('content-type') ?? '');
        const body = await jsonOf(response);
        return { response, body: html ? null : body };
      });
      const { response, body } = result;
      if (response.status === 429) {
        throw rateLimited(response, endpoint);
      }
      // 401 / 403: the token is refused. A malformed token answers 500
      // {"message":null}: worth one new login too.
      const refused =
        response.status === 401 ||
        response.status === 403 ||
        (response.status === 500 && body && body.message === null);
      if (refused) {
        setToken(null);
        if (attempt === 0) {
          continue;
        }
        if (response.status === 500) {
          throw new FytaError('server', `HTTP 500 on ${endpoint}`, { status: 500, endpoint });
        }
        throw new FytaError('token', `FYTA refused the access token (HTTP ${response.status})`, {
          status: response.status,
          endpoint,
        });
      }
      if (response.status === 404) {
        throw new FytaError('not_found', `HTTP 404 on ${endpoint}`, { status: 404, endpoint });
      }
      if (response.status >= 500) {
        throw new FytaError('server', `HTTP ${response.status} on ${endpoint}`, {
          status: response.status,
          endpoint,
        });
      }
      if (!response.ok) {
        throw new FytaError('http', `HTTP ${response.status} on ${endpoint}`, {
          status: response.status,
          endpoint,
        });
      }
      if (!body) {
        throw new FytaError('failed', `Unexpected answer of ${endpoint}`, { endpoint });
      }
      return body;
    }
    throw new FytaError('failed', `No answer of ${endpoint}`, { endpoint });
  }

  return {
    /**
     * @description Log in now (the test button), whatever the token kept.
     * @returns {Promise<object>} `{ accessToken, expiresAt }`.
     */
    login: () => queued(login),
    /**
     * @description Every plant of the account, with the gardens.
     * @returns {Promise<object>} `{ gardens, plants }`.
     */
    plants: () => getJson('user-plant', 'user-plant'),
    /**
     * @description One plant, with its measurements.
     * @param {number} id - The id of the plant of the user.
     * @returns {Promise<object>} `{ plant }`.
     */
    plant: (id) => getJson(`user-plant/${encodeURIComponent(String(id))}`, 'user-plant/{id}'),
    /**
     * @description Download a picture of a plant: PNG, JPEG or WebP, 300 KB at most.
     * @param {string} url - The picture URL given by FYTA (https only).
     * @returns {Promise<{ type: string, bytes: Buffer }>} The picture.
     */
    async image(url) {
      if (!/^https:\/\//i.test(String(url ?? ''))) {
        throw new FytaError('failed', 'Not an https picture', { endpoint: 'image' });
      }
      const headers = { accept: 'image/png,image/jpeg,image/webp' };
      if (isFytaHost(url)) {
        headers.authorization = `Bearer ${await accessToken()}`;
      }
      return queued(async () => {
        const response = await send(url, { method: 'GET', headers }, 'image');
        if (!response.ok) {
          await response.text().catch(() => '');
          throw new FytaError('http', `HTTP ${response.status} on image`, {
            status: response.status,
            endpoint: 'image',
          });
        }
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
          try {
            await response.body?.cancel();
          } catch {
            // Nothing to release.
          }
          throw new FytaError('failed', 'Picture over 300 KB', { endpoint: 'image' });
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const type = imageType(bytes);
        if (bytes.length > MAX_IMAGE_BYTES || !type) {
          const tooBig = bytes.length > MAX_IMAGE_BYTES;
          throw new FytaError('failed', tooBig ? 'Picture over 300 KB' : 'Not a picture', {
            endpoint: 'image',
          });
        }
        return { type, bytes };
      });
    },
    /**
     * @description Until when FYTA asked to wait (0: not paused).
     * @returns {number} The instant (ms).
     */
    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    /**
     * @description How many requests and logins were sent since the start.
     * @returns {{ requests: number, logins: number }} The counts.
     */
    counts: () => ({ requests, logins }),
  };
}

export {
  BASE_URL,
  SPACING_MS,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
  MAX_IMAGE_BYTES,
  RENEW_BEFORE_MS,
  FytaError,
  retryAfterSeconds,
  isFytaHost,
  imageType,
  createFytaClient,
};
