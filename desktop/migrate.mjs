// =============================================================================
//  MIGRATION DE LA BASE LOCALE (EMBARQUEE)
// =============================================================================
//  Executé par le processus principal Electron au premier lancement. Applique
//  les migrations Prisma sur la base PostgreSQL locale demarree par Electron.
//  Utilise la CLI Prisma de developpement (presente dans node_modules).
// =============================================================================

//  Réapplique le travail à migrate-local.mjs (client Prisma inclus dans le
//  bundle standalone, pas de CLI nécessaire dans l'application packagée).

await import('./migrate-local.mjs')
