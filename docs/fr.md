# FYTA

## Présentation

Cette intégration amène les plantes de votre compte FYTA dans Gladys : les mesures de vos capteurs de plantes **FYTA Beam** (humidité du sol, lumière, température, batterie) et ce que FYTA en pense (trop faible, parfait, trop élevé), par l’[API publique officielle de FYTA](https://fyta-io.notion.site/FYTA-Public-API-d2f4c30306f74504924c9a40402a3afd) avec l’adresse e-mail et le mot de passe de votre compte FYTA. Elle ne fait que lire. Elle n’est pas affiliée à FYTA.

- Un appareil par plante équipée d’un capteur : humidité du sol, lumière, température, batterie du capteur et son indicateur de batterie faible, le pH quand FYTA en donne un, et les états donnés par FYTA (plante, humidité du sol, lumière, température, salinité, nutriments).
- Deux widgets de tableau de bord : les plantes à soigner, les pires d’abord ; une plante avec sa photo.
- Déclencheurs de scène : plante à surveiller, plante assoiffée, mesure hors plage, mesure revenue dans la plage, batterie du capteur faible, capteur muet, capteur de retour, engrais à apporter, accès refusé.
- Actions de scène : actualiser maintenant, les valeurs d’une plante, le résumé des plantes à soigner.

Transport : cloud. L’adresse e-mail et le mot de passe partent chez FYTA (`web.fyta.de`) pour se connecter ; les mesures de vos plantes viennent du cloud de FYTA, qui les reçoit de vos Beam par le FYTA Hub ou l’application FYTA.

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- Un compte FYTA (celui de l’application FYTA) avec au moins une plante associée à un capteur **FYTA Beam**. Les plantes sans capteur ne sont pas proposées.
- Les mesures doivent arriver dans le cloud de FYTA : par un **FYTA Hub**, ou par l’application FYTA quand votre téléphone est près du Beam. Sans hub, les valeurs ne changent qu’à la synchronisation de l’application.
- L’API se connecte uniquement avec une adresse e-mail et un mot de passe : utilisez ceux avec lesquels vous vous connectez à l’application FYTA.

Fraîcheur des données : un Beam envoie ses mesures environ une fois par heure. Lire FYTA plus souvent n’apporte rien de neuf ; FYTA considère un capteur en erreur après 1 h 30 sans mesure.

## Configuration

| Champ                      | Signification                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Adresse e-mail             | L’e-mail de votre compte FYTA                                                                                              |
| Mot de passe               | Son mot de passe (un secret : jamais réaffiché, jamais écrit dans les journaux ni dans `/data`)                            |
| Lecture des plantes        | Toutes les 10, 15 (par défaut), 30 ou 60 minutes ; le détail d’une plante n’est lu que si FYTA montre du nouveau           |
| Capteur sans données après | 2, 3 (par défaut), 6, 12 ou 24 heures sans nouvelle mesure                                                                 |
| Langue des textes          | Noms des fonctionnalités, états (trop faible, parfait…), textes des scènes et erreurs ; automatique suit le dernier widget |

Boutons :

- **Tester la connexion** se connecte à FYTA et liste les plantes avec capteur (et combien n’en ont pas).
- **Diagnostic** écrit l’état de l’intégration dans ses journaux, sans le mot de passe ni le jeton.

L’intégration garde dans `/data` (lisible par elle seule) le jeton d’accès que FYTA donne à la connexion, jusqu’à son expiration (60 jours selon la documentation de FYTA), pour ne pas se reconnecter à chaque redémarrage.

## Utilisation

### Appareils

Après la configuration, ouvrez **Découvrir** : chaque plante avec capteur est proposée comme un appareil, nommé d’après son surnom dans l’application FYTA. Ajoutez celles que vous voulez.

| Fonctionnalité                                                              | Catégorie / type                   | Unité     |
| --------------------------------------------------------------------------- | ---------------------------------- | --------- |
| Humidité du sol                                                             | `soil-moisture-sensor` / `decimal` | %         |
| Lumière (flux de photons, comme FYTA la mesure)                             | `light-sensor` / `decimal`         | µmol/m²/s |
| Température                                                                 | `temperature-sensor` / `decimal`   | °C        |
| pH du sol (seulement si FYTA en donne un)                                   | `ph-sensor` / `decimal`            | pH        |
| Batterie du capteur                                                         | `battery` / `integer`              | %         |
| Batterie du capteur faible                                                  | `battery-low` / `binary`           | —         |
| États : plante, humidité du sol, lumière, température, salinité, nutriments | `text` / `text`                    | —         |

La lumière est un flux de photons (PPFD, µmol/m²/s), pas des lux : Gladys n’a pas d’unité pour elle, la valeur s’affiche donc sans unité et son nom le précise. La salinité (engrais, mS/cm) n’a pas de catégorie adaptée dans Gladys : son état est une fonctionnalité, sa valeur est dans le widget et les scènes.

### Widgets du tableau de bord

![Les deux widgets : les plantes à soigner (un Monstera assoiffé, un Ficus sans données) et une plante avec sa photo, ses mesures et ses états (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-fyta/main/docs/assets/widgets.fr.png)

- **Plantes à soigner** : combien de plantes ont besoin de soins, sont en forme, n’envoient pas de données ; puis les plantes à soigner, les pires d’abord (assoiffée, très hors plage, hors plage, capteur muet, batterie faible). Touchez une plante pour voir les valeurs et leur plage idéale. Le bouton **Actualiser** lit FYTA tout de suite (une fois par minute au plus).
- **Plante FYTA** : une plante (à choisir dans les réglages du widget ; la première par défaut) : sa photo de l’application FYTA, l’humidité du sol, la lumière, la température, la salinité et la batterie colorées selon leur état, l’état de la plante et de ses nutriments, la dernière mesure et la date du prochain engrais.

### Scènes

Déclencheurs (une fois par changement, jamais à la première lecture, jamais à cause d’une action de scène), filtrables par plante :

- **Plante à surveiller** : l’état FYTA de la plante passe de « en pleine forme » à « à surveiller ».
- **Plante assoiffée** : l’humidité du sol entre dans la plage faible ou trop faible de la plante.
- **Mesure hors plage** : l’humidité du sol, la lumière, la température, la salinité ou les nutriments passent à faible, trop faible, élevé ou trop élevé (filtres : mesures, niveaux).
- **Mesure revenue dans la plage** : une mesure redevient parfaite.
- **Batterie du capteur faible** : FYTA signale la batterie du capteur.
- **Capteur muet** / **Capteur de retour** : aucune mesure pendant le délai de la configuration, puis de nouveau des mesures.
- **Engrais à apporter** : la date prévue par FYTA est atteinte, à 9 h.
- **Accès refusé** : FYTA refuse l’adresse e-mail, le mot de passe ou le compte.

Actions :

- **Actualiser maintenant** : lit toutes les plantes (une fois par minute au plus) ; renvoie le nombre de plantes et de plantes à soigner.
- **Valeurs d’une plante** : humidité du sol, lumière, température, salinité, batterie, leurs états et une phrase, d’après la dernière lecture.
- **Plantes à soigner** : combien, lesquelles et pourquoi, en une phrase, pour un message quotidien.

Exemples :

- Quand **FYTA : plante assoiffée** → envoyer « {{triggerEvent.data.plant_name}} a soif ({{triggerEvent.data.moisture}} %) ».
- Chaque jour à 8 h → **FYTA : plantes à soigner** ; si le nombre dépasse 0 → envoyer son résumé.
- Quand **FYTA : capteur muet** → envoyer « Pas de nouvelles de {{triggerEvent.data.plant_name}} depuis {{triggerEvent.data.hours_without_data}} h : le hub est-il allumé ? ».

## Dépannage

- **« FYTA ne connaît pas cette adresse e-mail »** ou **« a refusé le mot de passe »** : vérifiez-les en vous connectant à l’application FYTA avec la même adresse et le même mot de passe.
- **Aucun appareil proposé** : seules les plantes associées à un Beam sont proposées ; appuyez sur **Tester la connexion** pour voir ce que FYTA renvoie.
- **Des valeurs qui ne bougent pas** : le Beam a besoin d’un FYTA Hub, ou de l’application FYTA ouverte à proximité, pour envoyer ses mesures ; la ligne « Dernière mesure » du widget de la plante indique quand FYTA en a reçu une.
- **Lumière sans unité** : c’est voulu, voir Appareils.
- **Une température en °F** dans l’application FYTA : l’intégration la convertit en °C quand FYTA l’indique (pas testé avec un vrai compte).
- Pour un ticket, donnez les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les lignes « FYTA diagnostic » écrites par **Diagnostic** dans les journaux de l’intégration. Ne collez jamais votre mot de passe.
