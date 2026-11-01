# RAPPORT DE LIVRAISON — SAHED DENTAL CLINIC (mise en service réelle)

> Date : 2026-11-01. Ce rapport ne contient **aucun mot de passe** : les
> identifiants sont transmis au Dr. Sahed par un canal privé (voir §5).

---

## 1. Application secrétaire (web)

| Élément | Valeur | Vérification |
|---|---|---|
| URL publique | **https://dental-clinic-dashboard-snowy.vercel.app/connexion** | ✔ répond 200, page de connexion affichée |
| Email de connexion | `demo@cabinet.local` — **voir note importante §5** | ✔ compte actif dans la base (lecture seule vérifiée) |
| Mot de passe | transmis séparément (canal privé) — non consigné ici | — |

**Note importante sur les identifiants** : le compte secrétaire actuellement
en production utilise l'email de démonstration `demo@cabinet.local`. **Je n'ai
pas réinitialisé ni inventé de mot de passe** (règle §5 de la demande) : le mot
de passe actuel est celui qui a été fixé lors de la mise en place et il doit
vous être remis par le canal que vous aurez choisi. Si vous préférez un email
professionnel (ex. `secretaire@cabinet…`), c'est une création de compte
expresse à demander — je ne l'ai pas fait sans instruction.

Le test réel de connexion en production a été effectué par navigateur lors de
l'audit (atterrissage sur `/tableau-de-bord`, indicateurs affichés) avec ce
compte — la procédure de connexion fonctionne.

**Instructions de connexion** : ouvrir l'URL → saisir email → mot de passe →
bouton « Connexion ». Après 5 échecs, le compte se verrouille 15 minutes
(protection anti-force brute).

## 2. Application privée du médecin (finances)

| Élément | Valeur | Vérification |
|---|---|---|
| URL privée | **https://dental-clinic-dashboard-snowy.vercel.app/finances/connexion** | ✔ répond (redirection vers connexion si non authentifié) |
| Email du médecin | celui du compte `MEDECIN` existant en production (lecture vérifiée — valeur transmise en privé, pas dans ce rapport) | ✔ |
| Mot de passe | transmis séparément — changement **obligatoire** demandé à la première connexion si sentinelle initiale | ✔ mécanisme vérifié |

**Isolation des rôles — vérifiée en production :**
- Test réel : cookie de session **secrétaire** envoyé sur `/api/finances/summary`
  → **401/403 refusé** (audité deux fois, preuve dans RAPPORT-AUDIT-FINAL.md §6).
- La navigation secrétaire ne contient aucun lien finances ; l'écran secrétaire
  n'affiche aucun montant financier.
- Le site financier a sa **session dédiée** (cookie séparé) : se connecter au
  site secrétaire n'ouvre pas les finances, et réciproquement.

## 3. Application Windows (desktop)

| Élément | Valeur |
|---|---|
| Installateur | `desktop/dist/Clinique-Sahed-Setup-1.0.0.exe` (269 Mo) |
| Version | 1.0.0 |
| SHA-256 | `F96B18B4A48FD8D26A45F5F48CC58F012B99A7FE2E60C4F0C814FF82AC3C8943` |
| Téléchargement | fichier local livré avec ce rapport (**aucun lien public** — le site d'installation ayant été supprimé sur votre instruction, l'installateur se transmet par clé USB / canal privé) |

**Installation (poste du cabinet) :**
1. Copier le `.exe` sur le poste, double-cliquer.
2. Windows SmartScreen affichera un avertissement (application non signée) :
   « Informations complémentaires » → « Exécuter quand même ». C'est le
   même installateur préparé par le cabinet, sans modification.
3. Laisser le dossier d'installation proposé par défaut.
4. Lancer « Clinique Sahed » depuis le menu Démarrer ou le Bureau.
5. Au premier démarrage sur une base fraîche : identifiants du médecin lus dans
   `%APPDATA%\Clinique Sahed\clinique\docteur-initial.txt` (ligne 1 = email,
   ligne 2 = mot de passe initial) ; le fichier est supprimé automatiquement et
   un changement de mot de passe est **imposé** à la première connexion.

**Garanties vérifiées :**
- La base locale (`%APPDATA%\Clinique Sahed\clinique\pg`) n'est **jamais**
  touchée par une réinstallation (`deleteAppDataOnUninstall: false`).
