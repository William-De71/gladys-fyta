// -----------------------------------------------------------------------------
// The answers of the FYTA API made safe: a value FYTA does not give is null,
// never 0. Fields read (official documentation and fyta_cli, the library of
// Home Assistant, model `Plant` and its `__pre_deserialize__`):
//
// GET user-plant -> { gardens: [{ id, garden_name }], plants: [{ id, nickname,
//   scientific_name, status, received_data_at, temperature_status,
//   light_status, moisture_status, salinity_status, garden: { id },
//   sensor: { id, has_sensor, status, version, is_battery_low,
//   received_data_at }, hub: {...} }] }
//
// GET user-plant/{id} -> { plant: { id, nickname, scientific_name, status,
//   thumb_path, origin_path (the picture of the user), plant_thumb_path,
//   plant_origin_path (the picture of the species), received_data_at,
//   is_productive_plant, sensor_update_available, garden: { id, name },
//   sensor: {...} | null, hub: {...} | null,
//   measurements: { ph: { values: { current } }, nutrients: { status },
//     temperature | light | moisture | salinity: { status, values: { current,
//     min_good, max_good, min_acceptable, max_acceptable }, unit },
//     battery: "100" },
//   fertilisation: { last_fertilised_at, fertilise_at, was_repotted },
//   temperature_unit } }
//
// The numbers come as strings ("61", "0.6"), sometimes null. The dates come
// as "2023-01-01 10:10:00" without a timezone: read as UTC (the measurements
// endpoint calls the same format `date_utc`). An impossible date
// ("2023-01-00", seen in the documentation) is null.
//
// Statuses (documentation, tables "FYTA User Plant Status" and "FYTA
// Measurement Status"): plant 0 deleted, 1 good, 2 bad (needs attention),
// 3 no sensor; measurement 0 no data, 1 too low, 2 low, 3 perfect, 4 high,
// 5 too high. Sensor 0 none, 1 correct (data less than 1.5 h old), 2 error.
// -----------------------------------------------------------------------------

const MEASURES = ['moisture', 'light', 'temperature', 'salinity'];
// The measures with a status, in the order of the widgets (nutrients: a
// status only, no value).
const STATUS_MEASURES = ['moisture', 'light', 'temperature', 'salinity', 'nutrients'];

const LEVELS = {
  NO_DATA: 0,
  TOO_LOW: 1,
  LOW: 2,
  PERFECT: 3,
  HIGH: 4,
  TOO_HIGH: 5,
};
const LEVEL_KEYS = ['no_data', 'too_low', 'low', 'perfect', 'high', 'too_high'];

const PLANT_STATUS = { DELETED: 0, GOOD: 1, BAD: 2, NO_SENSOR: 3 };
const PLANT_STATUS_KEYS = ['deleted', 'doing_great', 'needs_attention', 'no_sensor'];

/**
 * @description A number from FYTA ("61", 61, null).
 * @param {unknown} value - The value.
 * @returns {number|null} The number, null when absent.
 */
function num(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

/**
 * @description An integer status, 0 when unknown.
 * @param {unknown} value - The value.
 * @param {number} max - The largest status.
 * @returns {number} The status.
 */
function statusOf(value, max) {
  const number = num(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : 0;
}

/**
 * @description A date-time of FYTA ("2023-01-01 10:10:00", UTC) in ms.
 * @param {unknown} value - The value.
 * @returns {number|null} The instant, null when absent or impossible.
 */
function readInstant(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
    );
  if (!match) {
    return null;
  }
  const [, y, mo, d, h = '0', mi = '0', s = '0', zone] = match;
  const fields = [y, mo, d, h, mi, s].map(Number);
  const utc = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== fields[0] ||
    check.getUTCMonth() !== fields[1] - 1 ||
    check.getUTCDate() !== fields[2] ||
    fields[3] > 23 ||
    fields[4] > 59 ||
    fields[5] > 59
  ) {
    return null;
  }
  if (!zone || zone === 'Z') {
    return utc;
  }
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const offset = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60000;
  return utc - sign * offset;
}

/**
 * @description A calendar date of FYTA ("2025-01-11"), checked.
 * @param {unknown} value - The value.
 * @returns {string|null} "YYYY-MM-DD", null when absent or impossible.
 */
