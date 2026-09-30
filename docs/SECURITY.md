# Modele de securite — SAHED DENTAL CLINIC

Cette application traite des donnees de sante et des donnees financieres. Ce
document decrit les protections reellement mises en oeuvre.

---

## 1. Authentification

### Hachage des mots de passe

- Algorithme : **Argon2id** (variante resistante aux attaques GPU et aux
  canaux auxiliaires).
- Parametres : `m=19456` (environ 19 Mo), `t=2`, `p=1` — recommandations OWASP.
- Sel aleatoire par mot de passe (fourni par la bibliotheque).
- **Poivre applicatif** (`PASSWORD_PEPPER`, issu de l'environnement) : un
  attaquant disposant uniquement de la base ne peut pas verifier les mots de
  passe hors ligne.
- Rehachage automatique a la connexion si les parametres evoluent.
- Le mot de passe **en clair n'est jamais stocke, jamais journalise, jamais
  renvoye par l'API**.

### Sessions serveur

- Le cookie ne contient qu'un **jeton opaque** de 32 octets.
- La base ne stocke que l'empreinte **SHA-256** du jeton (un vol de base ne
  permet pas de reconstituer un cookie valide).
- La session porte : utilisateur, adresse IP, user-agent, dates de creation,
  de derniere activite et d'expiration.
- **Revocation cote serveur** : la deconnexion et la revocation sont immediates
  (contrairement a un JWT auto-porteur).
- Expiration absolue : 30 jours. Expiration apres inactivite : 12 heures.
- Un changement de mot de passe revoque **toutes** les sessions.

### Cookies

| Attribut | Session | CSRF |
|---|---|---|
| `HttpOnly` | **oui** (inaccessible au JavaScript) | non (lu par l'application cliente) |
| `Secure` | oui en production | oui en production |
| `SameSite` | `lax` | `lax` |
| `Path` | `/` | `/` |

### Protection anti-force brute

Deux defenses complementaires :

1. **Limitation par IP** : au maximum 10 tentatives sur une fenetre glissante
   de 10 minutes (table `login_attempts`).
2. **Verrouillage de compte** : apres 5 echecs consecutifs, le compte est
   verrouille 15 minutes.

Le message d'echec est **toujours identique** (email inconnu, mauvais mot de
passe, compte verrouille) : cela empeche d'enumerer les comptes. Une
verification de mot de passe factice est executee lorsque l'utilisateur n'existe
pas, afin que le temps de reponse reste comparable (anti-canal temporel).

### Reinitialisation de mot de passe

- Jeton a usage unique, duree de vie **30 minutes**.
- Stocke uniquement sous forme d'empreinte SHA-256.
- Transmis par un **canal verifie** (script serveur), **jamais renvoye par une
  API publique**.
- Chaque nouveau jeton invalide les precedents.

### Politique de mot de passe

- 12 caracteres minimum, 200 maximum.
- Au moins une minuscule, une majuscule et un chiffre.
- Refus des mots de passe les plus courants.

---

## 2. Autorisation

- Une seule role active en V1 : **MEDECIN**.
- `UTILISATEURS_ACTIFS` determine les roles autorises. Ajouter un role revient
  a l'y ajouter, sans reconstruire la couche d'autorisation.
- **Chaque route privee** passe par `routePrivee` : l'authentification et
  l'autorisation sont verifiees **cote serveur**. Masquer une page ne protege
  rien ; un appel direct a l'API sans session valide est refuse.

---

## 3. Protection CSRF

Protection « double soumission » :

