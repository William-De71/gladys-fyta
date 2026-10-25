// -----------------------------------------------------------------------------
// Texts of the FYTA integration, in English, French, German and Spanish
// (English fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names and text states, widget contents, scene texts,
// errors, results of the configuration buttons. Vocabulary of the Gladys
// interface (appareil / Gerät / dispositivo, capteur / Sensor / sensor) and of
// the FYTA app (soil moisture, light, temperature, salinity, nutrients).
// German says "du", Spanish "usted", like Gladys. Plant names come from the
// FYTA account, never translated.
// -----------------------------------------------------------------------------

const TEXTS = {
  // features (names shown by the dashboard when several share a type)
  feature_moisture: {
    en: 'Soil moisture',
    fr: 'Humidité du sol',
    de: 'Bodenfeuchte',
    es: 'Humedad del suelo',
  },
  feature_light: {
    en: 'Light (µmol/m²/s)',
    fr: 'Lumière (µmol/m²/s)',
    de: 'Licht (µmol/m²/s)',
    es: 'Luz (µmol/m²/s)',
  },
  feature_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  feature_ph: { en: 'Soil pH', fr: 'pH du sol', de: 'Boden-pH', es: 'pH del suelo' },
  feature_battery: {
    en: 'Sensor battery',
    fr: 'Batterie du capteur',
    de: 'Sensorbatterie',
    es: 'Batería del sensor',
  },
  feature_battery_low: {
    en: 'Sensor battery low',
    fr: 'Batterie du capteur faible',
    de: 'Sensorbatterie schwach',
    es: 'Batería del sensor baja',
  },
  feature_plant_status: {
    en: 'Plant state',
    fr: 'État de la plante',
    de: 'Zustand der Pflanze',
    es: 'Estado de la planta',
  },
  feature_moisture_status: {
    en: 'Soil moisture state',
    fr: 'État de l’humidité du sol',
    de: 'Zustand der Bodenfeuchte',
    es: 'Estado de la humedad del suelo',
  },
  feature_light_status: {
    en: 'Light state',
    fr: 'État de la lumière',
    de: 'Zustand des Lichts',
    es: 'Estado de la luz',
  },
  feature_temperature_status: {
    en: 'Temperature state',
    fr: 'État de la température',
    de: 'Zustand der Temperatur',
    es: 'Estado de la temperatura',
  },
  feature_salinity_status: {
    en: 'Salinity (fertilizer) state',
    fr: 'État de la salinité (engrais)',
    de: 'Zustand des Salzgehalts (Dünger)',
    es: 'Estado de la salinidad (abono)',
  },
  feature_nutrients_status: {
    en: 'Nutrients state',
    fr: 'État des nutriments',
    de: 'Zustand der Nährstoffe',
    es: 'Estado de los nutrientes',
  },

  // measures (scene variables, widget rows)
  measure_moisture: {
    en: 'Soil moisture',
    fr: 'Humidité du sol',
    de: 'Bodenfeuchte',
    es: 'Humedad del suelo',
  },
  measure_light: { en: 'Light', fr: 'Lumière', de: 'Licht', es: 'Luz' },
  measure_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  measure_salinity: { en: 'Salinity', fr: 'Salinité', de: 'Salzgehalt', es: 'Salinidad' },
  measure_nutrients: { en: 'Nutrients', fr: 'Nutriments', de: 'Nährstoffe', es: 'Nutrientes' },

  // levels of a measure (FYTA measurement status), 16 characters at most (badges)
  level_no_data: { en: 'No data', fr: 'Pas de données', de: 'Keine Daten', es: 'Sin datos' },
  level_too_low: { en: 'Too low', fr: 'Trop faible', de: 'Zu niedrig', es: 'Demasiado bajo' },
  level_low: { en: 'Low', fr: 'Faible', de: 'Niedrig', es: 'Bajo' },
  level_perfect: { en: 'Perfect', fr: 'Parfait', de: 'Perfekt', es: 'Perfecto' },
  level_high: { en: 'High', fr: 'Élevé', de: 'Hoch', es: 'Alto' },
  level_too_high: { en: 'Too high', fr: 'Trop élevé', de: 'Zu hoch', es: 'Demasiado alto' },

  // The same levels agreed with a feminine measure (humidité, lumière,
  // température, salinité; humedad, luz, temperatura, salinidad) and with the
  // plural nutrients (nutriments, nutrientes), for "<measure>: <level>".
  level_f_no_data: { en: 'No data', fr: 'Pas de données', de: 'Keine Daten', es: 'Sin datos' },
  level_f_too_low: { en: 'Too low', fr: 'Trop faible', de: 'Zu niedrig', es: 'Demasiado baja' },
  level_f_low: { en: 'Low', fr: 'Faible', de: 'Niedrig', es: 'Baja' },
  level_f_perfect: { en: 'Perfect', fr: 'Parfaite', de: 'Perfekt', es: 'Perfecta' },
  level_f_high: { en: 'High', fr: 'Élevée', de: 'Hoch', es: 'Alta' },
  level_f_too_high: { en: 'Too high', fr: 'Trop élevée', de: 'Zu hoch', es: 'Demasiado alta' },
  level_p_no_data: { en: 'No data', fr: 'Pas de données', de: 'Keine Daten', es: 'Sin datos' },
  level_p_too_low: {
    en: 'Too low',
    fr: 'Trop faibles',
    de: 'Zu niedrig',
    es: 'Demasiado bajos',
  },
  level_p_low: { en: 'Low', fr: 'Faibles', de: 'Niedrig', es: 'Bajos' },
  level_p_perfect: { en: 'Perfect', fr: 'Parfaits', de: 'Perfekt', es: 'Perfectos' },
  level_p_high: { en: 'High', fr: 'Élevés', de: 'Hoch', es: 'Altos' },
  level_p_too_high: {
    en: 'Too high',
    fr: 'Trop élevés',
    de: 'Zu hoch',
    es: 'Demasiado altos',
  },

  // states of a plant (FYTA plant status)
  plant_deleted: { en: 'Deleted', fr: 'Supprimée', de: 'Gelöscht', es: 'Eliminada' },
  plant_doing_great: {
    en: 'Doing great',
    fr: 'En pleine forme',
    de: 'Alles bestens',
    es: 'En perfecto estado',
  },
  plant_needs_attention: {
    en: 'Needs attention',
    fr: 'À surveiller',
    de: 'Braucht Pflege',
    es: 'Necesita atención',
  },
  plant_no_sensor: { en: 'No sensor', fr: 'Sans capteur', de: 'Kein Sensor', es: 'Sin sensor' },

  // widgets: tiles (24 characters at most)
  tileToCare: { en: 'To care for', fr: 'À soigner', de: 'Zu pflegen', es: 'Por cuidar' },
  tileHealthy: { en: 'Doing great', fr: 'En forme', de: 'Bestens', es: 'Perfectas' },
  tileSilent: { en: 'Without data', fr: 'Sans données', de: 'Ohne Daten', es: 'Sin datos' },
  tileMoisture: { en: 'Soil moisture', fr: 'Humidité du sol', de: 'Bodenfeuchte', es: 'Humedad' },
  tileLight: { en: 'Light', fr: 'Lumière', de: 'Licht', es: 'Luz' },
  tileTemperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  tileSalinity: { en: 'Salinity', fr: 'Salinité', de: 'Salzgehalt', es: 'Salinidad' },
  tileBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },

  // widgets: status rows (40 characters at most)
  rowState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  rowNutrients: { en: 'Nutrients', fr: 'Nutriments', de: 'Nährstoffe', es: 'Nutrientes' },
  rowData: {
    en: 'Last measurement',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medición',
  },
  rowFertilise: {
    en: 'Next fertilizing',
    fr: 'Prochain engrais',
    de: 'Nächste Düngung',
    es: 'Próximo abonado',
  },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowNoData: { en: 'none yet', fr: 'aucune', de: 'noch keine', es: 'ninguna' },
  rowOverdue: {
    en: '{date} (due)',
    fr: '{date} (à faire)',
    de: '{date} (fällig)',
    es: '{date} (pendiente)',
  },

  // widgets: cards, badges (16 characters at most)
  badgeThirsty: { en: 'Thirsty', fr: 'Assoiffée', de: 'Durstig', es: 'Con sed' },
  badgeSilent: { en: 'No data', fr: 'Sans données', de: 'Ohne Daten', es: 'Sin datos' },
  cardSilent: {
    en: 'No measurement since {time}',
    fr: 'Aucune mesure depuis {time}',
    de: 'Keine Messung seit {time}',
    es: 'Sin medición desde {time}',
  },
  cardSilentNever: {
    en: 'No measurement yet',
    fr: 'Aucune mesure pour l’instant',
    de: 'Noch keine Messung',
    es: 'Aún sin medición',
  },
  cardBattery: {
    en: 'Sensor battery low',
    fr: 'Batterie du capteur faible',
    de: 'Sensorbatterie schwach',
    es: 'Batería del sensor baja',
  },
  problem: {
    en: '{measure}: {level}',
    fr: '{measure} : {level}',
    de: '{measure}: {level}',
    es: '{measure}: {level}',
  },
  cardIdeal: {
    en: 'ideal {min}–{max} {unit}',
    fr: 'idéal {min}–{max} {unit}',
    de: 'ideal {min}–{max} {unit}',
    es: 'ideal {min}–{max} {unit}',
  },

  // widgets: messages (300 characters at most)
  widgetAllGood: {
    en: 'All your plants are doing great.',
    fr: 'Toutes vos plantes sont en pleine forme.',
    de: 'Allen deinen Pflanzen geht es bestens.',
    es: 'Todas sus plantas están en perfecto estado.',
  },
  widgetNoSensor: {
    en: '{count} plant(s) without a sensor are not shown.',
    fr: '{count} plante(s) sans capteur ne sont pas affichées.',
    de: '{count} Pflanze(n) ohne Sensor werden nicht angezeigt.',
    es: '{count} planta(s) sin sensor no se muestran.',
  },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  toastRefreshed: {
    en: 'FYTA read: {count} plant(s).',
    fr: 'FYTA lu : {count} plante(s).',
    de: 'FYTA gelesen: {count} Pflanze(n).',
    es: 'FYTA leído: {count} planta(s).',
  },
  toastTooSoon: {
    en: 'Read less than a minute ago: the values are up to date.',
    fr: 'Lu il y a moins d’une minute : les valeurs sont à jour.',
    de: 'Vor weniger als einer Minute gelesen: die Werte sind aktuell.',
    es: 'Leído hace menos de un minuto: los valores están al día.',
  },

  // connection status and errors (200 characters at most)
  statusNoCredentials: {
    en: 'Enter the e-mail address and the password of your FYTA account.',
    fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte FYTA.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines FYTA-Kontos ein.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta FYTA.',
  },
  statusWaiting: {
    en: 'Configuration saved: the plants are read in a moment.',
    fr: 'Configuration enregistrée : les plantes sont lues dans un instant.',
    de: 'Konfiguration gespeichert: die Pflanzen werden gleich gelesen.',
    es: 'Configuración guardada: las plantas se leen en un momento.',
  },
  statusNoPlant: {
    en: 'Connected, but this FYTA account has no plant with a sensor.',
    fr: 'Connecté, mais ce compte FYTA n’a aucune plante avec un capteur.',
    de: 'Verbunden, aber dieses FYTA-Konto hat keine Pflanze mit Sensor.',
    es: 'Conectado, pero esta cuenta FYTA no tiene ninguna planta con sensor.',
  },
  statusOk: {
    en: 'Connected: {count} plant(s), {care} to care for.',
    fr: 'Connecté : {count} plante(s), {care} à soigner.',
    de: 'Verbunden: {count} Pflanze(n), {care} zu pflegen.',
    es: 'Conectado: {count} planta(s), {care} por cuidar.',
  },
  statusPaused: {
    en: 'FYTA asked to slow down: readings paused for a while.',
    fr: 'FYTA a demandé de ralentir : lectures en pause un moment.',
    de: 'FYTA bat ums Verlangsamen: Abfragen kurz pausiert.',
    es: 'FYTA pidió ir más despacio: lecturas en pausa un momento.',
  },
  errUnknownAccount: {
    en: 'FYTA does not know this e-mail address: check it in the configuration.',
    fr: 'FYTA ne connaît pas cette adresse e-mail : vérifiez-la dans la configuration.',
    de: 'FYTA kennt diese E-Mail-Adresse nicht: prüfe sie in der Konfiguration.',
    es: 'FYTA no conoce esta dirección de correo: compruébela en la configuración.',
  },
  errWrongPassword: {
    en: 'FYTA refused the password: check it in the configuration.',
    fr: 'FYTA a refusé le mot de passe : vérifiez-le dans la configuration.',
    de: 'FYTA hat das Passwort abgelehnt: prüfe es in der Konfiguration.',
    es: 'FYTA rechazó la contraseña: compruébela en la configuración.',
  },
  errToken: {
    en: 'FYTA refused the access of this account even after a new login.',
    fr: 'FYTA refuse l’accès de ce compte, même après une nouvelle connexion.',
    de: 'FYTA verweigert den Zugriff dieses Kontos, auch nach neuer Anmeldung.',
    es: 'FYTA rechaza el acceso de esta cuenta, incluso tras un nuevo inicio de sesión.',
  },
  errRateLimit: {
    en: 'FYTA asked to slow down (HTTP 429): the next reading waits.',
    fr: 'FYTA a demandé de ralentir (HTTP 429) : la prochaine lecture attend.',
    de: 'FYTA bat ums Verlangsamen (HTTP 429): die nächste Abfrage wartet.',
    es: 'FYTA pidió ir más despacio (HTTP 429): la próxima lectura espera.',
  },
  errServer: {
    en: 'The FYTA server is in error: tried again at the next reading.',
    fr: 'Le serveur FYTA est en erreur : nouvel essai à la prochaine lecture.',
    de: 'Der FYTA-Server meldet einen Fehler: neuer Versuch bei der nächsten Abfrage.',
    es: 'El servidor de FYTA da error: nuevo intento en la próxima lectura.',
  },
  errUnreachable: {
    en: 'FYTA cannot be reached: check the Internet access of Gladys.',
    fr: 'FYTA est injoignable : vérifiez l’accès Internet de Gladys.',
    de: 'FYTA ist nicht erreichbar: prüfe den Internetzugang von Gladys.',
    es: 'No se puede contactar con FYTA: compruebe el acceso a Internet de Gladys.',
  },
  errFailed: {
    en: 'FYTA error: {detail}',
    fr: 'Erreur FYTA : {detail}',
    de: 'FYTA-Fehler: {detail}',
    es: 'Error de FYTA: {detail}',
  },
  errNoPlant: {
    en: 'No FYTA plant with a sensor: choose a plant created in Gladys.',
    fr: 'Aucune plante FYTA avec capteur : choisissez une plante créée dans Gladys.',
    de: 'Keine FYTA-Pflanze mit Sensor: wähle eine in Gladys angelegte Pflanze.',
    es: 'Ninguna planta FYTA con sensor: elija una planta creada en Gladys.',
  },

  // scene actions (1,000 characters at most)
  summaryAllGood: {
    en: 'All {count} plant(s) are doing great.',
    fr: 'Les {count} plante(s) sont en pleine forme.',
    de: 'Allen {count} Pflanze(n) geht es bestens.',
    es: 'Las {count} planta(s) están en perfecto estado.',
  },
  summaryLine: {
    en: '{name}: {problems}',
    fr: '{name} : {problems}',
    de: '{name}: {problems}',
    es: '{name}: {problems}',
  },
  summaryPlant: {
    en: '{name}: {state}. Soil moisture {moisture}, light {light}, temperature {temperature}, salinity {salinity}, battery {battery}.',
    fr: '{name} : {state}. Humidité du sol {moisture}, lumière {light}, température {temperature}, salinité {salinity}, batterie {battery}.',
    de: '{name}: {state}. Bodenfeuchte {moisture}, Licht {light}, Temperatur {temperature}, Salzgehalt {salinity}, Batterie {battery}.',
    es: '{name}: {state}. Humedad del suelo {moisture}, luz {light}, temperatura {temperature}, salinidad {salinity}, batería {battery}.',
  },

  summarySilent: {
    en: 'no measurement for {hours} h',
    fr: 'aucune mesure depuis {hours} h',
    de: 'keine Messung seit {hours} Std.',
    es: 'sin medición desde hace {hours} h',
  },
  summaryNever: {
    en: 'no measurement yet',
    fr: 'aucune mesure pour l’instant',
    de: 'noch keine Messung',
    es: 'aún sin medición',
  },

  // configuration buttons
  testOk: {
    en: 'Connected to FYTA: {count} plant(s) with a sensor{names}.',
    fr: 'Connecté à FYTA : {count} plante(s) avec capteur{names}.',
    de: 'Mit FYTA verbunden: {count} Pflanze(n) mit Sensor{names}.',
    es: 'Conectado a FYTA: {count} planta(s) con sensor{names}.',
  },
  testWithout: {
    en: '{count} plant(s) without a sensor left out.',
    fr: '{count} plante(s) sans capteur ignorée(s).',
    de: '{count} Pflanze(n) ohne Sensor ausgelassen.',
    es: '{count} planta(s) sin sensor omitida(s).',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration in {count} line(s) “FYTA diagnostic” (no password, no token).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration en {count} ligne(s) « FYTA diagnostic » (sans mot de passe ni jeton).',
    de: 'Diagnose in {count} Zeile(n) „FYTA diagnostic“ in die Logs der Integration geschrieben (ohne Passwort und Token).',
    es: 'Diagnóstico escrito en los registros de la integración en {count} línea(s) «FYTA diagnostic» (sin contraseña ni token).',
  },

  // times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
};

export { TEXTS };
