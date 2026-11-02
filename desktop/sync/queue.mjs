// =============================================================================
//  FILE D'ATTENTE LOCALE PERSISTANTE — desktop/sync/queue.mjs
// =============================================================================
//  Chaque operation metier realisee hors ligne est journalisee ICI, dans la
//  base embarquee (table sync_queue) — jamais en memoire. Elle survit donc a
//  un crash, a un redemarrage et a une coupure secteur.
//
//  Statuts explicites : PENDING | SYNCING | SYNCHRONIZED | CONFLICT | REJECTED
//  Une operation en echec NE BLOQUE JAMAIS les suivantes.
//  Ce module est charge par le processus MAIN Electron (CommonJS autonome :
//  aucun bundler requis dans le runtime embarque).
// =============================================================================

const path = require('node:path')
const dossierStandalone = process.env.DESKTOP_SEED_STANDALONE ?? path.resolve(process.env.APP_ROOT ?? '.', 'standalone')
const { PrismaClient } = require(path.join(dossierStandalone, 'node_modules', '@prisma', 'client'))

const prisma = new PrismaClient()

/**
 * Enregistre une operation hors ligne. L'`operationId` (UUID v4) est genere
 * UNE SEULE FOIS ici et jamais reutilise : c'est la cle d'idempotence
 * serveur. L'ID metier est deja un UUID genere cote client.
 */
async function enqueue({ deviceId, entityType, entityId, operation, payload }) {
  const { randomUUID } = require('node:crypto')
  const operationId = randomUUID()
  await prisma.syncQueueEntry.create({
    data: {
      operationId,
      deviceId,
      entityType,
      entityId,
      operation,
      payload: JSON.stringify(payload),
      status: 'PENDING',
    },
  })
  return operationId
}

/** Prochain lot a pousser : les PENDING les plus anciens, hors conflits. */
async function prochainLot(limite = 100) {
  return prisma.syncQueueEntry.findMany({
    where: { status: { in: ['PENDING', 'SYNCING'] } },
    orderBy: { createdAt: 'asc' },
    take: limite,
  })
}

/** Marque une operation comme en cours d'envoi (apres un crash, elle sera rejouee). */
async function marquerSyncing(operationId) {
  await prisma.syncQueueEntry.update({
    where: { operationId },
    data: { status: 'SYNCING', attempts: { increment: 1 } },
  })
}

/** Confirme la synchronisation serveur. */
async function marquerSynchronized(operationId) {
  await prisma.syncQueueEntry.update({
    where: { operationId },
    data: { status: 'SYNCHRONIZED', synchronizedAt: new Date(), lastError: null },
  })
}

/**
 * Enregistre un conflit (chevauchement RDV, modification concurrente...).
 * L'operation n'est PAS supprimee : elle reste visible dans l'UI jusqu'a
 * arbitrage humain.
 */
async function marquerConflict(operationId, detail) {
  await prisma.syncQueueEntry.update({
    where: { operationId },
    data: { status: 'CONFLICT', conflictDetail: detail },
  })
}

/** Rejet definitif (payload invalide, type non supporte...) — journalise. */
async function marquerRejected(operationId, detail) {
  await prisma.syncQueueEntry.update({
    where: { operationId },
    data: { status: 'REJECTED', lastError: detail },
  })
}

/** Erreur transitoire (reseau) : retour en PENDING, retry avec backoff. */
async function marquerPending(operationId, detail) {
  const entree = await prisma.syncQueueEntry.findUnique({ where: { operationId } })
  if (!entree) return
  const attenteMs = Math.min(60_000, 2 ** Math.min(entree.attempts, 6) * 500)
  await prisma.syncQueueEntry.update({
    where: { operationId },
    data: {
      status: 'PENDING',
      lastError: detail,
      // updatedAt est recalcule : le backoff est applique au moment du retry
      // par le watcher, jamais par un blocage de la file.
      updatedAt: new Date(Date.now() + attenteMs),
    },
  })
}

/** Compteurs affiches dans l'interface. */
async function compteurs() {
  const groupes = await prisma.syncQueueEntry.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const map = Object.fromEntries(groupes.map((g) => [g.status, g._count._all]))
  return {
    enAttente: (map.PENDING ?? 0) + (map.SYNCING ?? 0),
    synchronisees: map.SYNCHRONIZED ?? 0,
    conflits: map.CONFLICT ?? 0,
    rejetees: map.REJECTED ?? 0,
  }
}

/** Operations en attente d'arbitrage, avec detail lisible. */
async function conflits() {
  return prisma.syncQueueEntry.findMany({
    where: { status: 'CONFLICT' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

module.exports = {
  enqueue,
  prochainLot,
  marquerSyncing,
  marquerSynchronized,
  marquerConflict,
  marquerRejected,
  marquerPending,
  compteurs,
  conflits,
}
