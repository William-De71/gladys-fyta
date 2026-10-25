// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// FYTA (test/helpers/fake-fyta.js), an in-memory fetch. No test touches the
// network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, ACCESS_RETRY_MS, HEARTBEAT_MS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PLANT_OUTPUTS,
  CARE_OUTPUTS,
} from '../src/events.js';
import { FILE } from '../src/store.js';
import {
  createFakeFyta,
  dataDir,
  recordingLogger,
  EMAIL,
  PASSWORD,
  PNG,
} from './helpers/fake-fyta.js';

const NOW = Date.parse('2026-10-25T10:00:00Z'); // 11:00 in Paris
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const CONFIG = { email: EMAIL, password: PASSWORD, language: 'en' };
const PREFIX = 'ext:test-integration';
const id = (plant, feature) => `${PREFIX}:plant:${plant}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and a fake FYTA.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir, logger }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= createFakeFyta();
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    baseUrl: fake.baseUrl,
    dataDir: dir,
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, fake, clock, dir, logger };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const paths = (fake, from = 0) =>
  fake.calls.slice(from).map((call) => `${call.method} ${call.path}`);
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('startup: a login, the list, the details of the plants with a sensor; devices offered', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  assert.deepEqual(fake.calls, [], 'no request before the timer');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await app.tick();
  assert.deepEqual(paths(fake), [
    'POST /auth/login',
    'GET /user-plant',
    'GET /user-plant/101',
    'GET /user-plant/102',
    'GET /user-plant/103',
  ]);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.external_id]),
    [
      ['Monstera', id(101)],
      ['Basilic', id(102)],
      ['Ficus', id(103)],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus.message, {
    en: 'Connected: 3 plant(s), 2 to care for.',
    fr: 'Connecté : 3 plante(s), 2 à soigner.',
    de: 'Verbunden: 3 Pflanze(n), 2 zu pflegen.',
    es: 'Conectado: 3 planta(s), 2 por cuidar.',
  });
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
});

test('the token is kept in /data (0600) until it expires; the password and the token are never logged', async (t) => {
  const dir = dataDir();
  const fake = createFakeFyta();
  const first = await startApp(t, { dir, fake });
  await first.app.tick();
  const path = join(dir, FILE);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.token.accessToken, 'not-a-real-fyta-access-token-1');
  assert.equal(saved.token.expiresAt, NOW + 5184000 * 1000);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, new RegExp(PASSWORD));
  assert.doesNotMatch(text, new RegExp(EMAIL), 'only a fingerprint of the e-mail');
  await first.gladys.fake.action(ACTIONS.DIAGNOSTIC, {});
  for (const line of first.logger.lines) {
    assert.doesNotMatch(line, /not-a-real-password|not-a-real-fyta-access-token/, line);
  }
  // A restart: the token kept is used, no new login.
  const clock = { now: NOW + 20 * MINUTE };
  const second = await startApp(t, { dir, fake, clock });
  await second.app.tick();
  assert.equal(fake.logins, 1);
});

test('states once the devices exist, re-sent at creation; texts in the language of the configuration', async (t) => {
  const { gladys, app } = await startApp(t, { config: { ...CONFIG, language: 'fr' } });
  await app.tick();
  await createAll(gladys);
  assert.equal(gladys.fake.lastState(id(101, 'moisture')), 18);
  assert.equal(gladys.fake.lastState(id(101, 'moisture_status')), 'Trop faible');
  assert.equal(gladys.fake.lastState(id(101, 'plant_status')), 'À surveiller');
  assert.equal(gladys.fake.lastState(id(101, 'battery')), 64);
  assert.equal(gladys.fake.lastState(id(103, 'battery_low')), 1);
  assert.equal(gladys.fake.lastState(id(103, 'light_status')), 'Trop faible');
  assert.equal(gladys.fake.lastState(id(102, 'ph')), undefined, 'no pH from FYTA');
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Humidité du sol');
  const count = gladys.fake.states.length;
  await app.tick();
  assert.equal(gladys.fake.states.length, count, 'nothing new, nothing sent');
});

test('the pace: the list at the interval, the details only when the list shows something new', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  await createAll(gladys);
  const before = fake.calls.length;
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, before, 'not before 15 minutes');
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.deepEqual(paths(fake, before), ['GET /user-plant'], 'nothing new: the list only');
  fake.update(101, {
    measure: 'moisture',
    current: '48',
    level: 3,
    receivedAt: '2026-10-25 10:10:00',
  });
  const next = fake.calls.length;
  clock.now += 15 * MINUTE;
  await app.tick();
  assert.deepEqual(paths(fake, next), ['GET /user-plant', 'GET /user-plant/101']);
  assert.equal(gladys.fake.lastState(id(101, 'moisture')), 48);
  assert.equal(gladys.fake.lastState(id(101, 'moisture_status')), 'Perfect');
  const [back] = events(gladys, TRIGGERS.MEASURE_BACK_IN_RANGE);
  assert.equal(back.data.plant, id(101));
  assert.equal(back.data.measure, 'moisture');
  assert.equal(back.data.previous_level, 'too_low');
  // Every 6 hours the details are read again, even without news.
  clock.now += 6 * HOUR;
  const late = fake.calls.length;
  await app.tick();
  assert.ok(paths(fake, late).includes('GET /user-plant/102'));
});

test('scene triggers: thirsty, out of range, needs attention, battery low, silent, back', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.update(102, {
    measure: 'moisture',
    current: '30',
    level: 2,
    plantStatus: 2,
    batteryLow: true,
    receivedAt: '2026-10-25 10:05:00',
  });
  clock.now += 15 * MINUTE;
  await app.tick();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    [
      TRIGGERS.PLANT_NEEDS_ATTENTION,
      TRIGGERS.MEASURE_OUT_OF_RANGE,
      TRIGGERS.PLANT_THIRSTY,
      TRIGGERS.SENSOR_BATTERY_LOW,
    ],
  );
  const [thirsty] = events(gladys, TRIGGERS.PLANT_THIRSTY);
  assert.deepEqual(
    { ...thirsty.data },
    {
      plant: id(102),
      plant_name: 'Basilic',
      plant_id: 102,
      scientific_name: 'Ocimum basilicum',
      moisture: 30,
      level: 'low',
      level_label: 'Low',
      min_good: 35,
    },
  );
  // No news for 3 hours: the sensors go silent, once.
  clock.now = Date.parse('2026-10-25T13:20:00Z');
  await app.tick();
  assert.deepEqual(
    events(gladys, TRIGGERS.SENSOR_SILENT).map((event) => event.data.plant_name),
    ['Monstera', 'Basilic'],
    'the Ficus was already silent at the first reading',
  );
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.SENSOR_SILENT).length, 2);
  fake.update(103, { receivedAt: '2026-10-25 13:15:00' });
  clock.now += 15 * MINUTE;
  await app.tick();
  const [back] = events(gladys, TRIGGERS.SENSOR_BACK);
  assert.equal(back.data.plant_name, 'Ficus');
  assert.equal(back.data.hours_without_data, 9.1);
});

test('fertilizing due at 9:00 (Gladys time) on the planned date', async (t) => {
  const { gladys, app, clock } = await startApp(t);
  await app.tick();
  clock.now = Date.parse('2026-11-01T07:30:00Z'); // 8:30 in Paris
  await app.detectEvents();
  assert.equal(events(gladys, TRIGGERS.FERTILISATION_DUE).length, 0);
  clock.now = Date.parse('2026-11-01T08:00:00Z'); // 9:00 in Paris
  await app.detectEvents();
  const [due] = events(gladys, TRIGGERS.FERTILISATION_DUE);
  assert.equal(due.data.plant_name, 'Monstera');
  assert.equal(due.data.due_date, '2026-11-01');
  assert.equal(due.data.last_fertilised, '2026-09-20');
});

test('scene action refresh: reads now (once a minute), outputs only declared, no event from it', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.update(102, { measure: 'light', current: '5', level: 1, receivedAt: '2026-10-25 10:02:00' });
  clock.now += 2 * MINUTE;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, { plant_count: 3, care_count: 3 });
  assert.ok(Object.keys(ack.data.outputs).every((key) => REFRESH_OUTPUTS.includes(key)));
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never an event because of a scene action');
  const count = fake.calls.length;
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(fake.calls.length, count, 'once a minute at most');
  await app.detectEvents();
  assert.deepEqual(
    events(gladys, TRIGGERS.MEASURE_OUT_OF_RANGE).map((e) => e.data.measure),
    ['light'],
  );
});

test('scene actions get_plant and get_care_summary answer from what was read', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  const count = fake.calls.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PLANT, { plant: id(101) });
  assert.equal(ack.success, true);
  const plant = { data: ack.data.outputs };
  assert.ok(Object.keys(plant.data).every((key) => PLANT_OUTPUTS.includes(key)));
  assert.equal(plant.data.plant_name, 'Monstera');
  assert.equal(plant.data.moisture, 18);
  assert.equal(plant.data.moisture_state, 'too_low');
  assert.equal(plant.data.salinity, 0.45);
  assert.equal(plant.data.needs_attention, true);
  assert.equal(plant.data.hours_without_data, 0.3);
  assert.equal(
    plant.data.summary,
    'Monstera: Needs attention, Soil moisture: too low, Salinity: low, Nutrients: low. Soil moisture 18 % (Too low), light 120 µmol/m²/s, temperature 21.5 °C, salinity 0.45 mS/cm, battery 64 %.',
  );
  const first = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PLANT, {});
  assert.equal(first.data.outputs.plant_name, 'Monstera', 'the first plant by default');
  const summary = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_CARE_SUMMARY, {});
  assert.ok(Object.keys(summary.data.outputs).every((key) => CARE_OUTPUTS.includes(key)));
  assert.deepEqual(summary.data.outputs, {
    care_count: 1,
    plant_count: 3,
    silent_count: 1,
    summary:
      'Monstera: Soil moisture: too low, Salinity: low, Nutrients: low; Ficus: no measurement for 5 h',
  });
  assert.equal(fake.calls.length, count, 'no request');
});

test('widgets: plants to care for, one plant with its picture (Bearer to fyta.de), refresh button', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  fake.addImage('https://web.fyta.de/storage/user-plants/101/thumb.jpg');
  await app.tick();
  const care = await gladys.fake.widgetGet(WIDGETS.CARE, { language: 'fr' });
  assert.equal(care.success, true);
  assert.deepEqual(validateWidgetContent(care.data.content), []);
  const list = care.data.content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Monstera', 'Ficus'],
  );
  const plant = await gladys.fake.widgetGet(WIDGETS.PLANT, { settings: { plant: id(101) } });
  assert.deepEqual(validateWidgetContent(plant.data.content), []);
  const image = plant.data.content.components.find((c) => c.type === 'image');
  assert.match(image.key, /^plant-101-[0-9a-f]{12}$/);
  const served = await gladys.fake.widgetGetImage(image.key);
  assert.equal(served.success, true);
  assert.equal(served.data.image, PNG.toString('base64'));
  assert.deepEqual(validateWidgetImage(served.data.image), []);
  const [download] = fake.callsTo('https://web.fyta.de/storage/user-plants/101/thumb.jpg');
  assert.match(download.headers.authorization, /^Bearer /);
  // No picture at all for the Ficus: no image component, no request.
  const ficus = await gladys.fake.widgetGet(WIDGETS.PLANT, { settings: { plant: id(103) } });
  assert.ok(!ficus.data.content.components.some((c) => c.type === 'image'));
  // The Basilic's species picture fails: tried once, then not for 6 hours.
  const basil = 'https://plants.example.org/species/basil-thumb.jpg';
  await gladys.fake.widgetGet(WIDGETS.PLANT, { settings: { plant: id(102) } });
  await gladys.fake.widgetGet(WIDGETS.PLANT, { settings: { plant: id(102) } });
  assert.equal(fake.callsTo(basil).length, 1);
  // The button.
  clock.now += 2 * MINUTE;
  const toast = await gladys.fake.widgetAction(WIDGETS.CARE, WIDGET_ACTIONS.REFRESH, {}, {});
  assert.equal(toast.success, true);
  assert.match(JSON.stringify(toast.data), /FYTA read: 3 plant\(s\)\./);
  const again = await gladys.fake.widgetAction(WIDGETS.CARE, WIDGET_ACTIONS.REFRESH, {}, {});
  assert.match(JSON.stringify(again.data), /less than a minute/);
  assert.ok(gladys.fake.widgetRefreshes.length > 0);
});

test('widgets before the configuration, and the automatic language follows the widgets', async (t) => {
  const { gladys, app } = await startApp(t, { config: { language: 'auto' } });
  const empty = await gladys.fake.widgetGet(WIDGETS.PLANT, { language: 'de' });
  assert.deepEqual(validateWidgetContent(empty.data.content), []);
  assert.match(JSON.stringify(empty.data.content), /E-Mail-Adresse/);
  assert.equal(gladys.fake.config.last_language, 'de');
  assert.equal(app.getConfig().language, 'auto');
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('a wrong password: status, one access_refused event, no retry before 30 minutes, then fixed', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t, {
    config: { ...CONFIG, password: 'not-the-password' },
  });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the password/);
  const [refused] = events(gladys, TRIGGERS.ACCESS_REFUSED);
  assert.equal(refused.data.reason, 'wrong_password');
  const count = fake.calls.length;
  clock.now += 15 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, count, 'no retry before 30 minutes');
  clock.now += ACCESS_RETRY_MS;
  await app.tick();
  assert.equal(fake.calls.length, count + 1, 'one new try');
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  const widget = await gladys.fake.widgetGet(WIDGETS.CARE, { language: 'es' });
  assert.match(JSON.stringify(widget.data.content), /contraseña/);
  await gladys.fake.configUpdated({ ...CONFIG });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('an unknown e-mail address and a token refused even after a new login', async (t) => {
  const unknown = await startApp(t, { config: { ...CONFIG, email: 'nobody@example.org' } });
  await unknown.app.tick();
  assert.equal(events(unknown.gladys, TRIGGERS.ACCESS_REFUSED)[0].data.reason, 'unknown_account');
  assert.match(unknown.gladys.fake.connectionStatus.message.fr, /ne connaît pas cette adresse/);
  const fake = createFakeFyta();
  fake.failures['/user-plant'] = { status: 403, body: { Message: 'denied' }, times: 2 };
  const denied = await startApp(t, { fake });
  await denied.app.tick();
  assert.equal(events(denied.gladys, TRIGGERS.ACCESS_REFUSED)[0].data.reason, 'token');
  assert.equal(fake.logins, 2);
});

test('test the connection: the plants with a sensor, those without; or why it fails', async (t) => {
  const { gladys } = await startApp(t);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connected to FYTA: 3 plant(s) with a sensor (Monstera, Basilic, Ficus). 1 plant(s) without a sensor left out.',
  );
  assert.equal(gladys.fake.discoveredDevices.length, 3);
  const wrong = await startApp(t, { config: { ...CONFIG, password: 'not-the-password' } });
  const refused = await wrong.gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.match(refused.data.message.de, /Passwort abgelehnt/);
  const none = await startApp(t, { config: {} });
  const missing = await none.gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.match(missing.data.message.en, /e-mail address and the password/);
  assert.equal(none.fake.calls.length, 0);
});

test('another account: the plants of the previous one are forgotten', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  fake.email = 'other@example.org';
  fake.account.plants.plants = fake.account.plants.plants.filter((plant) => plant.id === 102);
  await gladys.fake.configUpdated({ ...CONFIG, email: 'other@example.org' });
  assert.equal(app.sensorPlants().length, 0);
  await app.tick();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Basilic'],
  );
  assert.equal(fake.logins, 2);
});

test('a plant removed from FYTA disappears from the discovery; a scan publishes again', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.account.plants.plants = fake.account.plants.plants.filter((plant) => plant.id !== 103);
  clock.now += 15 * MINUTE;
  await app.tick();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Monstera', 'Basilic'],
  );
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('a pH given once makes the pH feature appear, and it stays', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  fake.account.details[102].plant.measurements.ph.values.current = '6.5';
  fake.update(102, { receivedAt: '2026-10-25 09:50:00' });
  await app.tick();
  const basil = gladys.fake.discoveredDevices.find((device) => device.name === 'Basilic');
  assert.ok(basil.features.some((feature) => feature.external_id === id(102, 'ph')));
  fake.account.details[102].plant.measurements.ph.values.current = null;
  fake.update(102, { receivedAt: '2026-10-25 10:10:00' });
  clock.now += 15 * MINUTE;
  await app.tick();
  const again = gladys.fake.discoveredDevices.find((device) => device.name === 'Basilic');
  assert.ok(again.features.some((feature) => feature.external_id === id(102, 'ph')));
});

test('unchanged values of a sensor still reporting are re-sent every 6 hours, not those of a silent one', async (t) => {
  const { gladys, app } = await startApp(t);
  await app.tick();
  await createAll(gladys);
  const calls = [];
  const original = gladys.publishChangedStates.bind(gladys);
  t.mock.method(gladys, 'publishChangedStates', async (states, options) => {
    calls.push({ plant: states[0].device_feature_external_id.split(':')[3], options });
    return original(states, options);
  });
  await gladys.fake.deviceCreated(structuredClone(gladys.fake.discoveredDevices[0]));
  assert.deepEqual(calls, [
    { plant: '101', options: { heartbeat: HEARTBEAT_MS } },
    { plant: '102', options: { heartbeat: HEARTBEAT_MS } },
    { plant: '103', options: {} },
  ]);
});
