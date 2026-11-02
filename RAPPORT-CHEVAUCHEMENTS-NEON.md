# Rapport — migration Neon bloquée par des chevauchements réels (2026-11-02)

## Situation

La migration additive `20261101000000_sync_offline_first` est **prête mais non
appliquée en production** : le diagnostic préalable intégré à la migration a
détecté des rendez-vous en chevauchement et s'est **arrêté sans rien
modifier** — exactement le garde-fou prévu dans le plan approuvé (§1.5bis-b).

Backup fraîche créé avant tentative :
`backups/prod-avant-mise-en-service-2026-11-02T*.dump` (voir le dossier
`backups/` pour l'horodatage exact). Le backup vérifié initial
(`prod-verifiee-2026-11-01T20-23-25.dump`) reste intact.

## Inventaire des chevauchements (lecture seule, 17 paires détectées)

Analyse détaillée ci-dessous. **Deux catégories très différentes** :

### Catégorie 1 — Chevauchements PARTIELS (2 paires, anciens, réels)

| Date | Patient A | Patient B | Chevauchement |
|---|---|---|---|
| 01/08 10:45–11:30 | Kaci Samira [10:45→11:15] | Saidi Yasmine [11:00→11:30] | 15 min (11:00–11:15) |
| 20/08 14:00–14:45 | Belkacem Yacine [14:00→14:30] | Bouzid Aya [14:15→14:45] | 15 min (14:15–14:30) |

Deux vrais rendez-vous qui se croisent de 15 minutes — probables erreurs de
saisie historiques, tous deux déjà TERMINÉ.

### Catégorie 2 — Créneaux EXACTEMENT identiques (15 paires, presque toutes le 30/09 à 11:52)

Presque toutes créées **le même jour à la même minute** (2026-09-30 11:52),
avec des patients différents sur le même créneau :

| Date/heure | Paires |
|---|---|
| 30/09 10:00–10:30 | Larbi Samira ↔ Benaissa Amir |
| 30/09 11:00–11:30 | Saidi Yasmine ↔ Belkacem Nabil ; Belkacem Adel ↔ Saidi Yasmine ; Belkacem Adel ↔ Belkacem Nabil |
| 30/09 12:00–12:30 | Sellouk Sarah ↔ Kaci Adel |
| 30/09 13:00–13:30 | Kaci Samira ↔ Kaci Sofiane |
| 30/09 16:00–16:30 | Ait Ahmed Omar ↔ Kaci Sofiane |
| 01/10 09:00–09:30 | Ait Ahmed Omar ↔ Ait Ahmed Hayet |
| 15/10 09:00–09:30 | Boudiaf Amina ↔ Saidi Nabil ; Guerbabi Aya ↔ Saidi Nabil ; Kaci Samira ↔ Saidi Nabil ; Boudiaf Amina ↔ Guerbabi Aya ; Boudiaf Amina ↔ Kaci Samira ; Guerbabi Aya ↔ Kaci Samira |
| 21/10 09:00–09:30 | Benaissa Rania ↔ Ziani Amina |

**Observation critique** : les paires du 15/10 à 09:00 forment un **triangle**
(Boudiaf ↔ Saidi, Guerbabi ↔ Saidi, Kaci ↔ Saidi, Boudiaf ↔ Guerbabi,
Boudiaf ↔ Kaci, Guerbabi ↔ Kaci) — 4 rendez-vous distincts sur LE MÊME
créneau. Ce motif (plusieurs patients « réservations en rafale » sur un même
créneau, créées à la seconde près) ressemble fortement à des **données de
démonstration ou de test de charge**, pas à une planification réelle.

## Décision requise — je n'arbitre PAS seul

Trois options, au choix :

**Option 1 (recommandée si les créneaux exacts sont du test)** — confirmer
la liste des RDV en créneau exact dupliqué à traiter comme données de test,
les passer à la corbeille (réversible), puis relancer la migration. Les RDV
« chevauchement partiel » du 01/08 et 20/08 seraient conservés tels quels :
la contrainte EXCLUDE ne s'applique qu'aux NOUVELLES insertions, pas aux
lignes existantes (PostgreSQL valide la contrainte à la création, mais on
peut la créer `NOT VALID` puis `VALIDATE` plus tard après nettoyage).

**Option 2** — créer la contrainte en `NOT VALID` : elle s'applique aux
nouvelles réservations (l'objectif anti-double-réservation est atteint)
sans bloquer sur l'historique. Les 17 paires existantes restent en base,
visibles dans un rapport d'arbitrage pour le médecin. **C'est l'option la
plus prudente** : rien n'est supprimé, la production est débloquée
immédiatement, et le nettoyage historique peut se faire plus tard sereinement.

**Option 3** — arbitrer manuellement les 17 paires d'abord (annuler/décaler),
puis créer la contrainte `VALID`. Le plus long, à réserver si vous voulez un
historique parfaitement propre avant la mise en service.

## Ma recommandation

**Option 2** (contrainte `NOT VALID` + rapport d'arbitrage fourni au
médecin) : la production est débloquée sans toucher à aucune donnée, le
comportement anti-double-réservation est actif immédiatement pour tout
nouveau RDV (le vrai besoin), et l'arbitrage historique devient une tâche
non bloquante.

## Ce qui reste bloqué en attendant votre choix

- Application de la migration sur Neon (étape 2).
- Création des comptes définitifs (étape 3) — **peut être faite
  indépendamment** de la migration si vous voulez débloquer les accès web
  tout de suite (la table `finance_sessions` existe déjà en prod d'après
  l'inventaire précédent ; seul le rôle ASSISTANT nécessite une ligne de
  code, déjà prête).
- Purge des 6 patients de test (étape 4) — indépendante de la migration.

Dites-moi : **Option 1, 2 ou 3**, et si je peux lancer les étapes 3 et 4 en
parallèle (elles ne dépendent pas de la migration).
