# Réinitialiser le mot de passe — installation actuelle (sans réinstaller)

## Étapes

1. **Fermez l'application Clinique Sahed** complètement.
   Vérifiez dans le Gestionnaire des tâches (Ctrl+Maj+Échap) qu'aucun
   processus « Clinique Sahed.exe » ne reste actif.

2. Ouvrez **PowerShell** dans le dossier du projet :

   ```powershell
   cd <chemin-du-projet>
   ```

3. Lancez la réinitialisation :

   ```powershell
   node desktop\reinitialiser-compte.cjs <email-du-medecin> "<nouveau-mot-de-passe>"
   ```

   Le script :
   - vérifie que l'application est bien fermée (sinon il s'arrête) ;
   - démarre la base PostgreSQL embarquée de l'application installée ;
   - remplace le mot de passe du compte du medecin (hachage Argon2id) ;
   - remet à zéro les tentatives échouées et l'éventuel verrouillage ;
   - arrête la base proprement.

   Message attendu :
   `Mot de passe du compte <email> réinitialisé (haché Argon2id).`
   `Patients, rendez-vous, paiements et documents : INTACTS.`

4. **Relancez l'application** (menu Démarrer → Clinique Sahed).

5. Connectez-vous avec l'email du medecin et le nouveau mot de passe choisi
   a l'etape 3.

6. L'application demandera un **changement de mot de passe à la première
   connexion** : choisissez-en un nouveau et notez-le.

## En cas d'erreur

- « l'application Clinique Sahed est en cours d'exécution » → fermez-la et
  relancez le script.
- « base de données introuvable » → l'application n'a jamais été lancée sur ce
  poste ; lancez-la une fois normalement puis refaites la procédure.
- Toute autre erreur : **aucune modification n'est appliquée**, l'ancien mot de
  passe reste valide, et la base est arrêtée proprement. Vous pouvez réessayer.

## Notes

- Cette procédure modifie **uniquement** la ligne du compte médecin dans la
  base : patients, rendez-vous, paiements, dossiers médicaux et documents ne
  sont pas touchés.
- Le mot de passe n'apparaît jamais dans un journal ; seul le hash est stocké.
- Sur une **future installation fraîche** (base vide), l'application lira le
  fichier `%APPDATA%\Clinique Sahed\clinique\docteur-initial.txt` s'il existe
  (ligne 1 = email, ligne 2 = mot de passe) pour créer le compte ; sinon elle
  générera un mot de passe aléatoire et l'écrira dans ce fichier. Voir
  `docs/compte-medecin-bureau.md`.
