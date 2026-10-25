// -----------------------------------------------------------------------------
// Entry point of the FYTA external integration.
//
// The plants of a FYTA account (FYTA Beam plant sensors), through the
// official FYTA Public API (https://web.fyta.de/api), with the e-mail address
// and the password of the account, read only:
//   - devices: one per plant with a sensor (soil moisture, light, temperature,
//     sensor battery, the states FYTA gives), offered on the Discovery screen
//     (src/device.js);
//   - scene triggers: plant needs attention, plant thirsty, measure out of
//     range / back in range, sensor battery low, sensor silent / back,
//     fertilizing due, access refused;
//   - scene actions: refresh now, values of a plant, summary of the plants to
//     care for;
//   - dashboard widgets: plants to care for, one plant.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widgets)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the FYTA integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
