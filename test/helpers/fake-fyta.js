// -----------------------------------------------------------------------------
// A fake FYTA Public API for the tests: an in-memory `fetch` (no network),
// answering like the real API (official documentation, and the refusals seen
// live on 2026-10-25):
//   - POST /auth/login: a JSON { email, password }; an unknown e-mail answers
//     404 {"statusCode":404,"error":"Not Found"}, a wrong password 401
//     {"statusCode":401,"error":"Unauthorized","errors":[...]};
//   - GET /user-plant, /user-plant/{id}: a Bearer issued by the login; a
//     well-formed unknown token answers 403 "explicit deny", a malformed one
//     500 {"message":null};
//   - any other https URL: a picture registered with `addImage`.
// Nothing starts on import (node --test also runs test/helpers/).
// -----------------------------------------------------------------------------

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-fyta-'));

/**
 * @description A logger that keeps every line (to check what is never logged).
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')}`,
      );
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

const BASE = 'https://fyta.test/api';
const EMAIL = 'grower@example.org';
const PASSWORD = 'not-a-real-password';
const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/account.json', import.meta.url), 'utf8'));

// The smallest valid PNG (1 × 1 pixel).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * @description The fake FYTA.
 * @param {object} [options] - `{ account, email, password }`.
 * @returns {object} `{ fetch, baseUrl, account, calls, … }`.
 */
function createFakeFyta({ account = fixture(), email = EMAIL, password = PASSWORD } = {}) {
  const tokens = new Set();
  const images = new Map();
  const fake = {
    baseUrl: BASE,
    account,
    email,
    password,
    calls: [],
    logins: 0,
    // `{ '/user-plant': { status, body, headers, times } }`: the next answers forced.
    failures: {},
    expiresIn: 5184000,
    /**
     * @description Forget every token issued (they answer 403 from now on).
     */
    revokeTokens() {
      tokens.clear();
    },
    /**
     * @description Serve a picture at an URL.
     * @param {string} url - The URL.
     * @param {object} [picture] - `{ status, bytes, type, length }`.
     */
    addImage(url, picture = {}) {
      images.set(url, { status: 200, bytes: PNG, type: 'image/png', ...picture });
    },
    /**
     * @description The requests to a path.
     * @param {string} path - `/user-plant`, `/user-plant/101`, `/auth/login`.
     * @returns {object[]} The calls.
     */
    callsTo(path) {
      return fake.calls.filter((call) => call.path === path);
    },
    /**
     * @description Change a measurement of a plant in the list and its details,
     * as a new reading of its sensor would.
     * @param {number} id - The plant id.
     * @param {object} change - `{ measure, current, status, receivedAt, status: plantStatus, batteryLow }`.
     */
    update(id, change) {
      const entry = account.plants.plants.find((plant) => plant.id === id);
      const detail = account.details[id].plant;
      if (change.measure) {
        const measurement = detail.measurements[change.measure];
        if (change.current !== undefined) {
          measurement.values.current = change.current;
        }
        if (change.level !== undefined) {
          measurement.status = change.level;
          if (entry[`${change.measure}_status`] !== undefined) {
            entry[`${change.measure}_status`] = change.level;
          }
        }
      }
      if (change.plantStatus !== undefined) {
        detail.status = change.plantStatus;
        entry.status = change.plantStatus;
      }
      if (change.batteryLow !== undefined) {
        detail.sensor.is_battery_low = change.batteryLow;
        entry.sensor.is_battery_low = change.batteryLow;
      }
      if (change.battery !== undefined) {
        detail.measurements.battery = change.battery;
      }
      if (change.fertiliseAt !== undefined) {
        detail.fertilisation.fertilise_at = change.fertiliseAt;
      }
      if (change.receivedAt !== undefined) {
        detail.received_data_at = change.receivedAt;
        detail.sensor.received_data_at = change.receivedAt;
        entry.received_data_at = change.receivedAt;
        entry.sensor.received_data_at = change.receivedAt;
      }
    },
    /**
     * @description The fetch of the fake.
     * @param {string} url - The URL.
     * @param {object} [init] - The options.
     * @returns {Promise<Response>} The answer.
     */
    async fetch(url, init = {}) {
      const headers = Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      );
      const method = init.method ?? 'GET';
      if (!url.startsWith(BASE)) {
        fake.calls.push({ method, path: url, headers, body: null });
        const picture = images.get(url);
        if (!picture) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'content-type': 'text/plain' },
          });
        }
        return new Response(picture.bytes, {
          status: picture.status,
          headers: {
            'content-type': picture.type,
            ...(picture.length ? { 'content-length': String(picture.length) } : {}),
          },
        });
      }
      const path = url.slice(BASE.length).split('?')[0];
      const call = { method, path, headers, body: init.body ?? null };
      fake.calls.push(call);
      const forced = fake.failures[path];
      if (forced && forced.times !== 0) {
        forced.times = (forced.times ?? 1) - 1;
        return json(forced.status, forced.body ?? { message: null }, forced.headers);
      }
      if (path === '/auth/login') {
        if (method !== 'POST') {
          return json(405, { message: 'Method Not Allowed' });
        }
        if (!/json/.test(headers['content-type'] ?? '')) {
          return json(415, { message: 'Unsupported Media Type' });
        }
        let body;
        try {
          body = JSON.parse(init.body);
        } catch {
          return json(400, { statusCode: 400, error: 'Bad Request' });
        }
        if (body.email !== fake.email) {
          return json(404, { statusCode: 404, error: 'Not Found' });
        }
        if (body.password !== fake.password) {
          return json(401, {
            statusCode: 401,
            error: 'Unauthorized',
            errors: [{ message: 'Could not authenticate user' }],
          });
        }
        fake.logins += 1;
        const token = `not-a-real-fyta-access-token-${fake.logins}`;
        tokens.add(token);
        return json(200, { ...account.login, access_token: token, expires_in: fake.expiresIn });
      }
      const bearer = String(headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!tokens.has(bearer)) {
        if (/^[a-z0-9-]{20,}$/i.test(bearer)) {
          return json(403, {
            Message:
              'User is not authorized to access this resource with an explicit deny in an identity-based policy',
          });
        }
        return json(500, { message: null });
      }
      if (method !== 'GET') {
        return json(405, { message: 'Method Not Allowed' });
      }
      if (path === '/user-plant') {
        return json(200, account.plants);
      }
      const match = path.match(/^\/user-plant\/(\d+)$/);
      if (match && account.details[match[1]]) {
        return json(200, account.details[match[1]]);
      }
      return json(404, { statusCode: 404, error: 'Not Found' });
    },
  };
  fake.fetch = fake.fetch.bind(fake);
  return fake;
}

export { BASE, EMAIL, PASSWORD, PNG, createFakeFyta, dataDir, recordingLogger };
