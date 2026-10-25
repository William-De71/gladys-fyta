// -----------------------------------------------------------------------------
// Times. FYTA gives UTC instants (parse.js); the widgets and the fertilizing
// reminder use the timezone of the Gladys instance (TZ, given by the
// supervisor), else UTC. Conversions use Intl only (no dependency).
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * @description The timezone of the instance.
 * @returns {string|undefined} An IANA name, undefined for the system one.
 */
function defaultTimeZone() {
  return process.env.TZ || undefined;
}

/**
 * @description Whether a text is a timezone Intl knows.
 * @param {unknown} value - "Europe/Paris", "Australia/Sydney".
 * @returns {boolean} True when valid.
 */
function isTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * @description The timezone to use: the one of Gladys when valid, else UTC.
 * @param {string} [zone] - The timezone of Gladys.
 * @returns {string} An IANA name.
 */
function usableTimeZone(zone = defaultTimeZone()) {
  return isTimeZone(zone) ? zone.trim() : 'UTC';
}

const formatters = new Map();
/**
 * @description A cached Intl formatter of the calendar fields in a timezone.
 * @param {string} timeZone - The timezone.
 * @returns {Intl.DateTimeFormat} The formatter.
 */
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

/**
 * @description The local calendar fields of an instant.
 * @param {number} instant - The instant (ms).
 * @param {string} timeZone - The timezone.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number,
 * second: number, date: string, time: string }} The fields;
 * `date` "2026-10-23", `time` "14:05".
 */
function localParts(instant, timeZone) {
  const fields = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const pad = (n) => String(n).padStart(2, '0');
  const { year, month, day, hour, minute, second } = fields;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * @description Read "20261023" or "2026-10-23".
 * @param {unknown} value - The date.
 * @returns {{ year: number, month: number, day: number }|null} The fields.
 */
function readDate(value) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * @description "14:05" in the language and timezone of the user; the day too
 * when it is not today.
 * @param {number|null} instant - The instant (ms).
 * @param {object} [options] - `{ language, timeZone, now }`.
 * @returns {string} The time, '' when none.
 */
function formatTime(instant, { language = 'en', timeZone = defaultTimeZone(), now } = {}) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const locale = language === 'en' ? 'en-GB' : language;
  const sameDay =
    !Number.isFinite(now) || localParts(instant, timeZone).date === localParts(now, timeZone).date;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(sameDay ? {} : { weekday: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/**
 * @description A calendar date in the language of the user: "23 oct. 2026".
 * @param {string} date - "2026-10-23".
 * @param {string} language - The language.
 * @param {object} [options] - `{ year }`: false to leave the year out.
 * @returns {string} The date, '' when invalid.
 */
function formatDate(date, language, { year = true } = {}) {
  const day = readDate(date);
  if (!day) {
    return '';
  }
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

export {
  MINUTE_MS,
  HOUR_MS,
  defaultTimeZone,
  isTimeZone,
  usableTimeZone,
  localParts,
  readDate,
  formatTime,
  formatDate,
};
