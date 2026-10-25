// -----------------------------------------------------------------------------
// The FYTA integration: every handler, registered on a Gladys client.
//
// Brings the plants of a FYTA account (FYTA Beam sensors) into Gladys,
// through the official FYTA Public API, read only:
//   - devices (device.js): one per plant with a sensor — soil moisture,
//     light, temperature, pH when FYTA gives one, sensor battery and its low
//     flag, and the states FYTA gives (plant, soil moisture, light,
//     temperature, salinity, nutrients);
//   - scene triggers (events.js): plant needs attention, plant thirsty,
//     measure out of range / back in range, sensor battery low, sensor
//     silent / back, fertilizing due, access refused;
//   - scene actions: refresh now, values of a plant, summary of the plants
//     to care for;
//   - dashboard widgets (widgets.js): plants to care for, one plant;
//   - configuration buttons: test the connection, diagnostic.
//
// The integration reads the cloud on its own timer, one request at a time
// (fyta-api.js): the list of the plants at the interval of the configuration
// (15 minutes by default: a Beam reports about once an hour), the details of
// a plant only when the list shows something new for it (a measurement, a
// state, the battery) or every 6 hours. The scene triggers are worked out
// every 30 seconds from what was read, never from a scene action.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake FYTA (test/helpers/fake-fyta.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createFytaClient } from './fyta-api.js';
import { createStore } from './store.js';
import { parsePlantList, parsePlant, problemsOf, LEVEL_KEYS } from './parse.js';
import {
  plantIds,
  plantOfExternalId,
  plantName,
  buildPlantDevice,
  buildPlantStates,
  measureLevelLabel,
  plantStatusLabel,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PLANT_OUTPUTS,
  CARE_OUTPUTS,
  pick,
  rounded,
  problemsText,
  isFresh,
  detectPlant,
  eventData,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  messageContent,
  careScore,
  buildCareWidget,
  buildPlantWidget,
} from './widgets.js';
import { MINUTE_MS, HOUR_MS, defaultTimeZone, usableTimeZone, localParts } from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = 30 * 1000;
// No burst at startup: the first reading waits a little, even when due.
const STARTUP_DELAY_MS = 10 * 1000;
const LIST_RETRY_MS = 2 * MINUTE_MS;
const DETAIL_EVERY_MS = 6 * HOUR_MS;
const ACCESS_RETRY_MS = 30 * MINUTE_MS;
// A manual refresh (button, scene action) at most once a minute.
const MANUAL_EVERY_MS = MINUTE_MS;
// Re-send unchanged values of a sensor still reporting, so that Gladys does
// not show them as outdated (48 h by default).
const HEARTBEAT_MS = 6 * HOUR_MS;
const IMAGE_RETRY_MS = 6 * HOUR_MS;
const IMAGE_WAIT_MS = 8000;
const MAX_IMAGES = 30;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-fyta/${VERSION} (+https://github.com/William-De71/gladys-fyta)`;

/**
 * @description A short fingerprint (16 hexadecimal characters).
 * @param {string} value - The value.
 * @returns {string|null} The fingerprint.
 */
const fingerprint = (value) =>
  value ? createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16) : null;

/**
 * @description The account a token belongs to: a fingerprint of the e-mail.
 * @param {string} email - The e-mail address.
 * @returns {string|null} The fingerprint.
 */
