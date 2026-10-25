import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlant, LEVELS } from '../src/parse.js';
import {
  TRIGGERS,
  detectPlant,
  eventData,
  problemsText,
  pick,
  rounded,
  isFresh,
} from '../src/events.js';

const account = JSON.parse(
  readFileSync(new URL('./fixtures/account.json', import.meta.url), 'utf8'),
);
const NOW = Date.parse('2026-10-25T10:00:00Z');
const HOUR = 3600 * 1000;
const CONTEXT = { now: NOW, offlineMs: 3 * HOUR, today: '2026-10-25', hour: 11 };
const plant = (id) => parsePlant(structuredClone(account.details[id]));
const keys = (found) => found.events.map((event) => event.key);
const VIEW = {
  deviceId: 'ext:fyta:plant:101',
  name: 'Monstera',
  id: 101,
  scientificName: 'Monstera deliciosa',
};

/**
 * @description Run the detection twice: a first reading, then a changed one.
 * @param {object} before - The plant first read.
 * @param {object} after - The plant read next.
 * @param {object} [context] - The context of the second reading.
 * @returns {object} The result of the second detection.
 */
function twice(before, after, context = CONTEXT) {
  const first = detectPlant({}, before, CONTEXT);
  assert.deepEqual(first.events, [], 'never at the first reading');
  return detectPlant(first.next, after, context);
}

test('nothing at the first reading, nothing when nothing changes', () => {
  const first = detectPlant({}, plant(101), CONTEXT);
  assert.deepEqual(first.events, []);
  assert.equal(first.next.known, true);
  assert.deepEqual(detectPlant(first.next, plant(101), CONTEXT).events, []);
});

test('the soil gets dry: thirsty and out of range, once; then back in range', () => {
  const wet = plant(102);
  const dry = plant(102);
  dry.measures.moisture = { ...dry.measures.moisture, value: 30, status: LEVELS.LOW };
  const found = twice(wet, dry);
  assert.deepEqual(keys(found), [TRIGGERS.MEASURE_OUT_OF_RANGE, TRIGGERS.PLANT_THIRSTY]);
  assert.deepEqual(found.events[0].extra, { measure: 'moisture', level: LEVELS.LOW });
  // Low -> too low: out of range again (another level), not thirsty again.
  const drier = plant(102);
  drier.measures.moisture = { ...drier.measures.moisture, value: 20, status: LEVELS.TOO_LOW };
  const next = detectPlant(found.next, drier, CONTEXT);
  assert.deepEqual(keys(next), [TRIGGERS.MEASURE_OUT_OF_RANGE]);
  const watered = detectPlant(next.next, wet, CONTEXT);
  assert.deepEqual(keys(watered), [TRIGGERS.MEASURE_BACK_IN_RANGE]);
  assert.deepEqual(watered.events[0].extra, { measure: 'moisture', previous: LEVELS.TOO_LOW });
});

test('"no data" changes nothing: the level known before is kept', () => {
  const before = plant(102);
  const blank = plant(102);
  blank.measures.light.status = LEVELS.NO_DATA;
  const found = twice(before, blank);
  assert.deepEqual(found.events, []);
  assert.equal(found.next.levels.light, LEVELS.PERFECT);
});

test('doing great -> needs attention fires; the opposite does not', () => {
  const good = plant(102);
  const bad = plant(102);
  bad.status = 2;
  assert.deepEqual(keys(twice(good, bad)), [TRIGGERS.PLANT_NEEDS_ATTENTION]);
  assert.deepEqual(keys(twice(bad, good)), []);
});

test('battery low once, when FYTA raises its flag', () => {
  const ok = plant(102);
  const low = plant(102);
  low.sensor.batteryLow = true;
  const found = twice(ok, low);
  assert.deepEqual(keys(found), [TRIGGERS.SENSOR_BATTERY_LOW]);
  assert.deepEqual(detectPlant(found.next, low, CONTEXT).events, []);
});

test('a silent sensor: once after the delay, back when a measurement arrives', () => {
  const fresh = plant(102);
  const first = detectPlant({}, fresh, CONTEXT);
  const later = { ...CONTEXT, now: fresh.receivedAt + 3 * HOUR + 60 * 1000 };
  const silent = detectPlant(first.next, fresh, later);
  assert.deepEqual(keys(silent), [TRIGGERS.SENSOR_SILENT]);
  assert.equal(silent.next.silentSince, fresh.receivedAt);
  assert.deepEqual(detectPlant(silent.next, fresh, { ...later, now: later.now + HOUR }).events, []);
  const back = plant(102);
  back.receivedAt = later.now + 2 * HOUR;
  const found = detectPlant(silent.next, back, { ...later, now: back.receivedAt + 1000 });
  assert.deepEqual(keys(found), [TRIGGERS.SENSOR_BACK]);
  assert.deepEqual(found.events[0].extra, { silentSince: fresh.receivedAt });
  // Silent at the first reading: nothing announced.
  assert.deepEqual(detectPlant({}, plant(103), CONTEXT).events, []);
  assert.equal(detectPlant({}, plant(103), CONTEXT).next.silent, true);
});

