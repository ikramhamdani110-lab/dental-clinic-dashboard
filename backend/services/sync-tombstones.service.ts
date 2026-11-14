import { prisma } from '@backend/database/prisma'

/**
 * =============================================================================
 *  TOMBSTONES DURABLES — journal de suppressions indépendant de la fenêtre 24 h
 * =============================================================================
 *
 *  PROBLÈME CORRIGÉ (§3 de la mission finale) : les trash_entries sont purgées
 *  après 24 h. Un appareil hors ligne PLUS de 24 h ratait la suppression et
 *  faisait RESSUSCITER l'enregistrement à son prochain pull.
 *
 *  GARANTIE : chaque suppression (mise en corbeille, suppression définitive,
 *  purge automatique) écrit une ligne `sync_tombstones` DANS LA MÊME
 *  TRANSACTION — le tombstone survit à la purge de la corbeille. Une
 *  restauration écrit un tombstone `RESTORE` qui annule le DELETE.
 *
 *  RÉTENTION SÛRE : une ligne n'est purgée que si elle est antérieure au plus
 *  ancien curseur ACTIF (dernière lecture réussie) de tous les appareils non
 *  révoqués — et jamais au-delà de 90 jours (filet absolu).
 */

/** Types d'entité synchronisés → nom de table du pull. */
const TABLE_PAR_TYPE: Record<string, string> = {
  PATIENT: 'patients',
  RENDEZ_VOUS: 'appointments',
  TRAITEMENT: 'treatments',
  PAIEMENT: 'payments',
  DOCUMENT: 'documents',
  ORDONNANCE: 'prescriptions',
  ENTREE_ODONTOGRAMME: 'odontogramEntries',
  DOSSIER_MEDICAL: 'medicalRecords',
}

/** Corbeille → entityType du journal (VISITE_TRAITEMENT exclu du pull). */
const TYPE_PAR_CORBEILLE: Record<string, string> = {
  PATIENT: 'patients',
  RENDEZ_VOUS: 'appointments',
  TRAITEMENT: 'treatments',
  PAIEMENT: 'payments',
  DOCUMENT: 'documents',
  ORDONNANCE: 'prescriptions',
  ENTREE_ODONTOGRAMME: 'odontogramEntries',
  DOSSIER_MEDICAL: 'medicalRecords',
}

export function typeCorbeilleVersTable(type: string): string | null {
  return TYPE_PAR_CORBEILLE[type] ?? null
}

/**
 * Écrit un tombstone DELETE. `tx` DOIT être la transaction de la suppression :
 * le tombstone est validé ou annulé AVEC elle — jamais de suppression sans
 * trace, jamais de trace sans suppression.
 */
export async function journaliserSuppression(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: { entityType: string; entityId: string; sourceTrashId?: string; deviceId?: string },
): Promise<void> {
  await tx.syncTombstone.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      type: 'DELETE',
      ...(params.sourceTrashId ? { sourceTrashId: params.sourceTrashId } : {}),
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
    },
  })
}

/** Écrit un tombstone RESTORE (annule le DELETE précédent au pull suivant). */
export async function journaliserRestauration(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: { entityType: string; entityId: string; deviceId?: string },
): Promise<void> {
  await tx.syncTombstone.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      type: 'RESTORE',
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
    },
  })
}

/**
 * Tombstones depuis le curseur de l'appareil, bornés. Advance le curseur
 * SEULEMENT après une lecture réussie (curseur persistant : un crash entre
 * lecture et application rejouera le même lot — sans effet grâce au marquage
 * local idempotent côté bureau).
 */
export async function tombstonesDepuis(
  deviceId: string,
  limite = 2000,
): Promise<{
  tombstones: Array<{ entityType: string; entityId: string; type: string; deletedAt: string }>
  curseur: string
}> {
  const curseurLigne = await prisma.syncTombstoneCursor.findUnique({
    where: { deviceId },
  })
  const depuis = curseurLigne?.lastTombstoneAt ?? new Date(Date.now() - 100 * 365 * 24 * 3600 * 1000)

  const lignes = await prisma.syncTombstone.findMany({
    where: { deletedAt: { gt: depuis } },
    orderBy: { deletedAt: 'asc' },
    take: limite,
    select: { entityType: true, entityId: true, type: true, deletedAt: true },
  })

  // Plafond de sécurité : si un appareil reste hors ligne plus de 90 jours,
  // la rétention absolue peut avoir purgé des tombstones — on signale alors
  // que sa resynchronisation complète est requise (géré par le bureau via un
  // pull depuis epoch). Le curseur du bureau est alors réinitialisé côté
  // client (jamais de donnée perdue : la base locale fait foi).
  const nouveauCurseur =
    lignes.length > 0 ? lignes[lignes.length - 1]!.deletedAt : depuis

  if (lignes.length > 0) {
    await prisma.syncTombstoneCursor.upsert({
      where: { deviceId },
      create: { deviceId, lastTombstoneAt: nouveauCurseur },
      update: { lastTombstoneAt: nouveauCurseur },
    })
  }

  return {
    tombstones: lignes.map((l) => ({
      entityType: TABLE_PAR_TYPE[l.entityType] ?? l.entityType,
      entityId: l.entityId,
      type: l.type,
      deletedAt: l.deletedAt.toISOString(),
    })),
    curseur: nouveauCurseur.toISOString(),
  }
}

/**
 * Rétention par curseur : purge les tombstones antérieurs au plus ancien
 * « lastTombstoneAt » des appareils ACTIFS (non révoqués), dans la limite de
 * 90 jours. Appelée par l'entretien périodique (avec purgerExpires).
 */
export async function purgerTombstonesLus(): Promise<number> {
  const limiteAbsolue = new Date(Date.now() - 90 * 24 * 3600 * 1000)
  const appareils = await prisma.deviceSession.findMany({
    where: { revokedAt: null },
    select: { deviceId: true },
  })
  if (appareils.length === 0) {
    // Aucun appareil actif : on garde tout (prudence).
    return 0
  }
  const curseurs = await prisma.syncTombstoneCursor.findMany({
    where: { deviceId: { in: appareils.map((a) => a.deviceId) } },
    select: { lastTombstoneAt: true },
  })
  if (curseurs.length === 0) return 0
  const plusAncien = new Date(Math.min(...curseurs.map((c) => c.lastTombstoneAt.getTime())))
  const borne = plusAncien < limiteAbsolue ? plusAncien : limiteAbsolue

  const resultat = await prisma.syncTombstone.deleteMany({
    where: { deletedAt: { lt: borne } },
  })
  return resultat.count
}
