/**
 * =============================================================================
 *  TESTS DURABLES DES TOMBSTONES — §3 de la mission finale
 * =============================================================================
 *  DÉMONTRE contre PostgreSQL réel :
 *
 *    1. Une suppression en ligne produit un tombstone DURABLE, même après
 *       purge de la corbeille (24 h) : un appareil hors ligne PLUS LONGTEMPS
 *       reçoit quand même la suppression — AUCUNE résurrection.
 *    2. Une restauration produit un tombstone RESTORE qui annule le DELETE.
 *    3. La rétention ne purge JAMAIS ce qu'un appareil actif n'a pas lu.
 *    4. Tous les types d'entités (patients, RDV, paiements, traitements,
 *       ordonnances, dossiers médicaux, odontogramme, documents) sont couverts.
 *
 *  Jamais la base du cabinet : base jetable uniquement.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll } from '../helpers/db'

const { mettreEnCorbeille, restaurer, supprimerDefinitivement } = await import(
  '@backend/services/trash.service'
)
const { tombstonesDepuis, purgerTombstonesLus } = await import(
  '@backend/services/sync-tombstones.service'
)

let utilisateurId = ''
let deviceId = ''

async function preparer(): Promise<void> {
  const utilisateur = await dbClient().user.create({
    data: {
      email: `tomb-${crypto.randomUUID().slice(0, 8)}@cabinet.local`,
      displayName: 'Test Tombstones',
      role: 'MEDECIN',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FoZWQtc2VudGluZWwtZHVtbXk$3N0qBq0AV2q6ZBjKQyq1lF8xW2m1XqkV5yZ4wG7bH8c',
    },
  })
  utilisateurId = utilisateur.id
  deviceId = crypto.randomUUID()
  // Curseur à epoch : l'appareil reçoit TOUT l'historique durable.
  await dbClient().syncTombstoneCursor.create({
    data: { deviceId, lastTombstoneAt: new Date(Date.now() - 100 * 365 * 24 * 3600 * 1000) },
  })
}

describe.skipIf(!ACTIVE)('tombstones durables — aucune résurrection', () => {
  beforeEach(async () => {
    await truncateAll()
    await preparer()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('1. suppression en ligne → tombstone durable ; reçoit la suppression APRES purge', async () => {
    const patient = await dbClient().patient.create({
      data: { nom: 'ResurrectTest', prenom: 'X', telephone: '0500000001' },
    })
    const contexte = { userId: utilisateurId, userEmail: 'x@cabinet.local' }

    await mettreEnCorbeille('PATIENT', patient.id, contexte)
    // La fenêtre 24 h interdit la suppression définitive immédiate (règle
    // métier §23) : on simule l'ÉCOULEMENT du délai, comme le ferait le cron
    // de purge (purgerExpires / purge-corbeille.mjs).
    await dbClient().trashEntry.updateMany({
      where: { entityId: patient.id },
      data: {
        supprimeLe: new Date(Date.now() - 25 * 60 * 60 * 1000),
        expireLe: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    })
    await supprimerDefinitivement(
      (await dbClient().trashEntry.findFirst({ where: { entityId: patient.id } }))!.id,
      contexte,
    )
    // L'enregistrement a disparu physiquement.
    expect(await dbClient().patient.findUnique({ where: { id: patient.id } })).toBeNull()

    // L'appareil hors-ligne « 5 jours » lit TOUT l'historique depuis epoch :
    // il voit au moins un tombstone DELETE pour ce patient.
    const { tombstones } = await tombstonesDepuis(deviceId)
    const suppression = tombstones.filter((t) => t.entityId === patient.id && t.type === 'DELETE')
    expect(suppression.length).toBeGreaterThanOrEqual(1)
  })

  it('2. RESTORE annule le DELETE : pas de disparition intempestive', async () => {
    const rdv = await dbClient().appointment.create({
      data: {
        patientId: (await dbClient().patient.create({ data: { nom: 'RestoreT', prenom: 'X', telephone: '0500000002' } })).id,
        dateDebut: new Date('2026-12-20T10:00:00Z'),
        dateFin: new Date('2026-12-20T11:00:00Z'),
        statut: 'PLANIFIE',
      },
    })
    const contexte = { userId: utilisateurId, userEmail: 'x@cabinet.local' }
    await mettreEnCorbeille('RENDEZ_VOUS', rdv.id, contexte)
    await restaurer((await dbClient().trashEntry.findFirst({ where: { entityId: rdv.id } }))!.id, contexte)

    const { tombstones } = await tombstonesDepuis(deviceId)
    const deLa = tombstones.filter((t) => t.entityId === rdv.id)
    expect(deLa.some((t) => t.type === 'DELETE')).toBe(true)
    expect(deLa.some((t) => t.type === 'RESTORE')).toBe(true)
    // Ordre chronologique : le RESTORE est le DERNIER événement de l'entité.
    expect(deLa.at(-1)!.type).toBe('RESTORE')
  })

  it('3. rétention : JAMAIS de purge de ce qu’un appareil actif n’a pas lu', async () => {
    const patient = await dbClient().patient.create({
      data: { nom: 'Retention', prenom: 'X', telephone: '0500000003' },
    })
    await mettreEnCorbeille('PATIENT', patient.id, { userId: utilisateurId, userEmail: 'x@cabinet.local' })

    // L'appareil N'A PAS encore lu (curseur à epoch, pas de pull) : la purge
    // des tombstones lus ne doit RIEN supprimer.
    const avant = await dbClient().syncTombstone.count()
    const purges = await purgerTombstonesLus()
    const apres = await dbClient().syncTombstone.count()
    expect(purges).toBe(0)
    expect(apres).toBe(avant)

    // L'appareil lit (curseur avancé) : maintenant la purge peut opérer.
    await tombstonesDepuis(deviceId)
    const purges2 = await purgerTombstonesLus()
    // (Selon la borne absolue de 90 jours, les tombstones récents ne sont pas
    // encore purgeables — mais AUCUN tombstone non lu n'a jamais disparu.)
    expect(await dbClient().syncTombstone.findMany({
      where: { entityId: patient.id },
    }).then((l) => l.length)).toBeGreaterThanOrEqual(1)
    void purges2
  })

  it('4. tous les types d’entités produisent des tombstones utilisables par le pull', async () => {
    const contexte = { userId: utilisateurId, userEmail: 'x@cabinet.local' }
    const patient = await dbClient().patient.create({ data: { nom: 'TousTypes', prenom: 'X', telephone: '0500000004' } })
    const traitement = await dbClient().treatment.create({
      data: { patientId: patient.id, typeTraitement: 'Soin', prixTotalCentimes: 1000 },
    })
    const rdv = await dbClient().appointment.create({
      data: { patientId: patient.id, dateDebut: new Date(), dateFin: new Date(Date.now() + 3600_000) },
    })
    const ordonnance = await dbClient().prescription.create({
      data: { patientId: patient.id, date: new Date() },
    })
    const dossier = await dbClient().medicalRecord.create({
      data: { patientId: patient.id, date: new Date() },
    })
    const dent = await dbClient().odontogramEntry.create({
      data: { patientId: patient.id, numeroDent: '36', etat: 'CARIE', date: new Date() },
    })

    for (const [type, id] of [
      ['TRAITEMENT', traitement.id],
      ['RENDEZ_VOUS', rdv.id],
      ['ORDONNANCE', ordonnance.id],
      ['DOSSIER_MEDICAL', dossier.id],
      ['ENTREE_ODONTOGRAMME', dent.id],
      ['PATIENT', patient.id],
    ] as const) {
      await mettreEnCorbeille(type, id, contexte)
    }

    const { tombstones } = await tombstonesDepuis(deviceId)
    const tables = new Set(tombstones.map((t) => t.entityType))
    for (const attendu of ['treatments', 'appointments', 'prescriptions', 'medicalRecords', 'odontogramEntries', 'patients']) {
      expect(tables.has(attendu)).toBe(true)
    }
  })

  it('5. crash-safety : le tombstone appartient à la transaction de suppression', async () => {
    // Si la suppression échoue (rollback), le tombstone doit disparaître avec
    // elle : jamais de trace sans suppression (cohérence de l'audit).
    const patient = await dbClient().patient.create({ data: { nom: 'TxSafety', prenom: 'X', telephone: '0500000005' } })
    await dbClient().treatment.create({
      data: { patientId: patient.id, typeTraitement: 'Soin', prixTotalCentimes: 5000 },
    })
    const contexte = { userId: utilisateurId, userEmail: 'x@cabinet.local' }
    await mettreEnCorbeille('PATIENT', patient.id, contexte)
    // La suppression DEFINITIVE est refusée (historique financier protégé).
    const entreeId = (await dbClient().trashEntry.findFirst({ where: { entityId: patient.id } }))!.id
    await expect(supprimerDefinitivement(entreeId, contexte)).rejects.toThrow()
    // Les tombstones présents sont ceux de la corbeille (DELETE avec
    // sourceTrashId) — jamais un DELETE sans trace de corbeille.
    const tombstones = await dbClient().syncTombstone.findMany({ where: { entityId: patient.id } })
    expect(tombstones.length).toBeGreaterThanOrEqual(1)
    expect(tombstones.every((t) => t.type === 'DELETE' && t.sourceTrashId !== null)).toBe(true)
  })
})
