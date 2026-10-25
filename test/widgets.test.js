import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { parsePlant, LEVELS } from '../src/parse.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  buildCareWidget,
  buildPlantWidget,
  messageContent,
  careScore,
  levelColor,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { PNG } from './helpers/fake-fyta.js';

const account = JSON.parse(
  readFileSync(new URL('./fixtures/account.json', import.meta.url), 'utf8'),
);
const NOW = Date.parse('2026-10-25T10:00:00Z');
const HOUR = 3600 * 1000;
const view = (id, overrides = {}) => {
  const plant = parsePlant(structuredClone(account.details[id]));
  const silent = !(NOW - plant.receivedAt <= 3 * HOUR);
  return {
    id,
    deviceId: `ext:fyta:plant:${id}`,
    name: plant.name,
    plant,
    silent,
    fresh: !silent,
    ...overrides,
  };
};
const OPTIONS = { now: NOW, timeZone: 'Europe/Paris' };
const count = (content, type) => content.components.filter((c) => c.type === type).length;

/**
 * @description Check a content against the core rules (what the core would drop).
 * @param {object} content - The content.
 * @param {string} label - For the messages.
 */
function valid(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
  assert.ok(content.components.length <= 8, label);
  assert.ok(content.ttl_seconds >= 10 && content.ttl_seconds <= 3600, label);
  const main = content.components.filter((c) => ['chart', 'card-list', 'image'].includes(c.type));
  assert.ok(main.length <= 1, label);
  assert.ok(count(content, 'value') + count(content, 'gauge') <= 6, label);
  assert.ok(count(content, 'status') <= 1, label);
  assert.ok(count(content, 'button') <= 4, label);
}

test('plants to care for: the worst first, every language within the core rules', () => {
  const views = [view(102), view(101), view(103)];
  for (const language of LANGUAGES) {
    const content = buildCareWidget({ views, withoutSensor: 1, language, ...OPTIONS });
    valid(content, language);
    const tiles = content.components.filter((c) => c.type === 'value').map((c) => c.value);
    assert.deepEqual(tiles, [1, 1, 1], `${language}: to care, doing great, silent`);
    const list = content.components.find((c) => c.type === 'card-list');
    assert.deepEqual(
      list.items.map((item) => item.title),
      ['Monstera', 'Ficus'],
      'thirsty before silent',
    );
    for (const item of list.items) {
      assert.ok(item.badge.text.length <= 16, `${language}: ${item.badge.text}`);
      assert.ok(item.title.length <= 60);
    }
    const button = content.components.find((c) => c.type === 'button');
    assert.deepEqual(button.action, { key: WIDGET_ACTIONS.REFRESH });
    assert.ok(content.components.some((c) => c.type === 'text' && c.variant === 'caption'));
  }
  const english = buildCareWidget({ views, withoutSensor: 0, language: 'en', ...OPTIONS });
  const [monstera, ficus] = english.components.find((c) => c.type === 'card-list').items;
  assert.equal(monstera.badge.text, 'Thirsty');
  assert.equal(monstera.badge.color, 'danger');
  assert.equal(monstera.subtitle, 'Soil moisture: too low · Salinity: low · Nutrients: low');
  assert.equal(
    monstera.description,
    'Soil moisture: too low · 18 % · ideal 35–70 %\nSalinity: low · 0.45 mS/cm · ideal 0.6–1 mS/cm\nNutrients: low',
  );
  assert.match(ficus.subtitle, /^No measurement since 05:10$/);
  assert.equal(ficus.badge.text, 'No data');
  assert.ok(!english.components.some((c) => c.variant === 'caption'), 'no plant without sensor');
});

test('plants to care for: all good says so', () => {
  for (const language of LANGUAGES) {
    const content = buildCareWidget({ views: [view(102)], language, ...OPTIONS });
    valid(content, language);
    assert.equal(count(content, 'card-list'), 0);
    assert.ok(content.components.some((c) => c.type === 'text' && c.variant === 'body'));
  }
});

test('one plant: picture, five tiles colored by state, state rows; within the rules', () => {
  for (const language of LANGUAGES) {
    for (const imageKey of ['plant-101-0123456789ab', null]) {
      const content = buildPlantWidget({
        view: view(101),
        imageKey,
        language,
        today: '2026-10-25',
        ...OPTIONS,
      });
      valid(content, `${language} ${imageKey}`);
      assert.equal(count(content, 'value'), 5);
      assert.equal(count(content, 'image'), imageKey ? 1 : 0);
      for (const tile of content.components.filter((c) => c.type === 'value')) {
        assert.ok(tile.label.length <= 24, tile.label);
        assert.ok(!tile.unit || tile.unit.length <= 6, tile.unit);
      }
      const rows = content.components.find((c) => c.type === 'status').items;
      for (const row of rows) {
        assert.ok(row.label.length <= 40 && String(row.value).length <= 40, row.label);
      }
    }
  }
  const content = buildPlantWidget({
    view: view(101),
    imageKey: null,
    language: 'fr',
    today: '2026-10-25',
    ...OPTIONS,
  });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.value, tile.unit, tile.color]),
    [
      ['18', '%', 'danger'],
      ['120', 'µmol', 'success'],
      ['21,5', '°C', 'success'],
      ['0,45', 'mS/cm', 'warning'],
      [64, '%', 'neutral'],
    ],
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ['État', 'À surveiller'],
      ['Nutriments', 'Faibles'],
      ['Dernière mesure', '10:40 (il y a 20 min)'],
      ['Prochain engrais', '1 nov.'],
    ],
  );
});

test('one plant: unknown values show a dash, an overdue fertilizing a warning', () => {
  const empty = view(101);
  empty.plant.measures.moisture.value = null;
  empty.plant.measures.moisture.status = LEVELS.NO_DATA;
  empty.plant.battery = null;
  empty.plant.fertilisation.next = '2026-10-20';
  const content = buildPlantWidget({
    view: empty,
    imageKey: null,
    language: 'en',
    today: '2026-10-25',
    ...OPTIONS,
  });
  valid(content, 'empty');
  const [moisture] = content.components.filter((c) => c.type === 'value');
  assert.deepEqual([moisture.value, moisture.unit, moisture.color], ['–', undefined, 'neutral']);
  const fertilise = content.components.find((c) => c.type === 'status').items.at(-1);
  assert.deepEqual([fertilise.value, fertilise.color], ['20 Oct (due)', 'warning']);
});

test('messages, scores and colors', () => {
  valid(messageContent('x'.repeat(400), { heading: 'h'.repeat(50) }), 'message');
  assert.equal(careScore(view(102)), 0);
  assert.equal(careScore(view(101)), 6);
  assert.equal(careScore(view(103)), 1);
  const battery = view(102);
  battery.plant.sensor.batteryLow = true;
  assert.equal(careScore(battery), 0.5);
  assert.equal(levelColor(LEVELS.HIGH), 'warning');
  assert.equal(levelColor(LEVELS.NO_DATA), 'neutral');
  assert.deepEqual(Object.values(WIDGETS), ['plants_to_care', 'plant']);
});

test('the picture served to a widget passes the core image checks', () => {
  assert.deepEqual(validateWidgetImage(PNG.toString('base64')), []);
});
