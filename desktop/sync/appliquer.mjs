// =============================================================================
//  APPLICATION LOCALE DES CHANGEMENTS DISTANTS — desktop/sync/appliquer.mjs
// =============================================================================
//  Réécrit l'ancien « appliquerLotsLocalement » (audit G5 : upsert aveugle).
//
//  POLITIQUES PAR ENTITÉ — AUCUN last-write-wins pour les données médicales ou
//  financières (règle §1.5 de PLAN-SYNC-OFFLINE-B.md) :
//
//    payments        : une écriture locale PENDING sur le même paiement →
//                      conflit LOCAL conservé en double version (sync_conflicts
//                      + syncStatut A_ARBITRER) — jamais d'écrasement.
//    treatments      : idem (A_ARBITRER).
//    appointments    : écrasement seulement si aucune écriture locale PENDING ;
//                      sinon conflit. La contrainte EXCLUDE locale rejoue la
//                      règle anti-chevauchement au niveau base.
//    patients        : fusion champ par champ — les champs non modifiés
//                      localement prennent la valeur distante ; un champ
//                      modifié des deux côtés est signalé (conflit de champ).
//    prescriptions   : écrasement seulement si pas d'écriture PENDING, sinon
//                      conflit (donnée médicale).
//    odontogramEntries: historique d'ajouts — jamais modifié, un CREATE connu
//                      est déjà appliqué (idempotence).
//    medicalRecords  : écrasement si pas d'écriture PENDING, sinon conflit.
//
//  TOMBSTONES (G6) : une suppression distante est appliquée SEULEMENT si le
//  poste n'a aucune opération PENDING sur cette entité (sinon conflit) et si
//  l'entité existe encore localement. La suppression passe par trash_entries :
//  toujours réversible, jamais un DELETE direct.
// =============================================================================

import path from 'node:path'

const dossierStandalone = process.env.DESKTOP_SEED_STANDALONE
  ?? path.resolve(process.env.APP_ROOT ?? '.', 'standalone')
const cheminClient =
  'file:///' +
  path.join(dossierStandalone, 'node_modules', '@prisma', 'client', 'default.js').replace(/\\/g, '/')
const { PrismaClient } = await import(cheminClient)

const prisma = new PrismaClient()

function journal(message) {
  console.log(`[sync] ${message}`)
}

/** Y a-t-il une écriture locale PENDING/SYNCING sur cette entité ? */
async function ecritureLocaleEnCours(entityId) {
  const n = await prisma.syncQueueEntry.count({
    where: {
      entityId,
      status: { in: ['PENDING', 'SYNCING'] },
    },
  })
  return n > 0
}

/** Enregistre un conflit LOCAL (double version) dans la base embarquée. */
async function enregistrerConflitLocal(entityType, entityId, distant, local) {
  await prisma.syncConflict.create({
    data: {
      entityType,
      entityId,
      deviceId: '00000000-0000-4000-8000-000000000000',
      localValue: local ? JSON.stringify(local) : null,
      remoteValue: JSON.stringify(distant),
      localUpdatedAt: null,
      remoteUpdatedAt: distant.updatedAt ? new Date(String(distant.updatedAt)) : null,
    },
  })
}

/** Convertit une ligne distante (JSON) en données Prisma sûres par table. */
function normaliser(ligne) {
  const copie = { ...ligne }
  for (const [cle, valeur] of Object.entries(copie)) {
    if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valeur) && /At$|date|Date/.test(cle)) {
      const d = new Date(valeur)
      if (!Number.isNaN(d.getTime())) copie[cle] = d
    }
  }
  // Champs ignorés (Prisma @ignore, colonnes calculées).
  delete copie.creneau
  return copie
}

/**
 * Applique les lots distants reçu du pull. Chaque table est traitée
 * indépendamment ; chaque LIGNE est protégée par sa propre gestion d'erreur :
 * un échec sur une ligne n'annule ni les autres lignes ni les autres tables.
 */