const accountOf = (email) => fingerprint(String(email ?? '').toLowerCase());

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of FYTA (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {number} [options.spacingMs] - Time between two requests (0 in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataDir,
    now = () => Date.now(),
    timeZone: zone = defaultTimeZone(),
    timers = true,
    spacingMs,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastAccessTry = 0;
  let lastManual = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;
  // Pictures of the plants: url -> { key, base64 }, and the failed ones.
  const images = new Map();
  const imageFailures = new Map();

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createFytaClient({
    getCredentials: () => ({ email: config.email, password: config.password }),
    getToken: () =>
      store.data.account && store.data.account === accountOf(config.email)
        ? store.data.token
        : null,
    setToken: (token) => {
      store.data.token = token;
      store.data.account = token ? accountOf(config.email) : store.data.account;
    },
    userAgent: USER_AGENT,
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(spacingMs) ? { spacingMs } : {}),
  });

  const hasCredentials = () => Boolean(config.email && config.password);
  const offlineMs = () => config.offlineHours * HOUR_MS;
  const pollMs = () => config.pollMinutes * MINUTE_MS;

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known of a plant ------------------------------------------------------

  /**
   * @description The details kept of a plant.
   * @param {number} id - The plant id.
   * @returns {object|null} `{ plant, at, signature, phSeen }`.
   */
  const detailOf = (id) => store.data.details[id] ?? null;

  /**
   * @description The plants with a sensor whose details were read, in the order of the list.
   * @returns {object[]} parsePlant() records.
   */
  const sensorPlants = () =>
    store.data.plants
      .map((entry) => detailOf(entry.id)?.plant)
      .filter((plant) => plant && plant.sensor);

  /**
   * @description How many plants of the account have no sensor.
   * @returns {number} The count.
   */
  const withoutSensor = () =>
    store.data.plants.filter(
      (entry) => !entry.hasSensor || detailOf(entry.id)?.plant?.sensor === null,
    ).length;

  /**
   * @description The view of a plant the widgets, the scenes and the states use.
   * @param {object} plant - parsePlant().
   * @returns {object} The view.
   */
  function viewOf(plant) {
    return {
      id: plant.id,
      deviceId: plantIds(gladys, plant.id).device,
      name: plantName(plant),
      scientificName: plant.scientificName,
      plant,
      fresh: isFresh(plant, now(), offlineMs()),
      silent: !isFresh(plant, now(), offlineMs()),
    };
  }

  /**
   * @description Today and the hour in the timezone of Gladys.
   * @returns {{ today: string, hour: number }} "2026-10-25", 0-23.
   */
  function localNow() {
    const parts = localParts(now(), timeZone);
    return { today: parts.date, hour: parts.hour };
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`, `code`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err?.kind === 'auth') {
      if (err.code === 'missing') return t('statusNoCredentials', lang);
      return t(err.code === 'unknown_account' ? 'errUnknownAccount' : 'errWrongPassword', lang);
    }
    const key = {
      token: 'errToken',
      rate_limit: 'errRateLimit',
      server: 'errServer',
      unreachable: 'errUnreachable',
    }[err?.kind];
    if (key) {
      return t(key, lang);
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!hasCredentials()) {
      await reportStatus(false, all('statusNoCredentials'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(
        false,
        all((lang) => errorText(store.data.accessRefused, lang)),
      );
      return;
    }
    if (!store.data.listAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    const plants = sensorPlants();
    if (plants.length === 0) {
      await reportStatus(false, all('statusNoPlant'));
      return;
    }
    const care = plants.filter((plant) => careScore(viewOf(plant)) > 0).length;
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, { count: plants.length, care }),
          ...(api.pausedUntil() ? [t('statusPaused', lang)] : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`FYTA: ${key}${data.plant_id !== undefined ? ` (plant ${data.plant_id})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the plants with a sensor, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = sensorPlants().map((plant) =>
      buildPlantDevice(gladys, plant, { language: lang, ph: detailOf(plant.id)?.phSeen === true }),
    );
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of a plant, when its device exists.
   * @param {object} plant - parsePlant().
   * @returns {Promise<void>}
   */
  async function publishStates(plant) {
    if (!createdDevices.has(plantIds(gladys, plant.id).device)) {
      return;
    }
    const states = buildPlantStates(gladys, plant, {
      language: textLanguage(),
      ph: detailOf(plant.id)?.phSeen === true,
    });
    if (!states.length) {
      return;
    }
    // A silent sensor lets its values age: Gladys shows them as outdated.
    const options = isFresh(plant, now(), offlineMs()) ? { heartbeat: HEARTBEAT_MS } : {};
    await gladys
      .publishChangedStates(states, options)
      .catch((err) =>
        logger.warn(`Unable to publish the states of plant ${plant.id}: ${err.message}`),
      );
  }

  /**
   * @description Publish the states of every plant.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    for (const plant of sensorPlants()) {
      await publishStates(plant);
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Remember a refusal of the account (the trigger fires once, from the timer).
   * @param {object} err - The error.
   */
  function refused(err) {
    const code = err.kind === 'auth' ? (err.code ?? 'wrong_password') : 'token';
    const signature = `${err.kind}:${code}`;
    const announced =
      store.data.accessRefused?.signature === signature && store.data.accessRefused.announced;
    store.data.accessRefused = { kind: err.kind, code, signature, announced: Boolean(announced) };
    lastAccessTry = now();
  }

  /**
   * @description Note the error of a reading.
   * @param {string} what - The reading.
   * @param {Error} err - The error.
   */
  function noteError(what, err) {
    const kind = err.kind ?? 'failed';
    logger.warn(`FYTA ${what} (${kind}): ${err.message}`);
    store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description Whether the details of a plant are due.
   * @param {object} entry - parsePlantList() entry.
   * @param {boolean} force - Read every plant.
   * @returns {boolean} True when due.
   */
  function detailDue(entry, force) {
    if (!entry.hasSensor) {
      return false;
    }
    const detail = detailOf(entry.id);
    return (
      force ||
      !detail ||
      detail.signature !== entry.signature ||
      now() - (detail.at ?? 0) >= DETAIL_EVERY_MS
    );
  }

  /**
   * @description Read the list of the plants, then the details that are due.
   * @param {object} [options] - `{ force }`: read now, every plant.
   * @returns {Promise<{ changed: boolean, error: object|null }>} What happened.
   */
  async function runReadings({ force = false } = {}) {
    if (!hasCredentials()) {
      return { changed: false, error: { kind: 'auth', code: 'missing' } };
    }
    if (!force && store.data.accessRefused && now() - lastAccessTry < ACCESS_RETRY_MS) {
      return { changed: false, error: store.data.accessRefused };
    }
    if (api.pausedUntil()) {
      return { changed: false, error: { kind: 'rate_limit' } };
    }
    const due =
      force ||
      store.data.accessRefused ||
      (now() - (store.data.listAt ?? 0) >= pollMs() &&
        now() - (store.data.listTriedAt ?? 0) >= Math.min(pollMs(), LIST_RETRY_MS));
    if (!due) {
      return { changed: false, error: null };
    }
    store.data.listTriedAt = now();
    lastAccessTry = now();
    let error = null;
    try {
      const list = parsePlantList(await api.plants());
      store.data.plants = list;
      store.data.listAt = now();
      if (store.data.accessRefused) {
        logger.info('FYTA accepts the account again');
        store.data.accessRefused = null;
      }
      // A plant gone, or without a sensor any more, is no longer offered.
      const ids = new Set(list.filter((entry) => entry.hasSensor).map((entry) => entry.id));
      for (const id of Object.keys(store.data.details)) {
        if (!ids.has(Number(id))) {
          delete store.data.details[id];
          delete store.data.seen[id];
        }
      }
      for (const entry of list.filter((item) => detailDue(item, force))) {
        try {
          const plant = parsePlant(await api.plant(entry.id));
          if (!plant) {
            throw Object.assign(new Error('No plant in the answer'), { kind: 'failed' });
          }
          plant.gardenName ||= entry.gardenName;
          store.data.details[entry.id] = {
            plant,
            at: now(),
            signature: entry.signature,
            phSeen: detailOf(entry.id)?.phSeen === true || Number.isFinite(plant.ph),
          };
        } catch (err) {
          noteError(`plant ${entry.id}`, err);
          if (err.kind === 'not_found') {
            delete store.data.details[entry.id];
            continue;
          }
          if (['auth', 'token', 'rate_limit', 'unreachable'].includes(err.kind)) {
            if (['auth', 'token'].includes(err.kind)) refused(err);
            error = err;
            break;
          }
        }
      }
    } catch (err) {
      noteError('plants', err);
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
      }
      error = err;
    }
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    refreshWidgets();
    return { changed: true, error };
  }

  /**
   * @description Work out the scene events from what was read (timer only).
   * @returns {Promise<void>}
   */
  async function detectEvents() {
    const events = [];
    const lang = textLanguage();
    const { today, hour } = localNow();
    const refusal = store.data.accessRefused;
    if (refusal && !refusal.announced) {
      events.push({
        key: TRIGGERS.ACCESS_REFUSED,
        data: { reason: refusal.code, message: errorText(refusal, lang).slice(0, 1000) },
      });
      refusal.announced = true;
    }
    for (const plant of sensorPlants()) {
      const found = detectPlant(store.data.seen[plant.id], plant, {
        now: now(),
        offlineMs: offlineMs(),
        today,
        hour,
      });
      store.data.seen[plant.id] = found.next;
      const view = viewOf(plant);
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: eventData(view, plant, event, { language: lang, now: now() }),
        });
      }
    }
    if (events.length) {
      await store.save();
      await publishEvents(events);
      refreshWidgets();
    }
  }

  /**
   * @description One round of the timer: the readings due, then the triggers.
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = (async () => {
        await runReadings();
        await detectEvents();
        await refreshStatus();
      })()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description A refresh asked by the user (button, scene action): at most
   * once a minute, after the round running; no scene event from it.
   * @returns {Promise<{ read: boolean, error: object|null }>} What happened.
   */
  async function manualRefresh() {
    if (running) {
      await running;
    }
    if (now() - lastManual < MANUAL_EVERY_MS) {
      return { read: false, error: null };
    }
    lastManual = now();
    const result = await runReadings({ force: true });
    await refreshStatus();
    return { read: true, error: result.error };
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  /**
   * @description The plant a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} parsePlant(), the first plant by default.
   */
  function target(externalId) {
    const id = plantOfExternalId(externalId);
    const plants = sensorPlants();
    return plants.find((plant) => plant.id === id) ?? plants[0] ?? null;
  }

  // --- Pictures ----------------------------------------------------------------------

  /**
   * @description The pictures of a plant to try, smallest first: the picture
   * of the user, else the one of the species.
   * @param {object} plant - parsePlant().
   * @returns {string[]} The URLs.
   */
  const pictureUrls = (plant) =>
    [
      plant.pictures?.user,
      plant.pictures?.userLarge,
      plant.pictures?.species,
      plant.pictures?.speciesLarge,
    ].filter(Boolean);

  /**
   * @description The key of the picture of a plant, downloaded when needed.
   * @param {object} plant - parsePlant().
   * @returns {Promise<string|null>} The key, null when none could be read.
   */
  async function pictureKey(plant) {
    for (const url of pictureUrls(plant)) {
      if (images.has(url)) {
        return images.get(url).key;
      }
      if (now() - (imageFailures.get(url) ?? -Infinity) < IMAGE_RETRY_MS) {
        continue;
      }
      try {
        const picture = await Promise.race([
          api.image(url),
          new Promise((resolve, reject) => {
            const wait = setTimeout(() => reject(new Error('Picture too slow')), IMAGE_WAIT_MS);
            wait.unref?.();
          }),
        ]);
        const key = `plant-${plant.id}-${fingerprint(url).slice(0, 12)}`;
        if (images.size >= MAX_IMAGES) {
          images.delete(images.keys().next().value);
        }
        images.set(url, { key, base64: picture.bytes.toString('base64') });
        return key;
      } catch (err) {
        imageFailures.set(url, now());
        logger.debug?.(`FYTA picture of plant ${plant.id}: ${err.message}`);
      }
    }
    return null;
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no plant to show.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are plants.
   */
  function widgetMessage(lang) {
    if (!hasCredentials()) {
      return messageContent(t('statusNoCredentials', lang));
    }
    if (store.data.accessRefused) {
      return messageContent(errorText(store.data.accessRefused, lang));
    }
    if (sensorPlants().length === 0) {
      return messageContent(t(store.data.listAt ? 'statusNoPlant' : 'statusWaiting', lang));
    }
    return null;
  }

  gladys.onWidgetGet(WIDGETS.CARE, async ({ language: lang }) => {
    rememberLanguage(lang);
    return (
      widgetMessage(lang) ??
      buildCareWidget({
        views: sensorPlants().map(viewOf),
        withoutSensor: withoutSensor(),
        language: lang,
        now: now(),
        timeZone,
      })
    );
  });

  gladys.onWidgetGet(WIDGETS.PLANT, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) {
      return message;
    }
    const plant = target(settings.plant);
    return buildPlantWidget({
      view: viewOf(plant),
      imageKey: await pictureKey(plant),
      language: lang,
      now: now(),
      timeZone,
      today: localNow().today,
    });
  });

  gladys.onWidgetGetImage(async (key) => {
    const found = [...images.values()].find((image) => image.key === key);
    if (found) {
      return found.base64;
    }
    // After a restart: download it again.
    const id = Number(String(key).match(/^plant-(\d+)-/)?.[1]);
    const plant = sensorPlants().find((item) => item.id === id);
    if (plant && (await pictureKey(plant)) === key) {
      return [...images.values()].find((image) => image.key === key).base64;
    }
    throw new Error('Unknown picture');
  });

  gladys.onWidgetAction(WIDGETS.CARE, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      throw new Error(`Unknown action ${String(actionKey).slice(0, 40)}`);
    }
    const { read, error } = await manualRefresh();
    if (error) {
      return all((lang) => errorText(error, lang));
    }
    if (!read) {
      return all('toastTooSoon');
    }
    return all('toastRefreshed', { count: sensorPlants().length });
  });

  // --- Scene actions -----------------------------------------------------------------

  /**
   * @description The plant of a scene action, checked.
   * @param {unknown} externalId - The `plant` field.
   * @param {string} lang - The language.
   * @returns {object} parsePlant().
   */
  function actionTarget(externalId, lang) {
    if (!hasCredentials()) {
      throw new Error(t('statusNoCredentials', lang));
    }
    const plant = target(externalId);
    if (!plant) {
      throw new Error(t('errNoPlant', lang));
    }
    return plant;
  }

  /**
   * @description "no measurement for 5 h", for the scene texts.
   * @param {object} plant - parsePlant().
   * @param {string} lang - The language.
   * @returns {string} The text.
   */
  function silenceText(plant, lang) {
    if (!Number.isFinite(plant.receivedAt)) {
      return t('summaryNever', lang);
    }
    const hours = Math.floor((now() - plant.receivedAt) / HOUR_MS);
    return t('summarySilent', lang, { hours: formatNumber(hours, lang, 0) });
  }

  // Reads now (once a minute at most); the triggers follow at the next round.
  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    const lang = textLanguage();
    if (!hasCredentials()) {
      throw new Error(t('statusNoCredentials', lang));
    }
    const { error } = await manualRefresh();
    if (error) {
      throw new Error(errorText(error, lang).slice(0, 500));
    }
    const plants = sensorPlants();
    return pick(
      {
        plant_count: plants.length,
        care_count: plants.filter((plant) => careScore(viewOf(plant)) > 0).length,
      },
      REFRESH_OUTPUTS,
    );
  });

  // Answers from what the timer read: no request.
  gladys.onSceneAction(SCENE_ACTIONS.GET_PLANT, async (fields = {}) => {
    const lang = textLanguage();
    const plant = actionTarget(fields.plant, lang);
    const view = viewOf(plant);
    const measure = (name) => plant.measures?.[name] ?? {};
    const state = (name) => LEVEL_KEYS[measure(name).status ?? 0];
    const shown = (value, unit, decimals) =>
      Number.isFinite(value) ? `${formatNumber(value, lang, decimals)} ${unit}` : '–';
    return pick(
      {
        plant_name: view.name,
        state: plantStatusLabel(plant.status, lang),
        needs_attention: careScore(view) > 0,
        moisture: rounded(measure('moisture').value, 1),
        moisture_state: state('moisture'),
        light: rounded(measure('light').value, 0),
        light_state: state('light'),
        temperature: rounded(measure('temperature').value, 1),
        temperature_state: state('temperature'),
        salinity: rounded(measure('salinity').value, 2),
        salinity_state: state('salinity'),
        nutrients_state: state('nutrients'),
        battery: rounded(plant.battery, 0),
        hours_without_data: Number.isFinite(plant.receivedAt)
          ? rounded((now() - plant.receivedAt) / HOUR_MS, 1)
          : null,
        summary: t('summaryPlant', lang, {
          name: view.name,
          state: [
            plantStatusLabel(plant.status, lang),
            problemsText(plant, lang),
            view.silent ? silenceText(plant, lang) : '',
          ]
            .filter(Boolean)
            .join(', '),
          moisture: `${shown(measure('moisture').value, '%', 0)} (${measureLevelLabel('moisture', measure('moisture').status ?? 0, lang)})`,
          light: shown(measure('light').value, 'µmol/m²/s', 0),
          temperature: shown(measure('temperature').value, '°C', 1),
          salinity: shown(measure('salinity').value, 'mS/cm', 2),
          battery: shown(plant.battery, '%', 0),
        }).slice(0, 1000),
      },
      PLANT_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_CARE_SUMMARY, async () => {
    const lang = textLanguage();
    if (!hasCredentials()) {
      throw new Error(t('statusNoCredentials', lang));
    }
    const views = sensorPlants().map(viewOf);
    const care = views
      .map((view) => ({ view, score: careScore(view) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const lines = care.map(({ view }) =>
      t('summaryLine', lang, {
        name: view.name,
        problems: view.silent
          ? silenceText(view.plant, lang)
          : problemsText(view.plant, lang) ||
            (view.plant.sensor?.batteryLow
              ? t('cardBattery', lang)
              : plantStatusLabel(view.plant.status, lang)),
      }),
    );
    return pick(
      {
        care_count: care.filter(({ view }) => !view.silent).length,
        plant_count: views.length,
        silent_count: views.filter((view) => view.silent).length,
        summary: (lines.length
          ? lines.join('; ')
          : t('summaryAllGood', lang, { count: views.length })
        ).slice(0, 1000),
      },
      CARE_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!hasCredentials()) {
      return all('statusNoCredentials');
    }
    try {
      await api.login();
      store.data.accessRefused = null;
      lastManual = now();
      const { error } = await runReadings({ force: true });
      lastStatus = null;
      await refreshStatus();
      schedule();
      if (error) {
        return all((lang) => errorText(error, lang));
      }
      const plants = sensorPlants();
      const names = plants.map(plantName).slice(0, 10).join(', ');
      const without = withoutSensor();
      return all((lang) =>
        [
          t('testOk', lang, { count: plants.length, names: names ? ` (${names})` : '' }),
          ...(without ? [t('testWithout', lang, { count: without })] : []),
        ]
          .join(' ')
          .slice(0, 1000),
      );
    } catch (err) {
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
        await store.save();
        lastStatus = null;
        await refreshStatus();
      }
      return all((lang) => errorText(err, lang));
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      email: config.email ? 'set' : 'missing',
      password: config.password ? 'set' : 'missing',
      token: store.data.token ? { expiresAt: iso(store.data.token.expiresAt) } : null,
      pollMinutes: config.pollMinutes,
      offlineHours: config.offlineHours,
      language: config.language,
      accessRefused: store.data.accessRefused,
      lastError: store.data.lastError,
      listAt: iso(store.data.listAt),
      api: { ...api.counts(), pausedUntil: iso(api.pausedUntil()) },
      plants: store.data.plants.map((entry) => {
        const detail = detailOf(entry.id);
        const plant = detail?.plant;
        return {
          id: entry.id,
          status: entry.status,
          hasSensor: entry.hasSensor,
          created: createdDevices.has(plantIds(gladys, entry.id).device),
          detailAt: iso(detail?.at),
          phSeen: detail?.phSeen ?? false,
          receivedAt: iso(plant?.receivedAt),
          sensor: plant?.sensor
            ? { ...plant.sensor, receivedAt: iso(plant.sensor.receivedAt) }
            : null,
          measures: plant?.measures ?? null,
          battery: plant?.battery ?? null,
          fertilisation: plant?.fertilisation ?? null,
          pictures: plant
            ? Object.fromEntries(Object.entries(plant.pictures).map(([k, v]) => [k, Boolean(v)]))
            : null,
          problems: plant ? problemsOf(plant) : [],
          seen: store.data.seen[entry.id] ?? null,
        };
      }),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `FYTA diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (!count) {
      store.data.listAt = 0;
      store.data.listTriedAt = 0;
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    const account = accountOf(config.email);
    if (store.data.account && store.data.account !== account) {
      // Another account: what was read belongs to the previous one.
      store.data.plants = [];
      store.data.details = {};
      store.data.seen = {};
      store.data.listAt = 0;
    }
    if (previous.email !== config.email || previous.password !== config.password) {
      // New credentials: a new login at the next round, the list read again.
      store.data.token = null;
      store.data.account = null;
      store.data.accessRefused = null;
      store.data.listAt = 0;
      store.data.listTriedAt = 0;
      lastAccessTry = 0;
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    api,
    tick,
    runReadings,
    detectEvents,
    manualRefresh,
    viewOf,
    sensorPlants,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, USER_AGENT, ACCESS_RETRY_MS, DETAIL_EVERY_MS, HEARTBEAT_MS };
