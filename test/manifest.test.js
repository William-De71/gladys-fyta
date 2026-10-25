import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PLANT_OUTPUTS,
  CARE_OUTPUTS,
  ACCESS_REASONS,
  OUT_LEVELS,
} from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  POLL_INTERVALS,
  DEFAULT_POLL_MINUTES,
  OFFLINE_DELAYS,
  DEFAULT_OFFLINE_HOURS,
  normalizeConfig,
} from '../src/config.js';
import { STATUS_MEASURES } from '../src/parse.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-fyta';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'FYTA');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-fyta:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-fyta');
});

test('declares the cloud transport: web.fyta.de only; a POST for the login only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  const api = source('../src/fyta-api.js');
  assert.match(api, /https:\/\/web\.fyta\.de\/api/);
  assert.equal((api.match(/method: 'POST'/g) ?? []).length, 1, 'the login');
  assert.match(api, /auth\/login/);
  assert.doesNotMatch(api, /method: '(PUT|PATCH|DELETE)'/, 'read only');
  for (const file of ['app', 'parse', 'events', 'widgets', 'device', 'store', 'time', 'config']) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 for the catalog keywords, nothing more; no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['environment']);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"source":"houses"/, 'houses need 5.2.0');
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'energy_contracts',
  ]) {
    assert.equal(manifest[key], undefined, `${key} (permission, or a newer Gladys)`);
  }
  for (const widget of manifest.widgets) {
    // A button with a form needs 5.2.0.
    assert.doesNotMatch(source('../src/widgets.js'), /fields:/, widget.key);
  }
  const config = byKey(manifest.config_schema);
  assert.deepEqual([config.get('email').type, config.get('email').required], ['string', true]);
  assert.deepEqual(
    [config.get('password').type, config.get('password').required],
    ['secret', true],
  );
  for (const [key, options, fallback] of [
    ['poll_interval', POLL_INTERVALS, DEFAULT_POLL_MINUTES],
    ['offline_after', OFFLINE_DELAYS, DEFAULT_OFFLINE_HOURS],
  ]) {
    assert.equal(config.get(key).type, 'select', key);
    assert.deepEqual(values(config.get(key)), options, key);
    assert.equal(config.get(key).default, String(fallback), key);
  }
  for (const field of manifest.config_schema) {
    assert.ok(['section', 'string', 'secret', 'select', 'boolean'].includes(field.type), field.key);
  }
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  assert.match(app, /onWidgetAction\(WIDGETS\.CARE/);
  assert.equal(byKey(manifest.widgets).get('plants_to_care').action_timeout_seconds, 90);
  assert.equal(byKey(manifest.widgets).get('plant').action_timeout_seconds, undefined);
  assert.doesNotMatch(app, /onSetValue/, 'read only: no command');
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  const outputs = (key) =>
    byKey(manifest.scene_actions)
      .get(key)
      .outputs.map((output) => output.key);
  assert.deepEqual(outputs('refresh'), REFRESH_OUTPUTS);
  assert.deepEqual(outputs('get_plant'), PLANT_OUTPUTS);
  assert.deepEqual(outputs('get_care_summary'), CARE_OUTPUTS);
  // Every trigger field is a key of the event data (the core compares them),
  // and a variable too.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
      if (field.source) assert.equal(field.source, 'devices');
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(
    values(byKey(triggers.get('access_refused').fields).get('reason')),
    ACCESS_REASONS,
  );
  const out = byKey(triggers.get('measure_out_of_range').fields);
  assert.deepEqual(values(out.get('measure')), STATUS_MEASURES);
  assert.deepEqual(values(out.get('level')), OUT_LEVELS);
  assert.deepEqual(
    values(byKey(triggers.get('measure_back_in_range').fields).get('measure')),
    STATUS_MEASURES,
  );
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, `${action.key}: ${action.fields.length} fields`);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('the configuration read from Gladys: trimmed e-mail, password as typed, defaults', () => {
  assert.deepEqual(normalizeConfig({}), {
    email: '',
    password: '',
    pollMinutes: DEFAULT_POLL_MINUTES,
    offlineHours: DEFAULT_OFFLINE_HOURS,
    language: AUTO_LANGUAGE,
  });
  assert.deepEqual(
    normalizeConfig({
      email: ' grower@example.org ',
      password: ' with spaces ',
      poll_interval: '60',
      offline_after: 12,
      language: 'de',
    }),
    {
      email: 'grower@example.org',
      password: ' with spaces ',
      pollMinutes: 60,
      offlineHours: 12,
      language: 'de',
    },
  );
  assert.equal(normalizeConfig({ password: '   ' }).password, '');
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollMinutes, DEFAULT_POLL_MINUTES);
  assert.equal(normalizeConfig(null).language, AUTO_LANGUAGE);
});

test('catalog keywords and countries of Gladys 5.3.0', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10, 'one to ten keywords');
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length, 'unique once trimmed and lowercased');
  // Usable everywhere: no `countries`, the catalog shows it in every country.
  assert.equal(manifest.countries, undefined);
});
