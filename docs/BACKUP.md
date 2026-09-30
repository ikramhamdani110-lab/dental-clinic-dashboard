# Strategie de sauvegarde — SAHED DENTAL CLINIC

Ce document decrit comment sauvegarder, chiffrer, conserver et **restaurer** la
base de donnees.

> **Etat reel : aucune sauvegarde automatique n'est configuree par defaut.**
> Le script existe (`npm run backup:postgres`), mais sa planification, son
> chiffrement et sa copie hors site sont des etapes de deploiement. Ne
> considerez pas que des sauvegardes existent tant que ces etapes ne sont pas
> faites et **testees**.

---

## 1. Ce qui doit etre sauvegarde

| Element | Contenu | Contient des donnees medicales ? |
|---|---|---|
| Base PostgreSQL | Patients, traitements, paiements, dossiers | **Oui** |
| Repertoire des documents | Radiographies, photos, scans | **Oui** |
| Fichier `.env` | Secrets (a proteger separement) | Non, mais sensible |

Sauvegarder la base **sans** le repertoire de documents (ou l'inverse) donne une
sauvegarde incomplete : les deux doivent etre sauvegardes ensemble.

---

## 2. Sauvegarde de la base de donnees

### Script fourni

```bash
npm run backup:postgres
```

Le script :

1. produit un dump **format custom** (`pg_dump --format=custom`), compresse et
   restaurable de facon selective ;
2. **verifie la taille** du fichier produit : un dump suspicieusement petit
   (moins de 1 Ko) fait **echouer** la sauvegarde avec un code de retour non
   nul. Une sauvegarde silencieusement vide est pire qu'aucune sauvegarde ;
3. purge les sauvegardes plus anciennes que la retention.

### Variables

| Variable | Defaut | Role |
|---|---|---|
| `DATABASE_URL` | — | Chaine de connexion (obligatoire) |
| `BACKUP_DIR` | `./backups` | Repertoire de destination |
| `BACKUP_RETENTION_JOURS` | `30` | Duree de conservation locale |
| `PGPASSWORD` / `PGPASSFILE` | — | Authentification (jamais en ligne de commande) |

### Planification

**Linux (cron)** — tous les jours a 2 h du matin :

```cron
0 2 * * * cd /srv/sahed && BACKUP_DIR=/srv/backups node database/scripts/backup-postgres.mjs >> /var/log/sahed-backup.log 2>&1
```

**Windows (Planificateur de taches)** :

- Programme : `node`
- Arguments : `database/scripts/backup-postgres.mjs`
- Recurrence : quotidienne, 02:00
- « Demarrer dans » : le repertoire du projet

**Alternative recommandee en production** : utiliser la fonctionnalite de
sauvegarde automatique du fournisseur de base de donnees (Point-in-Time
Recovery). Voir `docs/DEPLOYMENT.md`.

---

## 3. Chiffrement (obligatoire avant tout transfert)

Le script produit un fichier **brut**. Il doit etre chiffre **avant** de quitter
le serveur. Nous ne fabriquons pas de chiffrement « maison » : nous utilisons un
outil eprouve.

```bash
# Avec age (recommande)
age --recipient <cle_publique> --output sahed-2025-03-10.dump.age sahed-2025-03-10.dump
shred -u sahed-2025-03-10.dump

# Ou avec gpg
gpg --encrypt --recipient sahed-backup@example.dz sahed-2025-03-10.dump
```

> **Regle de securite** : ne stockez **jamais** la cle privee de dechiffrement
> sur le meme serveur que les sauvegardes, ni dans le meme coffre que la base.

---

## 4. Sauvegarde des documents

Le repertoire prive (`DOCUMENTS_STORAGE_PATH`) doit etre sauvegarde
separement. Contrainte : il doit rester **hors racine web**.

```bash
tar czf documents-$(date +%F).tar.gz -C /srv/sahed/storage documents
# puis chiffrer le fichier obtenu, comme pour le dump
```

---

## 5. Retention

Politique de reference (a adapter a la reglementation locale) :

| Niveau | Frequence | Conservation |
|---|---|---|
| Quotidien | chaque jour | 30 jours |
| Hebdomadaire | chaque semaine | 6 mois |
| Mensuel | chaque mois | **duree legale applicable** aux dossiers medicaux |

La duree de conservation des dossiers medicaux est fixee par la reglementation
de la juridiction d'exploitation : **ne la raccourcissez pas sans avis
juridique**.

---

## 6. Sauvegarde hors site

Une sauvegarde rangee sur le meme disque que la base ne protege ni d'une panne
materielle, ni d'un rançongiciel, ni d'un incendie.

Etapes :

1. chiffrer la sauvegarde (§3) ;
2. la copier vers un stockage **physiquement distinct** (autre fournisseur,
   autre region) ;
3. verifier que la copie est complete (taille, empreinte).

Exemple avec `rclone` :

```bash
rclone copy /srv/backups remote:sahed-backups --include "*.age"
```

---

## 7. Procedure de RESTAURATION

Cette procedure doit etre **lue et testee avant** qu'un incident ne survienne.

### 7.1 Restauration de la base

```bash
# 1. Dechiffrer la sauvegarde
age --decrypt --output sahed.dump sahed-2025-03-10.dump.age

# 2. Creer une base vide
createdb sahed_restauration

# 3. Restaurer le dump
pg_restore --dbname=sahed_restauration --no-owner --no-privileges sahed.dump

# 4. Repasser DATABASE_URL sur la base restauree et redemarrer l'application
```

### 7.2 Restauration des documents

```bash
tar xzf documents-2025-03-10.tar.gz -C /srv/sahed/storage
```

### 7.3 Verification apres restauration

1. `GET /api/health` doit renvoyer `statut: "operationnel"`.
2. Le medecin se connecte et retrouve ses patients.
3. Un patient de reference presente le **bon solde** (comparer avec un releve).
4. Les documents d'un patient s'ouvrent.

---

## 8. Test de restauration periodique (obligatoire)

Une sauvegarde jamais restauree ne prouve rien. **Une fois par mois** :

1. restaurer la derniere sauvegarde dans une base **de test** (jamais en
   production) ;
2. executer la verification de la section 7.3 ;
3. noter la date, la duree et le resultat du test.

Un modele de registre :

```
Date       | Source           | Duree | Resultat  | Verifie par
-----------|------------------|-------|-----------|------------
2025-03-01 | dump 2025-02-28  | 12min | OK        | Dr Sahed
```

---

## 9. Sauvegarde locale (developpement uniquement)

Aucune sauvegarde locale n'est fournie : l'environnement de developpement cible
la meme base PostgreSQL que la production (instance distincte). Utilisez
`npm run backup:postgres` avec la `DATABASE_URL` de la base concernee.