test('fertilizing: once per date, from 9:00, never for a date already past at the first reading', () => {
  const before = plant(101);
  const first = detectPlant({}, before, { ...CONTEXT, today: '2026-10-31' });
  const early = detectPlant(first.next, before, { ...CONTEXT, today: '2026-11-01', hour: 8 });
  assert.deepEqual(early.events, [], 'before 9:00');
  const due = detectPlant(early.next, before, { ...CONTEXT, today: '2026-11-01', hour: 9 });
  assert.deepEqual(keys(due), [TRIGGERS.FERTILISATION_DUE]);
  assert.deepEqual(due.events[0].extra, { due: '2026-11-01' });
  assert.deepEqual(
    detectPlant(due.next, before, { ...CONTEXT, today: '2026-11-02', hour: 9 }).events,
    [],
  );
  const late = detectPlant({}, before, { ...CONTEXT, today: '2026-11-05' });
  assert.deepEqual(late.events, []);
  assert.deepEqual(detectPlant(late.next, before, { ...CONTEXT, today: '2026-11-05' }).events, []);
  // A new date planned after the fertilizing.
  const moved = plant(101);
  moved.fertilisation.next = '2026-11-29';
  assert.deepEqual(
    keys(detectPlant(due.next, moved, { ...CONTEXT, today: '2026-11-29', hour: 10 })),
    [TRIGGERS.FERTILISATION_DUE],
  );
});

test('event data: flat, 30 keys at most, scalars, strings of 1,000 characters at most', () => {
  const monstera = plant(101);
  const cases = [
    { key: TRIGGERS.MEASURE_OUT_OF_RANGE, extra: { measure: 'moisture', level: LEVELS.TOO_LOW } },
    { key: TRIGGERS.MEASURE_BACK_IN_RANGE, extra: { measure: 'light', previous: LEVELS.LOW } },
    { key: TRIGGERS.PLANT_THIRSTY, extra: { level: LEVELS.TOO_LOW } },
    { key: TRIGGERS.PLANT_NEEDS_ATTENTION, extra: {} },
    { key: TRIGGERS.SENSOR_BATTERY_LOW, extra: {} },
    { key: TRIGGERS.SENSOR_SILENT, extra: {} },
    { key: TRIGGERS.SENSOR_BACK, extra: { silentSince: NOW - 5 * HOUR } },
    { key: TRIGGERS.FERTILISATION_DUE, extra: { due: '2026-11-01' } },
  ];
  for (const event of cases) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const data = eventData(VIEW, monstera, event, { language, now: NOW });
      assert.ok(Object.keys(data).length <= 30, event.key);
      for (const [key, value] of Object.entries(data)) {
        assert.ok(
          value === null ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value)) ||
            (typeof value === 'string' && value.length <= 1000),
          `${event.key}.${key}`,
        );
      }
      assert.equal(data.plant, 'ext:fyta:plant:101');
      assert.equal(data.plant_name, 'Monstera');
    }
  }
  const out = eventData(VIEW, monstera, cases[0], { language: 'fr', now: NOW });
  assert.deepEqual(
    pick(out, [
      'measure',
      'measure_label',
      'level',
      'level_label',
      'value',
      'unit',
      'min_good',
      'max_good',
    ]),
    {
      measure: 'moisture',
      measure_label: 'Humidité du sol',
      level: 'too_low',
      level_label: 'Trop faible',
      value: 18,
      unit: '%',
      min_good: 35,
      max_good: 70,
    },
  );
  const back = eventData(VIEW, monstera, cases[6], { language: 'en', now: NOW });
  assert.equal(
    back.hours_without_data,
    4.7,
    'from the last measurement before the silence to the new one',
  );
  assert.equal(back.last_measurement_at, '2026-10-25T09:40:00.000Z');
  const attention = eventData(VIEW, monstera, cases[3], { language: 'en', now: NOW });
  assert.equal(attention.problems, 'Soil moisture: too low, Salinity: low, Nutrients: low');
  assert.equal(attention.problem_count, 3);
});

test('helpers', () => {
  assert.equal(problemsText(plant(102), 'en'), '');
  assert.equal(rounded(1.26, 1), 1.3);
  assert.equal(rounded(null), null);
  assert.deepEqual(pick({ a: 1, b: null, c: 'x' }, ['a', 'b']), { a: 1 });
  assert.equal(isFresh(plant(101), NOW, 3 * HOUR), true);
  assert.equal(isFresh(plant(103), NOW, 3 * HOUR), false);
  assert.equal(isFresh(plant(103), NOW, 6 * HOUR), true);
});
