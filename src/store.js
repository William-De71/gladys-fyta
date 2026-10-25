// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/fyta.json (mode 0600):
//
//   - `account`       a short SHA-256 of the e-mail address of the account the
//                     token belongs to (never the address, never the password);
//   - `token`         the access token of FYTA and when it expires
//                     (`{ accessToken, expiresAt }`): kept until it expires so
//                     that a restart does not log in again (60 days in the
//                     documentation); never logged;
//   - `plants`        the list of the plants (GET user-plant) and when it was
//                     read (`listAt`, `listTriedAt`);
//   - `details`       per plant: the last details read (GET user-plant/{id}),
//                     when (`at`), the list signature they match, and whether
//                     a pH was ever given (`phSeen`, the feature then stays);
//   - `seen`          per plant: what the scene triggers know;
//   - `accessRefused` why FYTA refuses the account, or null (the trigger fires
//                     once per refusal);
//   - `lastError`     the last error of a reading (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'fyta.json';
const EMPTY = () => ({
  account: null,
  token: null,
  plants: [],
  listAt: 0,
  listTriedAt: 0,
  details: {},
  seen: {},
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only: it holds the access token.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const token = raw.token;
      store.data.account = typeof raw.account === 'string' ? raw.account : null;
      store.data.token =
        isObject(token) &&
        typeof token.accessToken === 'string' &&
        token.accessToken &&
        Number.isFinite(token.expiresAt)
          ? { accessToken: token.accessToken, expiresAt: token.expiresAt }
          : null;
      store.data.plants = Array.isArray(raw.plants)
        ? raw.plants.filter((plant) => Number.isInteger(plant?.id))
        : [];
      store.data.listAt = Number.isFinite(raw.listAt) ? raw.listAt : 0;
      store.data.listTriedAt = Number.isFinite(raw.listTriedAt) ? raw.listTriedAt : 0;
      store.data.details = isObject(raw.details) ? { ...raw.details } : {};
      store.data.seen = isObject(raw.seen) ? { ...raw.seen } : {};
      store.data.accessRefused = isObject(raw.accessRefused) ? raw.accessRefused : null;
      store.data.lastError = isObject(raw.lastError) ? raw.lastError : null;
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
