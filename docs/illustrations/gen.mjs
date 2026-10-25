// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake FYTA of the tests (test/helpers/fake-fyta.js, the account
// of test/fixtures/account.json), on a made-up Sunday, 25 October 2026 at
// 11:00 in Paris: a thirsty Monstera, a basil doing great, a Ficus whose
// sensor has been silent for six hours. The picture of the Monstera is a
// drawing (plant-photo.svg), never a real photo. Never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json> <plant.png>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out, picture] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeFyta, dataDir, recordingLogger, EMAIL, PASSWORD } = await load(
  'test/helpers/fake-fyta.js',
);

const NOW = Date.parse('2026-10-25T10:00:00Z');
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['plants_to_care', 'plant'];
const PHOTO = 'https://web.fyta.de/storage/user-plants/101/thumb.jpg';
const bytes = readFileSync(picture);
const images = {};

/**
 * @description One language: the two widgets, the plant one on the Monstera.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const fake = createFakeFyta();
  fake.addImage(PHOTO, { bytes, type: 'image/png' });
  const gladys = createFakeGladys({ config: { email: EMAIL, password: PASSWORD, language } });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    baseUrl: fake.baseUrl,
    dataDir: dataDir(),
    now: () => NOW,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  await app.tick();
  const settings = { plant: gladys.fake.discoveredDevices[0].external_id };
  const result = {};
  for (const key of WIDGET_KEYS) {
    const content = (await gladys.fake.widgetGet(key, { settings, language })).data.content;
    for (const component of content.components.filter((c) => c.type === 'image')) {
      const image = (await gladys.fake.widgetGetImage(component.key)).data.image;
      images[component.key] = `data:image/png;base64,${image}`;
    }
    result[key] = content;
  }
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images,
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
    now: NOW,
  }),
);
