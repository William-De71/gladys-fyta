# FYTA

## Presentación

Esta integración trae las plantas de su cuenta FYTA a Gladys: las mediciones de sus sensores de plantas **FYTA Beam** (humedad del suelo, luz, temperatura, batería) y lo que FYTA opina de ellas (demasiado bajo, perfecto, demasiado alto), mediante la [API pública oficial de FYTA](https://fyta-io.notion.site/FYTA-Public-API-d2f4c30306f74504924c9a40402a3afd) con la dirección de correo y la contraseña de su cuenta FYTA. Solo lee. No está afiliada a FYTA.

- Un dispositivo por planta con sensor: humedad del suelo, luz, temperatura, batería del sensor y su indicador de batería baja, el pH cuando FYTA lo da, y los estados que da FYTA (planta, humedad del suelo, luz, temperatura, salinidad, nutrientes).
- Dos widgets del panel: las plantas por cuidar, las peores primero; una planta con su foto.
- Disparadores de escena: planta necesita atención, planta con sed, medida fuera de rango, medida de nuevo en rango, batería del sensor baja, sensor sin señal, sensor de vuelta, toca abonar, acceso rechazado.
- Acciones de escena: actualizar ahora, los valores de una planta, el resumen de las plantas por cuidar.

Transporte: nube. La dirección de correo y la contraseña van a FYTA (`web.fyta.de`) para iniciar sesión; las mediciones de sus plantas vienen de la nube de FYTA, que las recibe de sus Beam a través del FYTA Hub o de la aplicación FYTA.

## Requisitos previos

- Gladys Assistant 5.3.0 o posterior.
- Una cuenta FYTA (la de la aplicación FYTA) con al menos una planta asociada a un sensor **FYTA Beam**. Las plantas sin sensor no se ofrecen.
- Las mediciones deben llegar a la nube de FYTA: a través de un **FYTA Hub**, o de la aplicación FYTA cuando su teléfono está cerca del Beam. Sin hub, los valores solo cambian cuando la aplicación se sincroniza.
- La API solo inicia sesión con una dirección de correo y una contraseña: use las que utiliza en la aplicación FYTA.

Frescura de los datos: un Beam envía sus mediciones aproximadamente una vez por hora. Leer FYTA más a menudo no aporta nada nuevo; FYTA considera un sensor en error tras 1,5 horas sin medición.

## Configuración

| Campo                       | Significado                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dirección de correo         | El correo de su cuenta FYTA                                                                                                   |
| Contraseña                  | Su contraseña (un secreto: nunca se vuelve a mostrar ni se escribe en los registros ni en `/data`)                            |
| Lectura de las plantas      | Cada 10, 15 (por defecto), 30 o 60 minutos; el detalle de una planta solo se lee si FYTA muestra novedades                    |
| Sensor sin datos después de | 2, 3 (por defecto), 6, 12 o 24 horas sin una nueva medición                                                                   |
| Idioma de los textos        | Nombres de las funciones, estados (demasiado bajo, perfecto…), textos de escenas y errores; automático sigue el último widget |

Botones:

- **Probar la conexión** inicia sesión en FYTA y enumera las plantas con sensor (y cuántas no tienen).
- **Diagnóstico** escribe el estado de la integración en sus registros, sin la contraseña ni el token.

La integración guarda en `/data` (legible solo por ella) el token de acceso que FYTA da al iniciar sesión, hasta que caduca (60 días según la documentación de FYTA), para no volver a iniciar sesión en cada reinicio.

## Uso

### Dispositivos

Tras la configuración, abra **Descubrir**: cada planta con sensor se ofrece como un dispositivo con el apodo que tiene en la aplicación FYTA. Añada las que quiera.

| Función                                                                     | Categoría / tipo                   | Unidad    |
| --------------------------------------------------------------------------- | ---------------------------------- | --------- |
| Humedad del suelo                                                           | `soil-moisture-sensor` / `decimal` | %         |
| Luz (flujo de fotones, como lo mide FYTA)                                   | `light-sensor` / `decimal`         | µmol/m²/s |
| Temperatura                                                                 | `temperature-sensor` / `decimal`   | °C        |
| pH del suelo (solo si FYTA lo da)                                           | `ph-sensor` / `decimal`            | pH        |
| Batería del sensor                                                          | `battery` / `integer`              | %         |
| Batería del sensor baja                                                     | `battery-low` / `binary`           | —         |
| Estados: planta, humedad del suelo, luz, temperatura, salinidad, nutrientes | `text` / `text`                    | —         |

La luz es un flujo de fotones (PPFD, µmol/m²/s), no lux: Gladys no tiene unidad para ella, así que el valor se muestra sin unidad y su nombre lo indica. La salinidad (abono, mS/cm) no tiene una categoría adecuada en Gladys: su estado es una función, su valor está en el widget y en las escenas.

### Widgets del panel

![Los dos widgets: las plantas por cuidar (una Monstera con sed, un Ficus sin datos) y una planta con su foto, sus medidas y sus estados (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-fyta/main/docs/assets/widgets.es.png)

- **Plantas por cuidar**: cuántas plantas necesitan cuidados, están perfectas, no envían datos; luego las plantas por cuidar, las peores primero (con sed, muy fuera de rango, fuera de rango, sensor sin señal, batería baja). Toque una planta para ver los valores y su rango ideal. El botón **Actualizar** lee FYTA en ese momento (como mucho una vez por minuto).
- **Planta FYTA**: una planta (elíjala en los ajustes del widget; la primera por defecto): su foto de la aplicación FYTA, la humedad del suelo, la luz, la temperatura, la salinidad y la batería coloreadas según su estado, el estado de la planta y de sus nutrientes, la última medición y la fecha del próximo abonado.

### Escenas

Disparadores (una vez por cambio, nunca en la primera lectura, nunca por una acción de escena), filtrables por planta:

- **Planta necesita atención**: el estado FYTA de la planta pasa de «en perfecto estado» a «necesita atención».
- **Planta con sed**: la humedad del suelo entra en el rango bajo o demasiado bajo de la planta.
- **Medida fuera de rango**: la humedad del suelo, la luz, la temperatura, la salinidad o los nutrientes pasan a bajo, demasiado bajo, alto o demasiado alto (filtros: medidas, niveles).
- **Medida de nuevo en rango**: una medida vuelve a perfecto.
- **Batería del sensor baja**: FYTA marca la batería del sensor.
- **Sensor sin señal** / **Sensor de vuelta**: ninguna medición durante el plazo de la configuración, luego mediciones de nuevo.
- **Toca abonar**: se alcanza la fecha prevista por FYTA, a las 9:00.
- **Acceso rechazado**: FYTA rechaza la dirección de correo, la contraseña o la cuenta.

Acciones:

- **Actualizar ahora**: lee todas las plantas (como mucho una vez por minuto); devuelve el número de plantas y de plantas por cuidar.
- **Valores de una planta**: humedad del suelo, luz, temperatura, salinidad, batería, sus estados y una frase, según la última lectura.
- **Plantas por cuidar**: cuántas, cuáles y por qué, en una frase, para un mensaje diario.

Ejemplos:

- Cuando **FYTA: planta con sed** → enviar «{{triggerEvent.data.plant_name}} tiene sed ({{triggerEvent.data.moisture}} %)».
- Cada día a las 8:00 → **FYTA: plantas por cuidar**; si el número es mayor que 0 → enviar su resumen.
- Cuando **FYTA: sensor sin señal** → enviar «Sin noticias de {{triggerEvent.data.plant_name}} desde hace {{triggerEvent.data.hours_without_data}} h: ¿está encendido el hub?».

## Solución de problemas

- **«FYTA no conoce esta dirección de correo»** o **«rechazó la contraseña»**: compruébelas iniciando sesión en la aplicación FYTA con la misma dirección y la misma contraseña.
- **Ningún dispositivo ofrecido**: solo se ofrecen las plantas asociadas a un Beam; pulse **Probar la conexión** para ver lo que devuelve FYTA.
- **Valores que no cambian**: el Beam necesita un FYTA Hub, o la aplicación FYTA abierta cerca, para enviar sus mediciones; la fila «Última medición» del widget de la planta indica cuándo FYTA recibió una.
- **Luz sin unidad**: es intencionado, vea Dispositivos.
- **Una temperatura en °F** en la aplicación FYTA: la integración la convierte a °C cuando FYTA lo indica (no probado con una cuenta real).
- Para una incidencia, indique las versiones de Gladys y de la integración, el mensaje de **Probar la conexión** y las líneas «FYTA diagnostic» que **Diagnóstico** escribe en los registros de la integración. No pegue nunca su contraseña.