function readDay(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const day = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || readInstant(day) === null) {
    return null;
  }
  return day;
}

/**
 * @description A text of FYTA, trimmed and bounded.
 * @param {unknown} value - The value.
 * @param {number} [max] - The bound.
 * @returns {string} The text ('' when absent).
 */
function text(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * @description An https URL of a picture, else null ("<url>" in the documentation).
 * @param {unknown} value - The value.
 * @returns {string|null} The URL.
 */
function pictureUrl(value) {
  const url = text(value, 2000);
  if (!/^https:\/\/\S+$/i.test(url)) {
    return null;
  }
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

/**
 * @description An integer id.
 * @param {unknown} value - The value.
 * @returns {number|null} The id.
 */
function idOf(value) {
  const number = num(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

/**
 * @description Whether a measurement unit of FYTA is Fahrenheit ("°F/h").
 * @param {unknown} unit - The unit text.
 * @returns {boolean} True for Fahrenheit.
 */
const isFahrenheit = (unit) => /^\s*°?\s*F\b/i.test(String(unit ?? ''));

/**
 * @description Degrees Fahrenheit to Celsius, one decimal.
 * @param {number|null} value - °F.
 * @returns {number|null} °C.
 */
const toCelsius = (value) =>
  Number.isFinite(value) ? Math.round((((value - 32) * 5) / 9) * 10) / 10 : null;

/**
 * @description One measurement of a plant: its value, status and ranges.
 * @param {object} raw - `measurements.<name>`.
 * @param {boolean} [fahrenheit] - Convert from °F.
 * @returns {object} `{ value, status, minGood, maxGood, minAcceptable, maxAcceptable }`.
 */
function measureOf(raw, fahrenheit = false) {
  const values = raw && typeof raw === 'object' && raw.values ? raw.values : {};
  const convert = fahrenheit ? toCelsius : (value) => value;
  return {
    value: convert(num(values.current)),
    status: statusOf(raw?.status, 5),
    minGood: convert(num(values.min_good)),
    maxGood: convert(num(values.max_good)),
    minAcceptable: convert(num(values.min_acceptable)),
    maxAcceptable: convert(num(values.max_acceptable)),
  };
}

/**
 * @description The sensor of a plant, null when the plant has none.
 * @param {object} raw - `sensor`.
 * @returns {object|null} `{ id, version, status, batteryLow, receivedAt }`.
 */
function sensorOf(raw) {
  if (!raw || typeof raw !== 'object' || raw.has_sensor === false) {
    return null;
  }
  const id = text(raw.id, 64);
  if (!id && raw.has_sensor !== true) {
    return null;
  }
  return {
    id: id || null,
    version: text(raw.version, 32) || null,
    status: statusOf(raw.status, 2),
    batteryLow: raw.is_battery_low === true,
    receivedAt: readInstant(raw.received_data_at),
  };
}

/**
 * @description The hub a plant reports through, null when none.
 * @param {object} raw - `hub`.
 * @returns {object|null} `{ id, status, receivedAt }`.
 */
function hubOf(raw) {
  if (!raw || typeof raw !== 'object' || (!raw.hub_id && !raw.id)) {
    return null;
  }
  return {
    id: text(raw.hub_id, 64) || null,
    status: statusOf(raw.status, 2),
    receivedAt: readInstant(raw.received_data_at),
  };
}

/**
 * @description The list of the plants of the account (GET user-plant).
 * @param {object} body - The answer.
 * @returns {object[]} `[{ id, name, scientificName, status, gardenId, gardenName,
 * hasSensor, receivedAt, signature }]`.
 */
function parsePlantList(body) {
  const gardens = new Map(
    (Array.isArray(body?.gardens) ? body.gardens : [])
      .filter((garden) => idOf(garden?.id) !== null)
      .map((garden) => [idOf(garden.id), text(garden.garden_name ?? garden.name, 100)]),
  );
  const plants = Array.isArray(body?.plants) ? body.plants : [];
  return plants
    .filter((raw) => raw && typeof raw === 'object' && idOf(raw.id) !== null)
    .map((raw) => {
      const sensor = sensorOf(raw.sensor);
      const gardenId = idOf(raw.garden?.id);
      const status = statusOf(raw.status, 3);
      return {
        id: idOf(raw.id),
        name: text(raw.nickname),
        scientificName: text(raw.scientific_name),
        status,
        gardenId,
        gardenName: gardenId === null ? '' : (gardens.get(gardenId) ?? ''),
        hasSensor: Boolean(sensor),
        receivedAt: readInstant(raw.received_data_at) ?? sensor?.receivedAt ?? null,
        // What tells that the details changed: a new measurement, a status, the battery.
        signature: JSON.stringify([
          raw.received_data_at ?? null,
          raw.sensor?.received_data_at ?? null,
          raw.status ?? null,
          raw.temperature_status ?? null,
          raw.light_status ?? null,
          raw.moisture_status ?? null,
          raw.salinity_status ?? null,
          raw.sensor?.is_battery_low ?? null,
          raw.nickname ?? null,
        ]),
      };
    });
}

/**
 * @description One plant with its measurements (GET user-plant/{id}).
 * @param {object} body - The answer `{ plant }`.
 * @returns {object|null} The plant, null when the answer has none.
 */
function parsePlant(body) {
  const raw = body?.plant;
  const id = idOf(raw?.id);
  if (!raw || typeof raw !== 'object' || id === null) {
    return null;
  }
  const measurements =
    raw.measurements && typeof raw.measurements === 'object' ? raw.measurements : {};
  // The unit of the measurement says °C or °F; `temperature_unit` (1 °C,
  // 2 °F) is the preference of the account. Gladys gets °C always.
  const fahrenheit = isFahrenheit(measurements.temperature?.unit);
  const measures = {};
  for (const name of MEASURES) {
    measures[name] = measureOf(measurements[name], name === 'temperature' && fahrenheit);
  }
  measures.nutrients = {
    value: null,
    status: statusOf(measurements.nutrients?.status, 5),
    minGood: null,
    maxGood: null,
    minAcceptable: null,
    maxAcceptable: null,
  };
  const sensor = sensorOf(raw.sensor);
  const fertilisation =
    raw.fertilisation && typeof raw.fertilisation === 'object' ? raw.fertilisation : {};
  return {
    id,
    name: text(raw.nickname),
    scientificName: text(raw.scientific_name),
    status: statusOf(raw.status, 3),
    gardenName: text(raw.garden?.name),
    productive: raw.is_productive_plant === true,
    sensor,
    hub: hubOf(raw.hub),
    receivedAt: sensor?.receivedAt ?? readInstant(raw.received_data_at),
    sensorUpdate: raw.sensor_update_available === true,
    measures,
    ph: num(measurements.ph?.values?.current),
    battery: num(measurements.battery),
    fertilisation: {
      last: readDay(fertilisation.last_fertilised_at),
      next: readDay(fertilisation.fertilise_at),
    },
    pictures: {
      user: pictureUrl(raw.thumb_path),
      userLarge: pictureUrl(raw.origin_path),
      species: pictureUrl(raw.plant_thumb_path),
      speciesLarge: pictureUrl(raw.plant_origin_path),
    },
  };
}

/**
 * @description The measures out of their perfect range, worst first.
 * @param {object} plant - parsePlant().
 * @returns {Array<{ measure: string, level: number }>} The problems.
 */
function problemsOf(plant) {
  const severity = (level) =>
    level === LEVELS.TOO_LOW || level === LEVELS.TOO_HIGH ? 2 : level === LEVELS.PERFECT ? 0 : 1;
  return STATUS_MEASURES.map((measure) => ({
    measure,
    level: plant?.measures?.[measure]?.status ?? LEVELS.NO_DATA,
  }))
    .filter(({ level }) => level !== LEVELS.NO_DATA && level !== LEVELS.PERFECT)
    .sort((a, b) => severity(b.level) - severity(a.level));
}

export {
  MEASURES,
  STATUS_MEASURES,
  LEVELS,
  LEVEL_KEYS,
  PLANT_STATUS,
  PLANT_STATUS_KEYS,
  num,
  readInstant,
  readDay,
  pictureUrl,
  isFahrenheit,
  toCelsius,
  parsePlantList,
  parsePlant,
  problemsOf,
};
