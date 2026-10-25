// -----------------------------------------------------------------------------
// Dashboard widgets of the FYTA integration.
//
//   - `plants_to_care`  the plants to look after: how many need care, are
//                       doing great, send nothing; then the list of the plants
//                       to care for, the worst first (thirsty, too low or too
//                       high, low or high, silent sensor, low battery), with
//                       what is wrong; a Refresh button;
//   - `plant`           one plant (a FYTA device, the first one by default):
//                       its picture (from FYTA), soil moisture, light,
//                       temperature, salinity and sensor battery, colored by
//                       the state FYTA gives each one; its state, nutrients,
//                       last measurement and next fertilizing date.
// Every text exists in the four languages (the content is cached per
// language). Content budget of a card: 8 components, 1 main one, 6 tiles,
// 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { formatTime, formatDate } from './time.js';
import { LEVELS, LEVEL_KEYS, PLANT_STATUS, problemsOf } from './parse.js';
import { measureLevelLabel, plantStatusLabel } from './device.js';

const WIDGETS = { CARE: 'plants_to_care', PLANT: 'plant' };
const WIDGET_ACTIONS = { REFRESH: 'refresh' };
const TTL_SECONDS = { care: 600, plant: 600, message: 120 };
const MAX_CARDS = 8;
const MEASURE_UNITS = {
  moisture: '%',
  light: 'µmol/m²/s',
  temperature: '°C',
  salinity: 'mS/cm',
  nutrients: null,
};

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description The color of a measurement status.
 * @param {number} level - 0 to 5.
 * @returns {string} A WIDGET_COLORS value.
 */
function levelColor(level) {
  if (level === LEVELS.PERFECT) return WIDGET_COLORS.SUCCESS;
  if (level === LEVELS.TOO_LOW || level === LEVELS.TOO_HIGH) return WIDGET_COLORS.DANGER;
  if (level === LEVELS.LOW || level === LEVELS.HIGH) return WIDGET_COLORS.WARNING;
  return WIDGET_COLORS.NEUTRAL;
}

/**
 * @description How urgent the care of a plant is (0: nothing to do).
 * @param {object} view - The view of the plant.
 * @returns {number} The score.
 */
function careScore(view) {
  const moisture = view.plant?.measures?.moisture?.status;
  const problems = problemsOf(view.plant);
  if (view.silent) return 1;
  if (moisture === LEVELS.TOO_LOW) return 6;
  if (problems.some(({ level }) => level === LEVELS.TOO_LOW || level === LEVELS.TOO_HIGH)) {
    return 5;
  }
  if (moisture === LEVELS.LOW) return 4;
  if (problems.length) return 3;
  if (view.plant?.status === PLANT_STATUS.BAD) return 2;
  if (view.plant?.sensor?.batteryLow) return 0.5;
  return 0;
}

/**
 * @description The card of a plant to care for.
 * @param {object} view - The view of the plant.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object} A card-list item.
 */
function careCard(view, { language, now, timeZone }) {
  const plant = view.plant;
  const problems = problemsOf(plant);
  let subtitle;
  let badge;
  if (view.silent) {
    subtitle = Number.isFinite(plant?.receivedAt)
      ? t('cardSilent', language, {
          time: formatTime(plant.receivedAt, { language, timeZone, now }),
        })
      : t('cardSilentNever', language);
    badge = { text: t('badgeSilent', language), color: WIDGET_COLORS.NEUTRAL };
  } else if (problems.length) {
    subtitle = problems
      .map(({ measure, level }) =>
        t('problem', language, {
          measure: t(`measure_${measure}`, language),
          level: measureLevelLabel(measure, level, language).toLocaleLowerCase(language),
        }),
      )
      .join(' · ');
    const moisture = plant.measures?.moisture?.status;
    badge =
      moisture === LEVELS.TOO_LOW || moisture === LEVELS.LOW
        ? { text: t('badgeThirsty', language), color: levelColor(moisture) }
        : {
            text: measureLevelLabel(problems[0].measure, problems[0].level, language),
            color: levelColor(problems[0].level),
          };
  } else if (plant?.status === PLANT_STATUS.BAD) {
    subtitle = plantStatusLabel(plant.status, language);
    badge = { text: plantStatusLabel(plant.status, language), color: WIDGET_COLORS.WARNING };
  } else {
    subtitle = t('cardBattery', language);
    badge = { text: t('tileBattery', language), color: WIDGET_COLORS.WARNING };
  }
  if (!view.silent && problems.length && plant?.sensor?.batteryLow) {
    subtitle = `${subtitle} · ${t('cardBattery', language)}`;
  }
  const card = {
    title: clip(view.name, 60),
    subtitle: clip(subtitle, 60),
    badge: { text: clip(badge.text, 16), color: badge.color },
  };
  // The detail panel: each problem with its value and the ideal range.
  const details = problems
    .map(({ measure, level }) => {
      const values = plant.measures?.[measure] ?? {};
      const unit = MEASURE_UNITS[measure];
      const number = (value) => formatNumber(value, language, measure === 'salinity' ? 2 : 1);
      const parts = [
        t('problem', language, {
          measure: t(`measure_${measure}`, language),
          level: measureLevelLabel(measure, level, language).toLocaleLowerCase(language),
        }),
      ];
      if (Number.isFinite(values.value)) {
        parts.push(`${number(values.value)}${unit ? ` ${unit}` : ''}`);
      }
      if (Number.isFinite(values.minGood) && Number.isFinite(values.maxGood)) {
        parts.push(
          t('cardIdeal', language, {
            min: number(values.minGood),
            max: number(values.maxGood),
            unit: unit ?? '',
          }).trim(),
        );
      }
      return parts.join(' · ');
    })
    .join('\n');
  if (details) {
    card.description = clip(details, 2000);
  }
  return card;
}

