import { prisma } from '@backend/database/prisma'
import { logger } from '@backend/logging/logger'

/**
 * =============================================================================
 *  OUTBOX DE SYNCHRONISATION — écriture des opérations locales dans sync_queue
 * =============================================================================
 *
 *  Ce module est appelé par les SERVICES MÉTIER après chaque écriture locale
 *  (patients, rendez-vous, traitements, paiements, ordonnances, odontogramme).
 *  L'insertion dans la file se fait DANS LA MÊME TRANSACTION que l'écriture
 *  métier quand un `tx` est fourni : une écriture sans opération de sync
 *  correspondante est impossible, et réciproquement.
 *
 *  SUR LA PRODUCTION (sites web), le module est INACTIF : la variable
 *  d'environnement `SAHED_DESKTOP_LOCAL` n'y est jamais définie. Le site web
 *  n'écrit donc JAMAIS dans la file — seuls le poste de bureau (Electron +
 *  PostgreSQL embarqué) la remplit, puis le watcher l'envoie au serveur en
 *  ligne. La production reste l'AUTORITÉ, atteinte par le pull.
 *
 *  IDEMPOTENCE : chaque opération porte un `operationId` UUID v4 généré UNE
 *  SEULE FOIS ici. Le serveur rejouant la même opération renverra
 *  ALREADY_APPLIED — un retry réseau ne duplique donc jamais une écriture.
 */

/** Vrai si ce processus écrit dans une base LOCALE de bureau (jamais en prod). */
export function estBureauLocal(): boolean {
  return process.env.SAHED_DESKTOP_LOCAL === '1'
}

type OperationSync = 'CREATE' | 'UPDATE' | 'TRASH' | 'RESTORE'

/**
 * Journalise une opération hors ligne dans la file persistante.
 * `tx` : transaction Prisma partageant la transaction métier — RECOMMANDÉ.
 * Sans `tx`, l'insertion est autonome (après le commit métier) : accepté pour
 * les rares cas où la transaction n'est pas accessible, avec trace.
 */
export async function journaliserOperationLocale(params: {
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
  entityType: string
  entityId: string
  operation: OperationSync
  payload: Record<string, unknown>
  deviceId?: string
}): Promise<void> {
  if (!estBureauLocal()) return
  const { randomUUID } = await import('node:crypto')
  const operationId = randomUUID()
  // Sérialisation DÉFENSIVE : un payload non sérialisable ne doit jamais
  // bloquer l'écriture métier (ni planter l'outbox). En cas d'échec, on
  // journalise une version réduite ([object]) — l'entité reste synchro
  // via le pull (updatedAt) même sans payload complet.
  let payloadJson: string
  try {
    payloadJson = JSON.stringify(params.payload)
  } catch {
    payloadJson = '{"_serialisationEchouee":true}'
  }
  const donnees = {
    operationId,
    // deviceId est résolu par le watcher au moment du push (mono-poste) ;
    // un espace réservé stable évite un UNIQUE manquant côté file.
    deviceId: params.deviceId ?? '00000000-0000-4000-8000-000000000000',
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation,
    payload: payloadJson,
    status: 'PENDING',
  }
  try {
    if (params.tx) {
      await params.tx.syncQueueEntry.create({ data: donnees })
    } else {
      await prisma.syncQueueEntry.create({ data: donnees })
    }
  } catch (error) {
    // JAMAIS bloquant pour l'écriture métier : la file est re-synchronisée
    // par le prochain pull (curseurs) même si l'insertion échoue ici.
    logger.error("Échec d'écriture dans la file de synchronisation", {
      entityType: params.entityType,
      entityId: params.entityId,
      operation: params.operation,
      error,
    })
  }
}

/** Charge utile réduite d'une entité : champs métier + updatedAt, jamais de secret. */
export function chargeUtile<T extends Record<string, unknown>>(entite: T): Record<string, unknown> {
  const exclu = new Set(['creneau'])
  const sortie: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(entite)) {
    if (exclu.has(cle)) continue
    sortie[cle] = valeur instanceof Date ? valeur.toISOString() : valeur
  }
  return sortie
}
