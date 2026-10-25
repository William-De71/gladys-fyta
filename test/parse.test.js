import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  num,
  readInstant,
  readDay,
  pictureUrl,
  isFahrenheit,
  toCelsius,
  parsePlantList,
  parsePlant,
  problemsOf,
  LEVELS,
} from '../src/parse.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const doc = read('./fixtures/fyta-doc.json');
const account = read('./fixtures/account.json');

test('numbers come as strings or null: null stays null, never 0', () => {
  assert.equal(num('61'), 61);
  assert.equal(num('0.6'), 0.6);
  assert.equal(num(18), 18);
  assert.equal(num(null), null);
  assert.equal(num(''), null);
  assert.equal(num('n/a'), null);
  assert.equal(num(true), null);
});

test('dates without a timezone are UTC; impossible dates (2023-01-00 in the documentation) are null', () => {
  assert.equal(readInstant('2023-01-01 10:10:00'), Date.UTC(2023, 0, 1, 10, 10, 0));
  assert.equal(readInstant('2023-01-00 10:10:00'), null);
  assert.equal(readInstant('2026-10-25T09:40:00Z'), Date.UTC(2026, 9, 25, 9, 40));
  assert.equal(readInstant('2026-10-25T11:40:00+02:00'), Date.UTC(2026, 9, 25, 9, 40));
  assert.equal(readInstant(null), null);
  assert.equal(readInstant('yesterday'), null);
  assert.equal(readDay('2025-01-11'), '2025-01-11');
  assert.equal(readDay('2025-02-30'), null);
  assert.equal(readDay(null), null);
});

test('pictures: https URLs only ("<url>" in the documentation is none)', () => {
  assert.equal(pictureUrl('<url>'), null);
  assert.equal(pictureUrl('http://example.org/a.jpg'), null);
  assert.equal(pictureUrl('https://web.fyta.de/a.jpg'), 'https://web.fyta.de/a.jpg');
  assert.equal(pictureUrl(null), null);
});

test('the plant of the official documentation', () => {
  const plant = parsePlant(doc.plant);
  assert.equal(plant.id, 12);
  assert.equal(plant.name, 'Ficus benjamina 1');
  assert.equal(plant.scientificName, 'Ficus benjamina');
  assert.equal(plant.status, 2);
  assert.equal(plant.gardenName, 'Home');
  assert.deepEqual(plant.sensor, {
    id: 'AA:AA:AA:2B:AF:F4',
    version: '0.30.0',
    status: 1,
    batteryLow: false,
    receivedAt: Date.UTC(2023, 0, 1, 10, 10, 0),
  });
  assert.equal(plant.hub.receivedAt, null, '2023-01-00 is not a date');
  assert.deepEqual(plant.measures.moisture, {
    value: 61,
    status: 3,
    minGood: 35,
    maxGood: 70,
    minAcceptable: 25,
    maxAcceptable: 80,
  });
  assert.deepEqual([plant.measures.light.value, plant.measures.light.status], [2, LEVELS.TOO_LOW]);
  assert.deepEqual(
    [plant.measures.temperature.value, plant.measures.temperature.status],
    [18, LEVELS.LOW],
  );
  // `current` is the value; `currentFormatted` ("0.50") is a display text.
  assert.equal(plant.measures.salinity.value, 1);
  assert.equal(plant.measures.nutrients.status, LEVELS.NO_DATA, 'not in the documentation');
  assert.equal(plant.ph, null);
  assert.equal(plant.battery, 100);
  assert.deepEqual(plant.pictures, {
    user: null,
    userLarge: null,
    species: null,
    speciesLarge: null,
  });
  assert.deepEqual(plant.fertilisation, { last: null, next: null });
});

test('the list of the documentation is abbreviated (no id): nothing is invented from it', () => {
  assert.deepEqual(parsePlantList(doc.plants), []);
  assert.deepEqual(parsePlantList(null), []);
  assert.deepEqual(parsePlantList({ plants: 'x' }), []);
});

test('the list: gardens, sensors, a plant without sensor, a signature that follows the readings', () => {
  const list = parsePlantList(account.plants);
  assert.deepEqual(
    list.map(({ id, name, hasSensor, gardenName, status }) => [
      id,
      name,
      hasSensor,
      gardenName,
      status,
    ]),
    [
      [101, 'Monstera', true, 'Salon', 2],
      [102, 'Basilic', true, 'Salon', 1],
      [103, 'Ficus', true, 'Salon', 2],
      [104, 'Cactus', false, 'Salon', 3],
    ],
  );
  const changed = structuredClone(account.plants);
  changed.plants[0].received_data_at = '2026-10-25 10:40:00';
  assert.notEqual(parsePlantList(changed)[0].signature, list[0].signature);
  assert.equal(parsePlantList(changed)[1].signature, list[1].signature);
});

test('a plant without a sensor (sensor null, as fyta_cli skips it) has no sensor and no values', () => {
  const plant = parsePlant(account.details[104]);
  assert.equal(plant.sensor, null);
  assert.equal(plant.receivedAt, null);
  assert.equal(plant.measures.moisture.value, null);
  assert.deepEqual(problemsOf(plant), []);
  assert.equal(parsePlant({}), null);
  assert.equal(parsePlant({ plant: { nickname: 'no id' } }), null);
});

test('problems: the measures out of perfect, the worst first', () => {
  assert.deepEqual(problemsOf(parsePlant(account.details[101])), [
    { measure: 'moisture', level: LEVELS.TOO_LOW },
    { measure: 'salinity', level: LEVELS.LOW },
    { measure: 'nutrients', level: LEVELS.LOW },
  ]);
  assert.deepEqual(problemsOf(parsePlant(account.details[102])), []);
  assert.deepEqual(problemsOf(parsePlant(account.details[103])), [
    { measure: 'light', level: LEVELS.TOO_LOW },
    { measure: 'temperature', level: LEVELS.HIGH },
  ]);
});

test('a temperature in °F (account in Fahrenheit) is converted to °C, thresholds included', () => {
  assert.equal(isFahrenheit('°F/h'), true);
  assert.equal(isFahrenheit('°C/h'), false);
  assert.equal(toCelsius(64.4), 18);
  const raw = structuredClone(doc.plant);
  raw.plant.temperature_unit = 2;
  Object.assign(raw.plant.measurements.temperature, {
    unit: '°F/h',
    values: { ...raw.plant.measurements.temperature.values, current: '64.4', min_good: '62.6' },
  });
  const plant = parsePlant(raw);
  assert.equal(plant.measures.temperature.value, 18);
  assert.equal(plant.measures.temperature.minGood, 17);
  // `temperature_unit` alone (a preference) changes nothing when the unit says °C.
  const preference = structuredClone(doc.plant);
  preference.plant.temperature_unit = 2;
  assert.equal(parsePlant(preference).measures.temperature.value, 18);
});

test('a pH given by FYTA is read; an unknown status is "no data"', () => {
  const raw = structuredClone(account.details[101]);
  raw.plant.measurements.ph.values.current = '6.4';
  raw.plant.measurements.moisture.status = 9;
  const plant = parsePlant(raw);
  assert.equal(plant.ph, 6.4);
  assert.equal(plant.measures.moisture.status, LEVELS.NO_DATA);
});
