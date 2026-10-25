// -----------------------------------------------------------------------------
// Scene triggers and the keys of the scene actions.
//
// Triggers, once per transition, never at the first reading of a plant,
// never because of a scene action (the detection runs on the timer only):
//   - `plant_needs_attention`  FYTA's state of the plant goes from "doing
//                              great" to "needs attention";
//   - `plant_thirsty`          the soil moisture enters the low or too low
//                              range of the plant;
//   - `measure_out_of_range`   a measure (soil moisture, light, temperature,
//                              salinity, nutrients) changes to low, too low,
//                              high or too high;
//   - `measure_back_in_range`  a measure comes back to perfect;
//   - `sensor_battery_low`     FYTA flags the battery of the sensor low;
//   - `sensor_silent`          no new measurement for the delay of the
//                              configuration (3 h by default);
//   - `sensor_back`            measurements arrive again after that;
//   - `fertilisation_due`      the fertilizing date FYTA planned is reached
//                              (at 9:00, Gladys time);
//   - `access_refused`         FYTA refuses the e-mail address, the password
//                              or the access of the account.
// A value to compare (>, <) is a feature of the device, not a trigger.
// -----------------------------------------------------------------------------

import { LEVELS, LEVEL_KEYS, PLANT_STATUS, STATUS_MEASURES, problemsOf } from './parse.js';
import { t } from './i18n.js';
import { measureLevelLabel } from './device.js';

