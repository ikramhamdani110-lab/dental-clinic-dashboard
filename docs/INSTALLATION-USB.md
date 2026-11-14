# INSTALLATION PAR CLÉ USB — Clinique Sahed (Windows 10 / 11, 64 bits)

> Aucune connexion Internet n'est requise pour installer ni pour utiliser
> l'application. Aucun Node.js, PostgreSQL ou outil de développement n'est
> nécessaire : tout est embarqué dans l'installateur.

## Ce qu'il faut

1. L'installateur : **`dist/installer/Sahed-Dental-Clinic-Setup-x64.exe`**
   (≈ 270 Mo). Il est autonoome — copiez-le simplement sur une clé USB.
2. Une clé USB (1 Go suffit), ou n'importe quel moyen de transfert de fichier.
3. Le PC du cabinet sous Windows 10 ou 11, 64 bits, avec ~1 Go d'espace libre.

## Étapes d'installation

1. **Sur votre ordinateur** : copiez `Sahed-Dental-Clinic-Setup-x64.exe` sur la clé USB.
2. **Au cabinet** : branchez la clé USB, ouvrez-la dans l'Explorateur.
3. **Double-cliquez** sur `Sahed-Dental-Clinic-Setup-x64.exe`.
   - Si Windows affiche « Windows a protégé votre PC » (SmartScreen) :
     cliquez **Informations complémentaires** puis **Exécuter quand même**.
     L'installateur n'est pas signé par un certificat commercial — c'est
     normal et documenté ; le fichier provient du cabinet.
4. Choisissez l'emplacement d'installation (par défaut convient) et laissez
   l'installateur créer les raccourcis (bureau + menu Démarrer).
5. À la fin, l'application démarre automatiquement : la base locale est
   créée, les migrations appliquées, puis l'écran de connexion apparaît.
   **Première connexion** : `clinic@gmail.dz` / `Clinic+123` — l'application
   EXIGE le changement de mot de passe immédiatement. Choisissez-en un fort
   et notez-le au cabinet.
6. **Retirez la clé USB** : l'application installée n'en dépend plus.

## Après installation — où sont les données ?

| Contenu | Emplacement |
|---|---|
| Base de données clinique | `%APPDATA%\Clinique Sahed\clinique\pg` |
| Documents patients | `%APPDATA%\Clinique Sahed\clinique\documents` |
| Journaux de démarrage | `%APPDATA%\Clinique Sahed\startup.log` |
| Journal de synchronisation | `%APPDATA%\Clinique Sahed\sync-events.log` |

Ces données **survivent** à la désinstallation, aux mises à jour et aux
redémarrages de Windows.

## Cycle de vie de l'application

- **Fermer la fenêtre** ≠ arrêter l'application : le serveur local et la base
  continuent en arrière-plan (icône dans la zone de notification, près de
  l'horloge). Cliquez sur cette icône pour rouvrir la fenêtre.
- **Quitter réellement** : icône tray → « Quitter (arrête le serveur local) ».
- **Après un redémarrage de Windows** : relancez l'application par le
  raccourci du bureau. Les données sont intactes.
- En cas de problème : lancez `npm run desktop:livrer` est un outil
  développeur — à la place, copiez le dossier `%APPDATA%\Clinique Sahed\`
  (fichiers `startup.log` et `sync-events.log`) pour le diagnostic.

## Mise à jour (par USB, sans Internet)

1. Téléchargez le nouvel installateur chez vous, copiez-le sur la clé USB.
2. Au cabinet, exécutez-le : il détecte l'installation existante, met à jour
   l'application **sans toucher aux données cliniques** (elles vivent hors du
   dossier d'installation).
3. Aucune reconfiguration n'est nécessaire.

## Désinstallation

Paramètres Windows → Applications → « Clinique Sahed » → Désinstaller.
**Les données cliniques ne sont PAS supprimées** (elles restent dans
`%APPDATA%\Clinique Sahed`). Une réinstallation les retrouve.
