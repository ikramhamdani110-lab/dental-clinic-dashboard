# SYNCHRONISATION DU POSTE DE BUREAU — Appairage et utilisation

> ⚠️ **L'activation de la synchronisation en production est soumise à votre
> approbation** — voir `docs/ACTIVATION-PRODUCTION.md`. Sans activation,
> l'application de bureau fonctionne intégralement hors ligne (tout le reste
> de ce document reste applicable le jour de l'activation).

> L'application de bureau fonctionne **intégralement sans Internet**. La
> synchronisation est un service **complémentaire** : quand Internet revient,
> les données circulent automatiquement dans les DEUX sens entre le poste et
> le système en ligne (site secrétaire + site médecin).

## 1. Connecter le poste au système en ligne (appairage)

À faire **une seule fois**, avec Internet disponible (au cabinet ou en
partage de connexion mobile — quelques minutes suffisent) :

1. Ouvrez l'application de bureau et connectez-vous normalement (usage local).
2. Dans la fenêtre de bureau, l'indicateur sous le titre de page affiche
   « Synchronisation désactivée (appairage requis) ».
3. Récupérez le jeton de session : sur le poste, ouvrez la page de connexion
   du site en ligne (`https://dental-clinic-dashboard-snowy.vercel.app/connexion`)
   dans la fenêtre d'appairage dédiée et connectez-vous avec le compte du
   cabinet (`clinic@gmail.dz`). Le mot de passe n'est jamais vu par
   l'application : seule la session est utilisée pour appairer.
4. Confirmez l'appairage depuis la page **/parametres** du site en ligne
   (« Appairer ce poste »). Le poste reçoit un **jeton d'appareil** unique,
   stocké chiffré (DPAPI Windows) — aucun secret dans l'application, aucun
   identifiant de base de données sur le poste.
5. L'indicateur passe à « Synchronisation en cours… » puis « Synchronisé ».

> La **phrase de récupération** affichée lors de l'appairage doit être notée
> et conservée hors du poste. Elle ne sera plus jamais affichée.

## 2. Ce qui se synchronise

| Entité | Sens | Règle de conflit |
|---|---|---|
| Patients | ⇄ bidirectionnel | Fusion champ par champ ; champ modifié des deux côtés → conflit visible |
| Rendez-vous | ⇄ | Anti-chevauchement appliqué des deux côtés ; conflit de créneau → arbitrage |
| Traitements | ⇄ | Écriture concurrente → statut `A_ARBITRER`, verrouillé, JAMAIS écrasé |
| Paiements | ⇄ | JAMAIS d'écrasement ni de doublon (idempotence stricte) ; conflit → `A_ARBITRER` et exclu des revenus jusqu'à arbitrage médecin |
| Ordonnances | ⇄ | Conflit conservé en double version |
| Odontogramme | ⇄ | Historique d'ajouts : jamais modifié, jamais écrasé |
| Dossiers médicaux | ⇄ | Conflit conservé en double version |
| Documents (métadonnées) | ⇄ | Jamais écrasés |
| Suppressions | ⇄ | Tombstones réversibles (corbeille 24 h) — jamais de suppression silencieuse |

## 3. Comprendre l'indicateur

| Message | Signification |
|---|---|
| `Synchronisé` | Tout est remonté et téléchargé (heure affichée) |
| `Synchronisation en cours…` | Échange en cours |
| `Hors ligne — données enregistrées sur cet ordinateur` | Pas d'Internet : tout continue de fonctionner localement |
| `Synchronisation désactivée (appairage requis)` | Poste pas encore appairé (voir §1) |
| `Session en ligne expirée — reconnexion requise` | Refaire l'étape 3 de l'appairage |
| `Échec de synchronisation` | Erreur technique : les données locales sont en sécurité, nouvel essai automatique |
| `N en attente · N conflit(s) à résoudre` | Nombre d'opérations non encore remontées / à arbitrer |

## 4. Résolution des conflits

Un conflit n'est **jamais** résolu automatiquement pour les données médicales
ou financières : les deux versions sont conservées (locale + distante) et le
paiement/traitement concerné passe en `A_ARBITRER`, **exclu des calculs
financiers** jusqu'à la décision du médecin, tracée dans le journal d'activité.

## 5. Sécurité

- HTTPS obligatoire vers le serveur en ligne (sauf test local explicite).
- Le jeton d'appareil est chiffré par Windows (DPAPI, profil utilisateur) ;
  il est révocable à tout moment depuis /parametres côté web.
- Aucune chaîne de connexion, aucun mot de passe, aucun secret dans
  l'installateur ou les journaux.