/**
 * @description The "plants to care for" widget.
 * @param {object} options - Options.
 * @param {object[]} options.views - The views of the plants with a sensor (app.js).
 * @param {number} options.withoutSensor - How many plants have no sensor.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildCareWidget({ views, withoutSensor = 0, language, now, timeZone }) {
  const scored = views
    .map((view) => ({ view, score: careScore(view) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.view.name.localeCompare(b.view.name, language));
  const silent = views.filter((view) => view.silent).length;
  const toCare = scored.filter(({ view }) => !view.silent).length;
  const healthy = views.length - scored.length;
  const components = [
    {
      type: 'value',
      label: clip(t('tileToCare', language), 24),
      value: toCare,
      icon: 'alert-circle',
      color: toCare ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: clip(t('tileHealthy', language), 24),
      value: healthy,
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: clip(t('tileSilent', language), 24),
      value: silent,
      icon: 'wifi-off',
      color: silent ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (scored.length) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: scored
        .slice(0, MAX_CARDS)
        .map(({ view }) => careCard(view, { language, now, timeZone })),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t('widgetAllGood', language), 300),
    });
  }
  if (withoutSensor > 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetNoSensor', language, { count: withoutSensor }), 80),
    });
  }
  components.push({
    type: 'button',
    label: clip(t('buttonRefresh', language), 24),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS.care, components };
}

/**
 * @description A tile of a measure, colored by its state.
 * @param {object} measure - `{ value, status }`.
 * @param {object} options - `{ label, unit, decimals, icon, language }`.
 * @returns {object} A value tile.
 */
function measureTile(measure, { label, unit, decimals, icon, language }) {
  const known = Number.isFinite(measure?.value);
  return {
    type: 'value',
    label: clip(label, 24),
    value: known ? clip(formatNumber(measure.value, language, decimals), 12) : '–',
    ...(known && unit ? { unit } : {}),
    icon,
    color: levelColor(measure?.status ?? LEVELS.NO_DATA),
  };
}

/**
 * @description The "plant" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the plant (app.js).
 * @param {string|null} options.imageKey - The key of its picture, null when none.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @param {string} options.today - Today in Gladys ("2026-10-25").
 * @returns {object} The content.
 */
function buildPlantWidget({ view, imageKey, language, now, timeZone, today }) {
  const plant = view.plant;
  const measures = plant?.measures ?? {};
  const components = [{ type: 'text', variant: 'heading', text: clip(view.name, 40) }];
  if (imageKey) {
    components.push({ type: 'image', key: imageKey, alt: clip(view.name, 100), fit: 'cover' });
  }
  components.push(
    measureTile(measures.moisture, {
      label: t('tileMoisture', language),
      unit: '%',
      decimals: 0,
      icon: 'droplet',
      language,
    }),
    measureTile(measures.light, {
      label: t('tileLight', language),
      unit: 'µmol',
      decimals: 0,
      icon: 'sun',
      language,
    }),
    measureTile(measures.temperature, {
      label: t('tileTemperature', language),
      unit: '°C',
      decimals: 1,
      icon: 'thermometer',
      language,
    }),
    measureTile(measures.salinity, {
      label: t('tileSalinity', language),
      unit: 'mS/cm',
      decimals: 2,
      icon: 'activity',
      language,
    }),
    {
      type: 'value',
      label: clip(t('tileBattery', language), 24),
      value: Number.isFinite(plant?.battery) ? Math.round(plant.battery) : '–',
      ...(Number.isFinite(plant?.battery) ? { unit: '%' } : {}),
      icon: 'battery',
      color: plant?.sensor?.batteryLow ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  );
  const rows = [
    {
      label: clip(t('rowState', language), 40),
      value: clip(plantStatusLabel(plant?.status, language), 40),
      color:
        plant?.status === PLANT_STATUS.GOOD
          ? WIDGET_COLORS.SUCCESS
          : plant?.status === PLANT_STATUS.BAD
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: clip(t('rowNutrients', language), 40),
      value: clip(measureLevelLabel('nutrients', measures.nutrients?.status ?? 0, language), 40),
      color: levelColor(measures.nutrients?.status ?? 0),
    },
    {
      label: clip(t('rowData', language), 40),
      value: Number.isFinite(plant?.receivedAt)
        ? clip(
            t('rowAgo', language, {
              time: formatTime(plant.receivedAt, { language, timeZone, now }),
              ago: ago(plant.receivedAt, now, language),
            }),
            40,
          )
        : clip(t('rowNoData', language), 40),
      color: view.silent ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  ];
  const next = plant?.fertilisation?.next;
  if (next) {
    const date = formatDate(next, language, { year: next.slice(0, 4) !== today.slice(0, 4) });
    rows.push({
      label: clip(t('rowFertilise', language), 40),
      value: clip(next <= today ? t('rowOverdue', language, { date }) : date, 40),
      color: next <= today ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO,
    });
  }
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: TTL_SECONDS.plant, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  TTL_SECONDS,
  MAX_CARDS,
  LEVEL_KEYS,
  clip,
  messageContent,
  levelColor,
  careScore,
  buildCareWidget,
  buildPlantWidget,
};
