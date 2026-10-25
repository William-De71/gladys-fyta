# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **plants:** every plant with a FYTA Beam sensor of a FYTA account, through the official FYTA Public API with the e-mail address and the password of the account, read only; the list read in one request every 15 minutes by default, the details of a plant only when FYTA shows something new for it, the access token kept in `/data` until it expires
- **devices:** one device per plant: soil moisture, light (µmol/m²/s), temperature, sensor battery and its low flag, pH when FYTA gives one, and the states FYTA gives (plant, soil moisture, light, temperature, salinity, nutrients)
- **scenes:** triggers when a plant needs attention, is thirsty, when a measure leaves or comes back to its range, when the battery of a sensor is low, when a sensor goes silent or comes back, when the fertilizing date is reached and when FYTA refuses the account; actions to refresh now, read the values of a plant and summarize the plants to care for
- **widgets:** the plants to care for, the worst first, with a Refresh button; one plant with its picture, its measures colored by their state and its next fertilizing date
- **configuration:** e-mail address and password with a guide, reading interval, delay before a sensor is without data, language, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README