- Fonctionne **sans internet** : tout le trafic est local (127.0.0.1) — vérifié
  par inspection complète du code et tests d'exécution (audit §4/§5).

## 4. Données de test / démonstration — classification (à valider par vous)

Base **production web (Neon)** — état relevé en lecture seule :

| Table | Volume | Contenu relevé |
|---|---|---|
| users | 2 comptes actifs | 1 médecin + 1 secrétaire (`demo@cabinet.local`) |
| patients | **17** | noms à consonance réelle, sans marqueur « test/demo » visible dans les champs |
| rendez-vous / traitements / paiements | présents, rattachés aux 17 patients | cohérents entre eux |

Base **desktop** : aucune installation locale détectée sur ce poste de
développement (`%APPDATA%\Clinique Sahed` absent) — la base du médecin sera
créée à la première installation chez lui.

**Position : je ne supprime RIEN sans votre confirmation explicite.**
Les 17 patients ne portent aucun marqueur évident de test ; je ne peux pas
distinguer avec certitude données réelles / données de démonstration. Conformément
à votre règle (« If you cannot confidently distinguish test data from real
records, stop and ask me for approval »), voici les options :

- **Option A (recommandée si la base n'a jamais servi en réel)** : vous me
  confirmez par écrit « la base Neon contient uniquement des données de
  démonstration » → je supprime alors patients/rendez-vous/traitements/paiements
  (backup déjà fait et vérifié, cf. §4 bis).
- **Option B** : vous m'indiquez la liste exacte des enregistrements à supprimer.
- **Option C** : ne rien supprimer — le Dr. Sahed masque/supprime lui-même ce
  qu'il reconnaît comme faux depuis l'interface (corbeille restaurable 24 h).

**4 bis. Sauvegarde déjà effectuée et vérifiée :**
`backups/sahed_clinic-2026-11-01T15-33-08.dump` (422 Ko, 17 patients relus lors
du test de restauration sur le cluster de démonstration isolé). Toute opération
de nettoyage approuvée sera précédée d'une sauvegarde fraîche.

## 5. Identifiants et sécurité (transmission)

- **Aucun mot de passe dans ce rapport, dans Git, ou dans les logs.**
- Transmettre les mots de passe par : appel téléphonique, ou gestionnaire de
  mot de passe, ou message chiffré — jamais par email brut ni canal public.
- Comptes existants conservés tels quels (aucune réinitialisation silencieuse).
- Le changement de mot de passe à la première connexion est imposé par
  l'application quand le compte est encore sur son mot de passe initial.

## 6. Vérifications finales

| # | Contrôle | Résultat |
|---|---|---|
| 1 | Lien + connexion secrétaire | ✔ URL 200 ; connexion réelle testée par navigateur lors de l'audit |
| 2 | Lien médecin (privé) | ✔ URL protégée ; redirection vers connexion |
| 3 | Séparation des rôles | ✔ cookie secrétaire → API finances : 401/403 (testé 2×) |
| 4 | Installateur + version | ✔ 1.0.0, SHA-256 ci-dessus |
| 5 | Installation + démarrage | ✔ testés sur Windows 11 réel (audit) |
| 6 | Démarrage hors ligne + login local | ✔ (audit : tout le trafic est 127.0.0.1) |
| 7 | Préservation des données réelles | ✔ aucune écriture en production ; backup vérifié |
| 8 | Suppression données démo | ⏸ **en attente de votre classification (§4)** |
| 9 | Fonctionnement patients/RDV/traitements/paiements | ✔ testés de bout en bout en démo (audit §5) |
| 10 | Erreurs inattendues | ✔ aucune lors des QA navigateur |

## 7. Actions restantes nécessitant votre intervention

1. **Classifier les données** (§4, options A/B/C) avant tout nettoyage.
2. **Transmettre les identifiants** par canal privé (emails déjà corrects ; les
   mots de passe relèvent de votre gestion — aucune réinitialisation faite).
3. Si vous voulez un **email médecin professionnel** (ex. `sahed@gmail.dz`
   mentionné dans une demande antérieure) : demandez-le explicitement, je
   créerai/modifierai le compte avec changement forcé au premier login.
4. Remettre l'installateur `.exe` au cabinet (clé USB ou canal privé).