const TRIGGERS = {
  PLANT_NEEDS_ATTENTION: 'plant_needs_attention',
  PLANT_THIRSTY: 'plant_thirsty',
  MEASURE_OUT_OF_RANGE: 'measure_out_of_range',
  MEASURE_BACK_IN_RANGE: 'measure_back_in_range',
  SENSOR_BATTERY_LOW: 'sensor_battery_low',
  SENSOR_SILENT: 'sensor_silent',
  SENSOR_BACK: 'sensor_back',
  FERTILISATION_DUE: 'fertilisation_due',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = {
  REFRESH: 'refresh',
  GET_PLANT: 'get_plant',
  GET_CARE_SUMMARY: 'get_care_summary',
};

const REFRESH_OUTPUTS = ['plant_count', 'care_count'];
const PLANT_OUTPUTS = [
  'plant_name',
  'state',
  'needs_attention',
  'moisture',
  'moisture_state',
  'light',
  'light_state',
  'temperature',
  'temperature_state',
  'salinity',
  'salinity_state',
  'nutrients_state',
  'battery',
  'hours_without_data',
  'summary',
];
const CARE_OUTPUTS = ['care_count', 'plant_count', 'silent_count', 'summary'];
const ACCESS_REASONS = ['unknown_account', 'wrong_password', 'token'];
// The levels of `measure_out_of_range` (its `level` field).
const OUT_LEVELS = ['too_low', 'low', 'high', 'too_high'];
const DRY = [LEVELS.TOO_LOW, LEVELS.LOW];
// The fertilizing reminder fires from this local hour.
const FERTILISE_HOUR = 9;

const UNITS = {
  moisture: '%',
  light: 'µmol/m²/s',
  temperature: '°C',
  salinity: 'mS/cm',
  nutrients: '',
};

/**
 * @description Keep only the declared keys of an output object.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs (null / undefined left out).
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded for a scene, or null.
 * @param {number|null} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The value.
 */
function rounded(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description The problems of a plant in a line: "Soil moisture: too low, Light: low".
 * @param {object} plant - parsePlant().
 * @param {string} language - The language.
 * @returns {string} The line ('' when none).
 */
function problemsText(plant, language) {
  return problemsOf(plant)
    .map(({ measure, level }) =>
      t('problem', language, {
        measure: t(`measure_${measure}`, language),
        level: measureLevelLabel(measure, level, language).toLocaleLowerCase(language),
      }),
    )
    .join(', ');
}

/**
 * @description Whether a plant sends measurements lately.
 * @param {object} plant - parsePlant().
 * @param {number} now - Now (ms).
 * @param {number} offlineMs - The delay of the configuration.
 * @returns {boolean} True when fresh.
 */
const isFresh = (plant, now, offlineMs) =>
  Number.isFinite(plant?.receivedAt) && now - plant.receivedAt <= offlineMs;

/**
 * @description The transitions of a plant since what the triggers knew.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {object} plant - parsePlant().
 * @param {object} context - `{ now, offlineMs, today, hour }`: the local date
 * ("2026-10-25") and hour of Gladys.
 * @returns {{ events: Array<{ key: string, extra: object }>, next: object }}
 * The events (without the plant part of the data), the new knowledge.
 */
function detectPlant(seen = {}, plant, { now, offlineMs, today, hour }) {
  const first = !seen.known;
  const next = { ...seen, known: true, levels: { ...(seen.levels ?? {}) } };
  const events = [];
  const push = (key, extra = {}) => {
    if (!first) events.push({ key, extra });
  };

  // State of the plant (1 doing great, 2 needs attention).
  if (plant.status === PLANT_STATUS.GOOD || plant.status === PLANT_STATUS.BAD) {
    if (plant.status === PLANT_STATUS.BAD && seen.status === PLANT_STATUS.GOOD) {
      push(TRIGGERS.PLANT_NEEDS_ATTENTION);
    }
    next.status = plant.status;
  }

  // Measures: a "no data" status changes nothing.
  for (const measure of STATUS_MEASURES) {
    const level = plant.measures?.[measure]?.status ?? LEVELS.NO_DATA;
    if (level === LEVELS.NO_DATA) {
      continue;
    }
    const previous = seen.levels?.[measure];
    next.levels[measure] = level;
    if (!Number.isInteger(previous) || previous === level) {
      continue;
    }
    if (level === LEVELS.PERFECT) {
      push(TRIGGERS.MEASURE_BACK_IN_RANGE, { measure, previous });
    } else {
      push(TRIGGERS.MEASURE_OUT_OF_RANGE, { measure, level });
    }
    if (measure === 'moisture' && DRY.includes(level) && !DRY.includes(previous)) {
      push(TRIGGERS.PLANT_THIRSTY, { level });
    }
  }

  // Battery of the sensor.
  if (plant.sensor) {
    const low = plant.sensor.batteryLow === true;
    if (low && seen.batteryLow === false) {
      push(TRIGGERS.SENSOR_BATTERY_LOW);
    }
    next.batteryLow = low;
  }

  // Silence of the sensor.
  const fresh = isFresh(plant, now, offlineMs);
  if (!fresh && seen.silent === false) {
    push(TRIGGERS.SENSOR_SILENT);
  }
  if (fresh && seen.silent === true) {
    push(TRIGGERS.SENSOR_BACK, {
      silentSince: Number.isFinite(seen.silentSince) ? seen.silentSince : null,
    });
  }
  if (!fresh && seen.silent !== true) {
    // The last measurement before the silence (now when there was none).
    next.silentSince = Number.isFinite(plant.receivedAt) ? plant.receivedAt : now;
  }
  next.silent = !fresh;

  // Fertilizing date reached (once per date, from 9:00).
  const due = plant.fertilisation?.next ?? null;
  if (due && today >= due && seen.fertiliseFired !== due) {
    if (first || seen.fertiliseKnown !== true) {
      // Already due at the first reading: nothing to announce.
      next.fertiliseFired = due;
    } else if (today > due || hour >= FERTILISE_HOUR) {
      push(TRIGGERS.FERTILISATION_DUE, { due });
      next.fertiliseFired = due;
    }
  }
  next.fertiliseKnown = true;

  return { events, next };
}

/**
 * @description The common part of the data of a plant event.
 * @param {object} view - `{ deviceId, name, id, scientificName }`.
 * @returns {object} The data.
 */
function plantData(view) {
  return {
    plant: view.deviceId,
    plant_name: String(view.name ?? '').slice(0, 1000),
    plant_id: view.id,
    scientific_name: String(view.scientificName ?? '').slice(0, 1000),
  };
}

/**
 * @description The data of an event of a plant, flat (30 keys, scalars).
 * @param {object} view - The view of the plant (app.js).
 * @param {object} plant - parsePlant().
 * @param {{ key: string, extra: object }} event - The event of detectPlant().
 * @param {object} context - `{ language, now }`.
 * @returns {object} The data.
 */
function eventData(view, plant, { key, extra }, { language, now }) {
  const data = plantData(view);
  const measureOf = (measure) => plant.measures?.[measure] ?? {};
  if (key === TRIGGERS.MEASURE_OUT_OF_RANGE || key === TRIGGERS.MEASURE_BACK_IN_RANGE) {
    const measure = measureOf(extra.measure);
    const levelText = (level) => measureLevelLabel(extra.measure, level, language);
    Object.assign(data, {
      measure: extra.measure,
      measure_label: t(`measure_${extra.measure}`, language),
      value: rounded(measure.value, 2),
      unit: UNITS[extra.measure] ?? '',
      min_good: rounded(measure.minGood, 2),
      max_good: rounded(measure.maxGood, 2),
    });
    if (key === TRIGGERS.MEASURE_OUT_OF_RANGE) {
      Object.assign(data, { level: LEVEL_KEYS[extra.level], level_label: levelText(extra.level) });
    } else {
      Object.assign(data, {
        previous_level: LEVEL_KEYS[extra.previous],
        previous_level_label: levelText(extra.previous),
      });
    }
  } else if (key === TRIGGERS.PLANT_THIRSTY) {
    const moisture = measureOf('moisture');
    Object.assign(data, {
      moisture: rounded(moisture.value, 1),
      level: LEVEL_KEYS[extra.level],
      level_label: measureLevelLabel('moisture', extra.level, language),
      min_good: rounded(moisture.minGood, 1),
    });
  } else if (key === TRIGGERS.PLANT_NEEDS_ATTENTION) {
    Object.assign(data, {
      problems: problemsText(plant, language).slice(0, 1000),
      problem_count: problemsOf(plant).length,
    });
  } else if (key === TRIGGERS.SENSOR_BATTERY_LOW) {
    Object.assign(data, {
      battery_level: rounded(plant.battery, 0),
      sensor_id: plant.sensor?.id ?? null,
    });
  } else if (key === TRIGGERS.SENSOR_SILENT || key === TRIGGERS.SENSOR_BACK) {
    // Silent: since the last measurement; back: the length of the gap.
    const since = key === TRIGGERS.SENSOR_SILENT ? plant.receivedAt : extra.silentSince;
    const until = key === TRIGGERS.SENSOR_SILENT ? now : (plant.receivedAt ?? now);
    Object.assign(data, {
      hours_without_data: Number.isFinite(since) ? rounded((until - since) / 3600000, 1) : null,
      last_measurement_at: Number.isFinite(plant.receivedAt)
        ? new Date(plant.receivedAt).toISOString()
        : null,
    });
  } else if (key === TRIGGERS.FERTILISATION_DUE) {
    Object.assign(data, {
      due_date: extra.due,
      last_fertilised: plant.fertilisation?.last ?? null,
    });
  }
  return data;
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PLANT_OUTPUTS,
  CARE_OUTPUTS,
  ACCESS_REASONS,
  OUT_LEVELS,
  UNITS,
  FERTILISE_HOUR,
  pick,
  rounded,
  problemsText,
  isFresh,
  detectPlant,
  plantData,
  eventData,
};