1. Un **jeton CSRF** est associe a chaque session (stocke sous forme
   d'empreinte cote serveur).
2. Le client le relit dans un cookie non `HttpOnly` et le replace dans
   l'en-tete `x-csrf-token`.
3. Le serveur compare en **temps constant** (`timingSafeEqual`).

En complement, le middleware rejette toute requete mutante dont l'origine
differe de l'application (premiere barriere).

---

## 4. Injection SQL

- **Toutes** les requetes passent par Prisma : elles sont **parametrees**.
- **Aucune** concatenation de chaine SQL n'est utilisee dans l'application.
- Les seules requetes SQL brutes sont des `SELECT 1` de controle de sante.

---

## 5. XSS (Cross-Site Scripting)

- React echappe les valeurs par defaut.
- Aucune utilisation de `dangerouslySetInnerHTML` pour des donnees
  utilisateur : le seul emploi concerne le script de theme, une constante du
  code, sans interpolation.
- **Content Security Policy** construite par requete avec un **nonce** :
  seuls les scripts portant le nonce sont executes.

---

## 6. En-tetes de securite

| En-tete | Valeur |
|---|---|
| `Content-Security-Policy` | Politique stricte avec nonce |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (production) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Camera, micro, geolocalisation, USB, paiement desactives |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` (API) | `no-store, max-age=0` |

---

## 7. Televersement de documents

| Risque | Protection |
|---|---|
| Fichier executable deguise | Type **reel** verifie par signature binaire (`file-type`), pas par l'extension |
| Type non autorise | Liste blanche : images (JPEG, PNG, WebP, GIF, TIFF, BMP) et PDF |
| Fichier enorme | Taille limitee, verifiee **avant** et **apres** lecture |
| Path traversal | Nom sur disque genere (UUID), chemin verifie contre la racine |
| URL publique previsible | Aucune : le contenu passe par une route API authentifiee |
| XSS via document | Servi en `attachment` avec `nosniff` |
| Nom de fichier malveillant | Nom d'origine assaini pour l'affichage uniquement |
| Stockage expose | Repertoire prive **hors racine web** |

---

## 8. Gestion des erreurs

- L'utilisateur recoit un message **francais** clair.
- Les details techniques (SQL, pile d'appel, chemin interne, secret) restent
  dans les **journaux serveur** et ne sont jamais transmis.
- Une base indisponible produit un message professionnel, jamais une erreur
  brute.

---

## 9. Journalisation

- Sortie **JSON structuree** (une ligne par evenement).
- **Anonymisation systematique** : les champs sensibles (`password`,
  `passwordHash`, `token`, `csrfToken`, `secret`, `cookie`, `apiKey`,
  `databaseUrl`, `pepper`...) sont remplaces avant emission, meme imbriques
  profondement. Cette garantie est **testee automatiquement**
  (`tests/business/securite.test.ts`).
- Le journal d'activite ne contient jamais de mot de passe, d'empreinte, de
  secret ni de detail medical inutile.

---

## 10. Secrets

- **Aucun secret dans le code source.**
- Tous les secrets proviennent de l'environnement et sont valides au demarrage.
- En production, `SESSION_SECRET` est obligatoire et `COOKIE_SECURE` doit valoir
  `true` : le demarrage echoue sinon.
- `.env` est ignore par Git ; seul `.env.example` est versionne.
- **Jamais expose au frontend** : empreintes, secrets de session, cles d'API,
  identifiants de base.

---

## 11. Deletion et integrite

- Suppression **logique** : l'element disparait des vues, reste en base.
- Fenetre de restauration : **exactement 24 heures**.
- Cette fenetre est appliquee par le **serveur** (et par une contrainte CHECK
  en base) ; le minuteur du navigateur n'est qu'un affichage.
- La suppression ne detruit **jamais** de donnee liee non prevue : un paiement
  ne peut pas etre supprime definitivement, un patient ou un traitement portant
  un historique financier non plus.
- Une suppression definitive est **journalisee**.

---

## 12. Donnees de sante — rappel

L'architecture fournit le controle d'acces, la traçabilite, le stockage et la
transmission securises, la suppression maitrisee et les sauvegardes. Elle
**ne constitue pas** une attestation de conformite reglementaire : la
conformite depend de la juridiction d'exploitation (consentement, duree de
conservation, declaration, hebergement des donnees).