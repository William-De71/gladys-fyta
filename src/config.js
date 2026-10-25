// -----------------------------------------------------------------------------
// Configuration of the FYTA integration.
//
// Fields of the config_schema:
//   - `email`          the e-mail address of the FYTA account;
//   - `password`       its password: a `secret`, never sent back to the UI,
//                      never logged, never written to /data; only sent to
//                      web.fyta.de to log in;
//   - `poll_interval`  minutes between two readings of the plants (10 to 60,
//                      15 by default): a FYTA Beam sends its measurements
//                      through the hub or the app about once an hour;
//   - `offline_after`  hours without a new measurement before a sensor is
//                      "without data" (trigger, widgets), 3 by default;
//   - `language`       language of the texts Gladys does not ask for in a
//                      language (feature names and text states, scene texts):
//                      `auto` follows the language of the last widget, or the
//                      timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const POLL_INTERVALS = ['10', '15', '30', '60'];
const DEFAULT_POLL_MINUTES = 15;
const OFFLINE_DELAYS = ['2', '3', '6', '12', '24'];
const DEFAULT_OFFLINE_HOURS = 3;

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description A value of a select, else its default.
 * @param {unknown} raw - The value.
 * @param {string[]} options - The values of the select.
 * @param {number} fallback - The default.
 * @returns {number} The number.
 */
const readOption = (raw, options, fallback) => {
  const text = readString(raw);
  return options.includes(text) ? Number(text) : fallback;
};

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ email, password, pollMinutes, offlineHours, language }`.
 * @example
 * normalizeConfig({ email: ' Me@Example.org ', password: 'x' }); // email 'Me@Example.org'
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  // The password is kept as typed: a space can be part of it.
  const password = typeof config.password === 'string' ? config.password : '';
  return {
    email: readString(config.email).slice(0, 320),
    password: password.trim() ? password : '',
    pollMinutes: readOption(config.poll_interval, POLL_INTERVALS, DEFAULT_POLL_MINUTES),
    offlineHours: readOption(config.offline_after, OFFLINE_DELAYS, DEFAULT_OFFLINE_HOURS),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  POLL_INTERVALS,
  DEFAULT_POLL_MINUTES,
  OFFLINE_DELAYS,
  DEFAULT_OFFLINE_HOURS,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