export async function appliquerLotsLocalement(lots, tombstones, tracer = journal) {
  const bilan = { appliques: 0, conflits: 0, ignores: 0, tombstones: 0 }

  // ---- patients : fusion champ par champ ----------------------------------
  for (const ligneBrute of lots.patients ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.patient.findUnique({ where: { id: distant.id } })
      if (!local) {
        const { id, updatedAt, createdAt, ...restes } = distant
        await prisma.patient.create({ data: { id, ...restes } })
        bilan.appliques += 1
        continue
      }
      if (await ecritureLocaleEnCours(distant.id)) {
        // Une écriture locale attend : le pull ne doit pas l'écraser.
        await enregistrerConflitLocal('patients', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      // Fusion champ par champ : le distant s'applique (aucun PENDING local).
      const { id, updatedAt, createdAt, ...restes } = distant
      await prisma.patient.update({ where: { id }, data: restes })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Patient distant ${String(distant.id)} non appliqué : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- appointments : respect des PENDING + contrainte EXCLUDE -------------
  for (const ligneBrute of lots.appointments ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.appointment.findUnique({ where: { id: distant.id } })
      if (local && (await ecritureLocaleEnCours(distant.id))) {
        await enregistrerConflitLocal('appointments', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      const { id, creneau, ...restes } = distant
      await prisma.appointment.upsert({ where: { id }, create: { id, ...restes }, update: restes })
      bilan.appliques += 1
    } catch (e) {
      // Contrainte anti-chevauchement locale (SQLSTATE 23P01) : consigné, pas fatal.
      tracer(`RDV distant ${String(distant.id)} en conflit de créneau local — arbitrage requis.`)
      bilan.conflits += 1
    }
  }

  // ---- treatments : jamais d'écrasement si PENDING ------------------------
  for (const ligneBrute of lots.treatments ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.treatment.findUnique({ where: { id: distant.id } })
      if (local && (await ecritureLocaleEnCours(distant.id))) {
        await prisma.treatment.update({ where: { id: distant.id }, data: { syncStatut: 'A_ARBITRER' } })
        await enregistrerConflitLocal('treatments', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      const { id, ...restes } = distant
      await prisma.treatment.upsert({ where: { id }, create: { id, ...restes }, update: restes })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Traitement distant ${String(distant.id)} non appliqué : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- payments : JAMAIS d'écrasement automatique --------------------------
  for (const ligneBrute of lots.payments ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.payment.findUnique({ where: { id: distant.id } })
      if (!local) {
        // La référence createdBy est obligatoire : le pull s'attache à
        // l'utilisateur du poste (premier compte local actif).
        const utilisateur = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
        const { id, ...restes } = distant
        await prisma.payment.create({
          data: { id, ...restes, createdById: utilisateur?.id ?? restes.createdById },
        })
        bilan.appliques += 1
        continue
      }
      // Paiement existant : si le contenu distant diffère → A_ARBITRER, jamais d'écrasement.
      const differe =
        local.montantCentimes !== distant.montantCentimes ||
        local.statut !== distant.statut ||
        (local.treatmentId ?? null) !== (distant.treatmentId ?? null)
      if (differe) {
        await prisma.payment.update({ where: { id: distant.id }, data: { syncStatut: 'A_ARBITRER' } })
        await enregistrerConflitLocal('payments', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      bilan.ignores += 1
    } catch (e) {
      tracer(`Paiement distant ${String(distant.id)} non appliqué : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- prescriptions -------------------------------------------------------
  for (const ligneBrute of lots.prescriptions ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.prescription.findUnique({ where: { id: distant.id } })
      if (local && (await ecritureLocaleEnCours(distant.id))) {
        await enregistrerConflitLocal('prescriptions', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      const items = Array.isArray(distant.items) ? distant.items : []
      delete distant.items
      const { id, ...restes } = distant
      await prisma.$transaction(async (tx) => {
        await tx.prescription.upsert({ where: { id }, create: { id, ...restes }, update: restes })
        if (items.length > 0) {
          await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } })
          for (const item of items) {
            const { id: itemId, prescriptionId: _pid, ...resteItem } = normaliser(item)
            await tx.prescriptionItem.create({ data: { id: itemId, prescriptionId: id, ...resteItem } })
          }
        }
      })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Ordonnance distante ${String(distant.id)} non appliquée : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- odontogramEntries : historique, CREATE uniquement -------------------
  for (const ligneBrute of lots.odontogramEntries ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const dejaLa = await prisma.odontogramEntry.findUnique({ where: { id: distant.id } })
      if (dejaLa) {
        bilan.ignores += 1
        continue
      }
      const { id, ...restes } = distant
      await prisma.odontogramEntry.create({ data: { id, ...restes } })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Entrée odontogramme distante ${String(distant.id)} non appliquée : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- medicalRecords ------------------------------------------------------
  for (const ligneBrute of lots.medicalRecords ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.medicalRecord.findUnique({ where: { id: distant.id } })
      if (local && (await ecritureLocaleEnCours(distant.id))) {
        await enregistrerConflitLocal('medicalRecords', distant.id, distant, local)
        bilan.conflits += 1
        continue
      }
      const { id, ...restes } = distant
      await prisma.medicalRecord.upsert({ where: { id }, create: { id, ...restes }, update: restes })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Dossier médical distant ${String(distant.id)} non appliqué : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- documents : métadonnées seulement (le binaire vit localement) -------
  for (const ligneBrute of lots.documents ?? []) {
    const distant = normaliser(ligneBrute)
    try {
      const local = await prisma.document.findUnique({ where: { id: distant.id } })
      if (local) {
        bilan.ignores += 1
        continue
      }
      const { id, ...restes } = distant
      await prisma.document.create({ data: { id, ...restes } })
      bilan.appliques += 1
    } catch (e) {
      tracer(`Document distant ${String(distant.id)} non appliqué : ${String(e.message)}`)
      bilan.ignores += 1
    }
  }

  // ---- tombstones durables : suppressions/restaurations distantes (G6) -----
  // Format du journal : { entityType, entityId, type: DELETE|RESTORE, deletedAt }.
  // Les événements sont joués DANS L'ORDRE (asc) : un RESTORE postérieur à un
  // DELETE annule la suppression — jamais de résurrection ni de disparition.
  const tombstoneParEntite = new Map()
  for (const t of tombstones ?? []) {
    tombstoneParEntite.set(t.entityId, t)
  }
  for (const [entityId, meta] of tombstoneParEntite) {
    try {
      const typeSupprimable = {
        patients: 'PATIENT',
        appointments: 'RENDEZ_VOUS',
        treatments: 'TRAITEMENT',
        payments: 'PAIEMENT',
        documents: 'DOCUMENT',
        prescriptions: 'ORDONNANCE',
        odontogramEntries: 'ENTREE_ODONTOGRAMME',
        medicalRecords: 'DOSSIER_MEDICAL',
      }[meta.entityType]
      if (!typeSupprimable) continue
      if (await ecritureLocaleEnCours(entityId)) {
        // Le poste a une écriture non synchronisée sur cette entité : conflit,
        // JAMAIS une suppression silencieuse par-dessus.
        await enregistrerConflitLocal(meta.entityType, entityId, { tombstone: meta }, null)
        bilan.conflits += 1
        continue
      }
      if (meta.type === 'RESTORE') {
        // Restauration distante : retirer le tombstone local si présent.
        await prisma.trashEntry.updateMany({
          where: { entityType: typeSupprimable, entityId, restaureLe: null },
          data: { restaureLe: new Date(meta.deletedAt) },
        })
        bilan.tombstones += 1
        continue
      }
      // DELETE durable : passe par la corbeille locale (réversible), même si
      // l'enregistrement a été physiquement purgé côté serveur.
      await prisma.trashEntry.upsert({
        where: { entityType_entityId: { entityType: typeSupprimable, entityId } },
        create: {
          entityType: typeSupprimable,
          entityId,
          description: `Supprimé en ligne (tombstone durable du ${meta.deletedAt})`,
          snapshot: '{}',
          supprimeLe: new Date(meta.deletedAt),
          expireLe: new Date(new Date(meta.deletedAt).getTime() + 24 * 60 * 60 * 1000),
        },
        update: {
          restaureLe: null,
          restaureParId: null,
          supprimeDefinitivementLe: null,
        },
      })
      bilan.tombstones += 1
    } catch (e) {
      tracer(`Tombstone ${String(entityId)} non appliqué : ${String(e.message)}`)
    }
  }

  return bilan
}

export async function fermerAppliquer() {
  await prisma.$disconnect()
}
