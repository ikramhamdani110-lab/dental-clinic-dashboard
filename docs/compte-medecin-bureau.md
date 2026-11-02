# Compte médecin de l'application de bureau — mots de passe et récupération

## Comment le compte est créé (première installation)

- Au **premier lancement** seulement (base fraîche, aucune donnée), l'application
  lit le fichier `docteur-initial.txt` dans son dossier de données
  (`%APPDATA%\Clinique Sahed\clinique\`) :
  - **ligne 1** : email du médecin (par exemple `medecin@cabinet.example`)
  - **ligne 2** : mot de passe initial
- Si ce fichier n'existe pas, l'application **génère un mot de passe aléatoire**
  et l'écrit dans ce même fichier : il suffit de l'ouvrir pour lire les
  identifiants.
- Le mot de passe est ensuite **haché avec Argon2id + pepper** et seul le hash
  est stocké dans la base. Aucun mot de passe en clair n'est dans le code source,
  dans l'installeur ni dans Git.
- Après un démarrage réussi, le fichier `docteur-initial.txt` est **supprimé**.
- Le login détecte la première connexion (`passwordChangedAt = 1970`) et impose
  le changement de mot de passe immédiat.

### Installer avec un mot de passe voulu

Avant le **premier** lancement après installation, créer le fichier
`docteur-initial.txt` avec l'email et le mot de passe initial choisis par le
cabinet (voir les deux lignes ci-dessus).

```
%APPDATA%\Clinique Sahed\clinique\docteur-initial.txt
```

avec ce contenu (2 lignes) :

```
<email du medecin>
<mot de passe initial>
```

Puis lancer l'application : le compte est créé avec ce mot de passe, le fichier
est ensuite effacé automatiquement.

## Désinstallation / réinstallation

- Le dossier de données (`%APPDATA%\Clinique Sahed\clinique`, y compris la base
  PostgreSQL embarquée) **n'est PAS supprimé** à la désinstallation
  (`deleteAppDataOnUninstall: false` dans la config electron-builder). Toutes
  les données cliniques survivent à une réinstallation.
- Conséquence : après une réinstallation, le compte **existe déjà** avec l'ancien
  mot de passe. L'application ne le remplace **jamais** automatiquement — c'est
  pourquoi les identifiants « de première installation » ne fonctionnent pas sur
  une base existante.
- Le mot de passe initial n'est utilisé que si la base est **vide** (aucun
  compte médecin).

## Récupérer l'accès si le mot de passe est oublié

1. **Fermer** l'application Clinique Sahed.
2. Dans le dossier du projet (ou à partir du script fourni avec le code source),
   lancer :
   ```
   node desktop\reinitialiser-compte.cjs
   ```
   Répondre avec l'email du médecin et le nouveau mot de passe.
   Le script écrit `docteur-initial.txt` dans le dossier de données.
3. **Relancer** l'application. Au démarrage, le mot de passe du compte est
   remplacé (haché Argon2id), les compteurs d'échecs de connexion et l'éventuel
   verrouillage sont remis à zéro, et le fichier est supprimé.
4. Se connecter avec le nouveau mot de passe ; le changement forcé à la
   première connexion s'applique comme d'habitude.

Cette procédure est **locale et volontaire** : sans le fichier
`docteur-initial.txt` présent, l'application ne modifie jamais un compte
existant au démarrage.

## Ne pas faire

- Ne pas réinstaller pour « réinitialiser » le mot de passe : ça n'efface pas la
  base et ne recrée pas le compte — ça ne change rien au mot de passe.
- Ne pas supprimer le dossier `%APPDATA%\Clinique Sahed` : cela effacerait les
  données de la clinique.
