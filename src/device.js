// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per FYTA plant that has a sensor (the id of the plant in the
// account, which FYTA never reuses), named after the nickname of the plant,
// read-only, in a stable order. Category / type / unit pairs from the Gladys
// core (DEVICE_FEATURE_UNITS_BY_CATEGORY and the icons of
// front/src/utils/consts.js, read on master 2026-10-23):
//   - `moisture`            soil-moisture-sensor / decimal, % (0-100);
//   - `light`               light-sensor / decimal, no unit: FYTA measures a
//                           photon flux (µmol/m²/s, PPFD), not lux, and the
//                           core has no such unit (the name says it);
//   - `temperature`         temperature-sensor / decimal, °C;
//   - `ph`                  ph-sensor / decimal, pH: only for a plant FYTA
//                           ever gave a pH for (the Beam does not measure it);
//   - `battery`             battery / integer, % (of the sensor);
//   - `battery_low`         battery-low / binary (FYTA's own flag);
//   - `plant_status`, `moisture_status`, `light_status`, `temperature_status`,
//     `salinity_status`, `nutrients_status`
//                           text / text: the state FYTA gives (too low, low,
//                           perfect, high, too high), in the language of the
//                           configuration.
// The salinity (electrical conductivity, mS/cm) has no category in the core:
// it is not a feature (no pair would show it right), only its state, the
// widgets and the scene texts carry it.
// The names of features of one type (decimal, text) are shown by the
// dashboard, so they say what they measure.
//
// External ids: `ext:fyta:plant:<id>`, features `…:<key>`.
// `should_poll` stays false: the integration reads the cloud on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { LEVEL_KEYS, PLANT_STATUS_KEYS } from './parse.js';

const PLANT_TYPE = 'plant';
const MAX_LIGHT = 3000;

const sensor = (feature) => ({ text: false, history: true, ...feature });
const text = (key, measure) => ({
  key,
  measure,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  unit: null,
  min: 0,
  max: 0,
  text: true,
  history: false,
});

const PLANT_FEATURES = [
  sensor({
    key: 'moisture',
    category: C.SOIL_MOISTURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    decimals: 1,
  }),
  sensor({
    key: 'light',
    category: C.LIGHT_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: null,
    min: 0,
    max: MAX_LIGHT,
    decimals: 0,
  }),
  sensor({
    key: 'temperature',
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -30,
    max: 60,
    decimals: 1,
  }),
  sensor({
    key: 'ph',
    category: C.PH_SENSOR,
    type: T.PH_SENSOR.DECIMAL,
    unit: U.PH,
    min: 0,
    max: 14,
    decimals: 1,
    optional: true,
  }),
  sensor({
    key: 'battery',
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    decimals: 0,
  }),
  sensor({
    key: 'battery_low',
    category: C.BATTERY_LOW,
    type: T.BATTERY_LOW.BINARY,
    unit: null,
    min: 0,
    max: 1,
    decimals: 0,
  }),
  text('plant_status', null),
  text('moisture_status', 'moisture'),
  text('light_status', 'light'),
  text('temperature_status', 'temperature'),
  text('salinity_status', 'salinity'),
  text('nutrients_status', 'nutrients'),
];

/**
 * @description The external ids of a plant.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {number} id - The id of the plant in the FYTA account.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const plantIds = (gladys, id) => gladys.externalIds(PLANT_TYPE, String(id));

/**
 * @description The id of the plant of a device external id, or of one of its features.
 * @param {unknown} externalId - `ext:fyta:plant:12` (or `…:12:moisture`).
 * @returns {number|null} The id.
 */
function plantOfExternalId(externalId) {
  const match = String(externalId ?? '').match(/:plant:(\d+)(?::[a-z_]+)?$/);
  return match ? Number(match[1]) : null;
}

/**
 * @description The keys of the features of a plant.
 * @param {object} [options] - `{ ph }`: whether a pH was ever given.
 * @returns {string[]} The keys.
 */
const plantFeatureKeys = ({ ph = false } = {}) =>
  PLANT_FEATURES.filter((feature) => !feature.optional || ph).map((feature) => feature.key);

/**
 * @description The name of a plant: its nickname in the FYTA app.
 * @param {object} plant - `{ id, name, scientificName }`.
 * @returns {string} The name.
 */
function plantName(plant) {
  const name = String(plant?.name ?? '').trim() || String(plant?.scientificName ?? '').trim();
  return (name || `FYTA ${plant?.id ?? ''}`.trim()).slice(0, 100);
}

/**
 * @description A feature of a discovered device.
 * @param {object} ids - The external ids of the device.
 * @param {object} feature - The feature description.
 * @param {string} language - Language of its name.
 * @returns {object} The feature.
 */
function buildFeature(ids, feature, language) {
  return {
    name: t(`feature_${feature.key}`, language),
    external_id: ids.feature(feature.key),
    category: feature.category,
    type: feature.type,
    unit: feature.unit,
    min: feature.min,
    max: feature.max,
    read_only: true,
    has_feedback: false,
    keep_history: feature.history,
  };
}

