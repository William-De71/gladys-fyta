// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): should_poll with poll_frequency, min /
// max / read_only / has_feedback on every feature, category / type / unit
// pairs the core knows (DEVICE_FEATURE_UNITS_BY_CATEGORY of
// server/utils/constants.js and the icons of front/src/utils/consts.js, read
// on master 2026-10-23), and a single invalid field rejecting the whole
// discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  plantIds,
  plantOfExternalId,
  plantFeatureKeys,
  plantName,
  buildPlantDevice,
  buildPlantStates,
  PLANT_FEATURES,
} from '../src/device.js';
import { parsePlant } from '../src/parse.js';
import { LANGUAGES } from '../src/i18n.js';

const account = JSON.parse(
  readFileSync(new URL('./fixtures/account.json', import.meta.url), 'utf8'),
);
const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:fyta:${type}:${id}`,
    feature: (key) => `ext:fyta:${type}:${id}:${key}`,
  }),
};
const MONSTERA = parsePlant(account.details[101]);
const FICUS = parsePlant(account.details[103]);

// The units the core accepts per category (DEVICE_FEATURE_UNITS_BY_CATEGORY);
// `null`: the category has no unit list (text, battery-low), or the feature
// has no unit on purpose (light: FYTA gives µmol/m²/s, the core knows lux only).
const UNITS_BY_CATEGORY = {
  [C.SOIL_MOISTURE_SENSOR]: [U.PERCENT],
  [C.LIGHT_SENSOR]: [U.LUX, null],
  [C.TEMPERATURE_SENSOR]: [U.CELSIUS, U.FAHRENHEIT, U.KELVIN],
  [C.PH_SENSOR]: [U.PH],
  [C.BATTERY]: [U.PERCENT],
  [C.BATTERY_LOW]: [null],
  [C.TEXT]: [null],
};
// The pairs with an icon in the dashboard (front/src/utils/consts.js).
const PAIRS = {
  moisture: [C.SOIL_MOISTURE_SENSOR, T.SENSOR.DECIMAL, U.PERCENT],
  light: [C.LIGHT_SENSOR, T.SENSOR.DECIMAL, null],
  temperature: [C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, U.CELSIUS],
  ph: [C.PH_SENSOR, T.PH_SENSOR.DECIMAL, U.PH],
  battery: [C.BATTERY, T.BATTERY.INTEGER, U.PERCENT],
  battery_low: [C.BATTERY_LOW, T.BATTERY_LOW.BINARY, null],
  plant_status: [C.TEXT, T.TEXT.TEXT, null],
  moisture_status: [C.TEXT, T.TEXT.TEXT, null],
  light_status: [C.TEXT, T.TEXT.TEXT, null],
  temperature_status: [C.TEXT, T.TEXT.TEXT, null],
  salinity_status: [C.TEXT, T.TEXT.TEXT, null],
  nutrients_status: [C.TEXT, T.TEXT.TEXT, null],
};
const keyOf = (feature) => feature.external_id.split(':').pop();

test('devices are never polled by Gladys: the integration has its own timer', () => {
  const device = buildPlantDevice(fakeGladys, MONSTERA);
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const ph of [false, true]) {
      const device = buildPlantDevice(fakeGladys, MONSTERA, { language, ph });
      for (const feature of device.features) {
        assert.equal(typeof feature.min, 'number', feature.external_id);
        assert.equal(typeof feature.max, 'number', feature.external_id);
        assert.ok(feature.min <= feature.max);
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
        assert.equal(typeof feature.keep_history, 'boolean');
        assert.ok(feature.name.length > 0 && feature.name.length <= 100);
      }
      assert.equal(new Set(device.features.map((f) => f.name)).size, device.features.length);
    }
  }
});

test('category / type / unit pairs the core knows and shows', () => {
  const device = buildPlantDevice(fakeGladys, MONSTERA, { ph: true });
  assert.deepEqual(device.features.map(keyOf), Object.keys(PAIRS));
  for (const feature of device.features) {
    const key = keyOf(feature);
    assert.deepEqual([feature.category, feature.type, feature.unit], PAIRS[key], key);
    assert.ok(UNITS_BY_CATEGORY[feature.category].includes(feature.unit), key);
    if (feature.category === C.TEXT) {
      assert.deepEqual([feature.min, feature.max, feature.keep_history], [0, 0, false], key);
    }
  }
  const byKey = Object.fromEntries(device.features.map((feature) => [keyOf(feature), feature]));
  assert.deepEqual([byKey.moisture.min, byKey.moisture.max], [0, 100]);
  assert.deepEqual([byKey.battery.min, byKey.battery.max], [0, 100]);
  assert.deepEqual([byKey.battery_low.min, byKey.battery_low.max], [0, 1]);
  // Several features of one type: the dashboard shows their names, which say
  // what they measure (the light without a unit says it in its name).
  assert.match(byKey.light.name, /µmol\/m²\/s/);
});

test('the pH feature exists only for a plant FYTA gave a pH for', () => {
  assert.deepEqual(plantFeatureKeys(), [
    'moisture',
    'light',
    'temperature',
    'battery',
    'battery_low',
    'plant_status',
    'moisture_status',
    'light_status',
    'temperature_status',
    'salinity_status',
    'nutrients_status',
  ]);
  assert.ok(plantFeatureKeys({ ph: true }).includes('ph'));
  assert.equal(PLANT_FEATURES.filter((feature) => feature.optional).length, 1);
});

test('the device: nickname, stable ids from the FYTA plant id, params', () => {
  const device = buildPlantDevice(fakeGladys, MONSTERA, { language: 'fr' });
  assert.equal(device.name, 'Monstera');
  assert.equal(device.external_id, 'ext:fyta:plant:101');
  assert.equal(device.model, 'FYTA Beam');
  assert.deepEqual(device.params, [
    { name: 'FYTA_PLANT_ID', value: '101' },
    { name: 'FYTA_SCIENTIFIC_NAME', value: 'Monstera deliciosa' },
    { name: 'FYTA_GARDEN', value: 'Salon' },
    { name: 'FYTA_SENSOR_ID', value: 'C8:2B:96:00:01:01' },
  ]);
  assert.equal(plantOfExternalId('ext:fyta:plant:101'), 101);
  assert.equal(plantOfExternalId('ext:fyta:plant:101:moisture'), 101);
  assert.equal(plantOfExternalId('ext:other:site:3'), null);
  assert.equal(plantIds(fakeGladys, 7).feature('light'), 'ext:fyta:plant:7:light');
  assert.equal(plantName({ id: 9, name: '', scientificName: 'Ficus elastica' }), 'Ficus elastica');
  assert.equal(plantName({ id: 9, name: ' ', scientificName: '' }), 'FYTA 9');
});

test('states: numbers bounded and rounded, text states in the language, unknown values left out', () => {
  const states = buildPlantStates(fakeGladys, MONSTERA, { language: 'fr' });
  const byKey = Object.fromEntries(
    states.map((state) => [state.device_feature_external_id.split(':').pop(), state]),
  );
  assert.equal(byKey.moisture.state, 18);
  assert.equal(byKey.light.state, 120);
  assert.equal(byKey.temperature.state, 21.5);
  assert.equal(byKey.battery.state, 64);
  assert.equal(byKey.battery_low.state, 0);
  assert.equal(byKey.ph, undefined, 'no pH feature');
  assert.equal(byKey.plant_status.text, 'À surveiller');
  assert.equal(byKey.moisture_status.text, 'Trop faible');
  assert.equal(byKey.salinity_status.text, 'Faible');
  assert.equal(byKey.light_status.text, 'Parfait');
  const ficus = buildPlantStates(fakeGladys, FICUS, { language: 'de' });
  assert.equal(ficus.find((s) => s.device_feature_external_id.endsWith(':battery_low')).state, 1);
  assert.equal(
    ficus.find((s) => s.device_feature_external_id.endsWith(':light_status')).text,
    'Zu niedrig',
  );
  const empty = structuredClone(MONSTERA);
  empty.measures.moisture.value = null;
  empty.measures.light.value = 99999;
  const partial = buildPlantStates(fakeGladys, empty, { ph: true });
  assert.ok(!partial.some((s) => s.device_feature_external_id.endsWith(':moisture')));
  assert.ok(!partial.some((s) => s.device_feature_external_id.endsWith(':ph')));
  assert.equal(partial.find((s) => s.device_feature_external_id.endsWith(':light')).state, 3000);
});

test('the fake Gladys accepts the whole discovery batch and the states', async () => {
  const gladys = createFakeGladys({ selector: 'fyta' });
  await gladys.connect();
  const devices = [MONSTERA, FICUS].map((plant) => buildPlantDevice(gladys, plant, { ph: true }));
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  await gladys.publishStates(buildPlantStates(gladys, MONSTERA, { ph: true }));
  assert.equal(gladys.fake.lastState('ext:fyta:plant:101:moisture'), 18);
  assert.equal(gladys.fake.lastState('ext:fyta:plant:101:moisture_status'), 'Too low');
});
