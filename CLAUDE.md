# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **FYTA** plant sensors (FYTA
Beam): a Node.js service (Node 22+, ESM, no build step) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official FYTA Public API
(<https://fyta-io.notion.site/FYTA-Public-API-d2f4c30306f74504924c9a40402a3afd>,
base `https://web.fyta.de/api`) with the e-mail address and the password of the
user's FYTA account (`POST auth/login` → Bearer token). **Read only**: the login
is the only POST. `type: "device"`, Gladys 5.1.0+ (widgets, scenes),
`transports: ["cloud"]`. Not affiliated with FYTA. **Never tested with a real
account**: the shapes come from the examples of the official documentation
(`test/fixtures/fyta-doc.json`, unchanged) and from the fields Home Assistant
reads through fyta_cli (field names only: fyta_cli is GPL-3.0, nothing of it is
copied). Checked live on 2026-10-25: a login with an unknown account answers
404 `{"statusCode":404,"error":"Not Found"}`; `GET user-plant` with a
well-formed fake Bearer answers 403 "explicit deny", with a malformed one 500
`{"message":null}`.

## Commands

```bash
npm install
npm test                                  # node --test; a fake FYTA (in-memory fetch), never the network
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler; the timer (list, details due, triggers), devices and
                       states, scene events, scene actions, widgets and pictures,
                       configuration buttons, status
src/fyta-api.js        HTTP client: login, Bearer, a refused token (401 / 403 / 500
                       {"message":null}) -> one new login, statuses -> kinds, one request at a
                       time 1 s apart, the pause of a 429, pictures (300 KB, Bearer to fyta.de only)
src/parse.js           the answers made safe (null is null, never 0; dates UTC): user-plant,
                       user-plant/{id}, statuses, °F -> °C
src/device.js          one device per plant with a sensor, its features and states
src/events.js          triggers (transitions per measure, silence, battery, fertilizing), keys, outputs
src/widgets.js         plants to care for, one plant
src/time.js            local dates and times (Intl only)
src/store.js           /data/fyta.json (mode 0600: it holds the access token)
src/config.js          e-mail, password, reading interval, silence delay, language
src/i18n.js            helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-fyta.js       the fake FYTA (login, Bearer, refusals, pictures)
test/fixtures/fyta-doc.json     the examples of the official documentation
test/fixtures/account.json      a made-up account on the documented shapes
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:plant:<id>` (the id of the plant in the FYTA account),
  features `…:<key>` (`moisture`, `light`, `temperature`, `ph`, `battery`,
  `battery_low`, `plant_status`, `moisture_status`, `light_status`,
  `temperature_status`, `salinity_status`, `nutrients_status`), feature
  `category` / `type` / `unit` / `min` / `max`, the keys of `config_schema` and
  `actions`, `last_language`, widgets and settings, triggers (fields, options,
  variables), scene actions (fields, outputs). `test/structure.test.js`
  compares them to `test/fixtures/discovery.baseline.json`: never update it to
  make a test pass without a documented migration.
- **Category pairs**: soil-moisture-sensor / decimal (%), light-sensor / decimal
  **without unit** (FYTA gives µmol/m²/s, the core knows lux only: never
  `lux`), temperature-sensor / decimal (°C), ph-sensor / decimal, battery /
  integer, battery-low / binary, text / text for the states. The salinity has
  no category in the core: no feature for its value. pH appears only once FYTA
  gave one (`phSeen`), then stays.
- **Read only.** The login is the only POST (`test/manifest.test.js` checks
  it). The public API has no write.
- **The pace.** Every request goes through the client queue. The list of the
  plants at the interval of the configuration (15 min by default); the details
  of a plant only when its list signature changed (a measurement time, a
  status, the battery flag, the nickname) or every 6 hours. A 429 pauses
  everything until its Retry-After. A manual refresh (widget button, scene
  action) at most once a minute. Never a request from `get_plant` or
  `get_care_summary`. Pictures: downloaded when a plant widget asks, kept in
  memory, retried after 6 hours when they fail.
- **Freshness**: a sensor without a measurement for the delay of the
  configuration is silent; its values are not re-sent (no heartbeat), so Gladys
  shows them outdated. A fresh sensor's unchanged values are re-sent every
  6 hours (`publishChangedStates` heartbeat).
- **`should_poll` stays false**: the integration has its own timer.
- **Credentials**: the password is a `secret`, never logged, never in /data,
  sent to web.fyta.de only. The access token is kept in `/data/fyta.json`
  (0600) with a fingerprint of the e-mail (the account it belongs to) until it
  expires, renewed one day before; never logged, sent to `fyta.de` hosts only
  (a picture elsewhere is fetched without it). Test credentials never look real
  (`not-a-real-password`, `not-a-real-fyta-access-token`): the push protection
  of GitHub would block them.
- **Dates**: FYTA gives "YYYY-MM-DD HH:MM:SS" without a timezone: read as UTC.
  The widgets show times in the TZ of Gladys. Never `new Date().getHours()`.
- **Scene events** once per transition, never at the first reading, never
  from a scene action: the detection runs on the timer only (`detectEvents`);
  `refresh` reads and leaves the triggers to the next round.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". A state alone qualifies "état" / "estado"
  (masculine: `level_*`); "<measure>: <level>" agrees with the measure
  (`level_f_*` feminine, `level_p_*` the plural nutrients). Plant names come
  from FYTA, never translated.
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- Numbers come as strings (`"61"`, `"0.6"`), sometimes null; `currentFormatted`
  is a display text (`"0.50"` for a current of `"1"` in the documentation):
  read `current`.
- The documentation shows an impossible date (`2023-01-00`): it is null.
- Units in the answers carry a "/h" (`"%/h"`, `"μmol/h"`, `"°C/h"`, `"mS/h"`):
  they are labels, not rates; the light is a PPFD in µmol/m²/s.
- A plant without a sensor: `sensor: null` in its details (`has_sensor: false`
  in the list); fyta_cli skips it, so does this integration.
- The `nutrients` status and `fertilisation` are not in the documentation
  (seen in fyta_cli): absent, they are "no data" and null.
- `temperature_unit` (1 °C, 2 °F) is a preference; only a measurement unit
  starting with °F converts the values (never seen live).
- The documentation abbreviates the list entry of a plant (no id): the tests
  use `test/fixtures/account.json` for the list.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