/**
 * @description Build the device of a plant.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} plant - `{ id, name, scientificName, gardenName, sensor }` (parsePlant()).
 * @param {object} [options] - `{ language, ph }`.
 * @returns {object} The discovered device.
 */
function buildPlantDevice(gladys, plant, { language = 'en', ph = false } = {}) {
  const ids = plantIds(gladys, plant.id);
  const params = [{ name: 'FYTA_PLANT_ID', value: String(plant.id) }];
  if (plant.scientificName) {
    params.push({ name: 'FYTA_SCIENTIFIC_NAME', value: plant.scientificName.slice(0, 100) });
  }
  if (plant.gardenName) {
    params.push({ name: 'FYTA_GARDEN', value: plant.gardenName.slice(0, 100) });
  }
  if (plant.sensor?.id) {
    params.push({ name: 'FYTA_SENSOR_ID', value: plant.sensor.id });
  }
  return {
    name: plantName(plant),
    external_id: ids.device,
    model: 'FYTA Beam',
    should_poll: false,
    params,
    features: plantFeatureKeys({ ph }).map((key) =>
      buildFeature(
        ids,
        PLANT_FEATURES.find((feature) => feature.key === key),
        language,
      ),
    ),
  };
}

/**
 * @description The label of a measurement status.
 * @param {number} level - 0 to 5.
 * @param {string} language - The language.
 * @returns {string} "Too low".
 */
const levelLabel = (level, language) => t(`level_${LEVEL_KEYS[level] ?? 'no_data'}`, language);

/**
 * @description The label of a level agreed with its measure, for "<measure>:
 * <level>": the measures are feminine in French and Spanish, the nutrients
 * plural (a state alone qualifies "état" / "estado": levelLabel()).
 * @param {string} measure - moisture, light, temperature, salinity, nutrients.
 * @param {number} level - 0 to 5.
 * @param {string} language - The language.
 * @returns {string} "Trop élevée".
 */
const measureLevelLabel = (measure, level, language) =>
  t(`level_${measure === 'nutrients' ? 'p' : 'f'}_${LEVEL_KEYS[level] ?? 'no_data'}`, language);

/**
 * @description The label of the state of a plant.
 * @param {number} status - 0 to 3.
 * @param {string} language - The language.
 * @returns {string} "Doing great".
 */
const plantStatusLabel = (status, language) =>
  t(`plant_${PLANT_STATUS_KEYS[status] ?? 'needs_attention'}`, language);

/**
 * @description Round a value to the decimals of its feature, within its bounds.
 * @param {object} feature - The feature description.
 * @param {number} value - The value.
 * @returns {number} The value.
 */
function bounded(feature, value) {
  const factor = 10 ** feature.decimals;
  const rounded = Math.round(value * factor) / factor;
  return Math.min(feature.max, Math.max(feature.min, rounded));
}

/**
 * @description The values of the features of a plant.
 * @param {object} plant - parsePlant().
 * @returns {object} `{ moisture, light, … }`, numbers, null when unknown.
 */
function plantValues(plant) {
  const value = (measure) => plant?.measures?.[measure]?.value ?? null;
  return {
    moisture: value('moisture'),
    light: value('light'),
    temperature: value('temperature'),
    ph: plant?.ph ?? null,
    battery: plant?.battery ?? null,
    battery_low: plant?.sensor ? (plant.sensor.batteryLow ? 1 : 0) : null,
  };
}

/**
 * @description The states of a plant: a value left out (null) is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} plant - parsePlant().
 * @param {object} [options] - `{ language, ph }`.
 * @returns {object[]} `{ device_feature_external_id, state | text }`.
 */
function buildPlantStates(gladys, plant, { language = 'en', ph = false } = {}) {
  const ids = plantIds(gladys, plant.id);
  const keys = plantFeatureKeys({ ph });
  const values = plantValues(plant);
  const states = [];
  for (const feature of PLANT_FEATURES.filter((entry) => keys.includes(entry.key))) {
    const id = ids.feature(feature.key);
    if (!feature.text) {
      if (Number.isFinite(values[feature.key])) {
        states.push({
          device_feature_external_id: id,
          state: bounded(feature, values[feature.key]),
        });
      }
    } else if (feature.key === 'plant_status') {
      states.push({
        device_feature_external_id: id,
        text: plantStatusLabel(plant.status, language),
      });
    } else {
      const level = plant.measures?.[feature.measure]?.status ?? 0;
      states.push({ device_feature_external_id: id, text: levelLabel(level, language) });
    }
  }
  return states;
}

export {
  PLANT_TYPE,
  PLANT_FEATURES,
  MAX_LIGHT,
  plantIds,
  plantOfExternalId,
  plantFeatureKeys,
  plantName,
  buildPlantDevice,
  buildPlantStates,
  plantValues,
  levelLabel,
  measureLevelLabel,
  plantStatusLabel,
};
