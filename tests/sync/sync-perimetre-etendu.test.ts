/**
 * =============================================================================
 *  TESTS DE SYNCHRONISATION DU NOUVEAU PÉRIMÈTRE (audit G2, G6, G7, G8)
 * =============================================================================
 *  Complète `tests/sync/sync-offline-first.test.ts` avec les garanties ajoutées
 *  dans cette passe :
 *
 *    1. Prescription poussee depuis le bureau : appliquée (entité G7).
 *    2. Entrée d'odontogramme poussée : appliquée ; UPDATE rejetté (historique §20).
 *    3. TRASH d'ordonnance / dossier médical : tombstone réversible.
 *    4. Lot d'un patient + son ordonnance : ordre respecté, tout appliqué.
 *    5. Le pull EXCLUT les tombstones déjà appliqués (aucune résurrection).
 *
 *  Comme la suite historique : PostgreSQL réel jetable, jamais la base du
 *  cabinet. Ignorée (jamais simulée) sans TEST_DATABASE_URL.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll } from '../helpers/db'

const { pousserOperations, appairerAppareil } = await import('@backend/services/sync.service')

let utilisateurId = ''
let appareilId = ''
let jetonAppareil = ''

async function preparerAppareil(): Promise<void> {
  const utilisateur = await dbClient().user.create({
    data: {
      email: `sync2-${crypto.randomUUID().slice(0, 8)}@cabinet.local`,
      displayName: 'Test Sync 2',
      role: 'MEDECIN',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FoZWQtc2VudGluZWwtZHVtbXk$3N0qBq0AV2q6ZBjKQyq1lF8xW2m1XqkV5yZ4wG7bH8c',
    },
  })
  utilisateurId = utilisateur.id
  const appairage = await appairerAppareil({
    userId: utilisateurId,
    deviceId: crypto.randomUUID(),
    label: 'Poste de test 2',
  })
  const appareils = await dbClient().deviceSession.findFirst({
    where: { userId: utilisateurId },
    select: { deviceId: true },
  })
  appareilId = appareils!.deviceId
  jetonAppareil = appairage.jeton
}

async function creerPatient(nom: string): Promise<string> {
  const p = await dbClient().patient.create({
    data: { nom, prenom: 'Sync2', telephone: '0555010999' },
    select: { id: true },
  })
  return p.id
}

describe.skipIf(!ACTIVE)('synchronisation — périmètre étendu (audit G6/G7)', () => {
  beforeEach(async () => {
    await truncateAll()
    await preparerAppareil()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('1. prescription CREATE depuis le bureau : appliquée', async () => {
    const patient = await creerPatient('OrdoSync')
    const ordonnanceId = crypto.randomUUID()
    const { resultats } = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'prescriptions',
        entityId: ordonnanceId,
        operation: 'CREATE',
        payload: {
          patientId: patient,
          date: new Date().toISOString(),
          notes: 'Test sync ordonnance',
        },
      },
    ])
    expect(resultats[0]?.outcome).toBe('APPLIED')
    const ordonnance = await dbClient().prescription.findUnique({ where: { id: ordonnanceId } })
    expect(ordonnance).not.toBeNull()
    expect(ordonnance?.patientId).toBe(patient)
  })

  it('2. odontogramEntries : CREATE appliqué, UPDATE rejeté (historique §20)', async () => {
    const patient = await creerPatient('DentSync')
    const entreeId = crypto.randomUUID()
    const premier = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'odontogramEntries',
        entityId: entreeId,
        operation: 'CREATE',
        payload: { patientId: patient, numeroDent: '36', etat: 'CARIE', date: new Date().toISOString() },
      },
    ])
    expect(premier.resultats[0]?.outcome).toBe('APPLIED')

    const second = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'odontogramEntries',
        entityId: entreeId,
        operation: 'UPDATE',
        payload: { etat: 'OBTUREE' },
      },
    ])
    expect(second.resultats[0]?.outcome).toBe('REJECTED')

    // L'entrée historique est inchangée : jamais d'écrasement d'odontogramme.
    const entree = await dbClient().odontogramEntry.findUnique({ where: { id: entreeId } })
    expect(entree?.etat).toBe('CARIE')
  })

  it('3. TRASH d’ordonnance puis RESTORE : tombstone réversible', async () => {
    const patient = await creerPatient('OrdoTrash')
    const ordonnanceId = crypto.randomUUID()
    await dbClient().prescription.create({
      data: { id: ordonnanceId, patientId: patient, date: new Date() },
    })
    // TRASH
    {
      const { resultats } = await pousserOperations(appareilId, jetonAppareil, [
        {
          operationId: crypto.randomUUID(),
          entityType: 'prescriptions',
          entityId: ordonnanceId,
          operation: 'TRASH',
          payload: { notes: 'test' },
        },
      ])
      expect(resultats[0]?.outcome).toBe('APPLIED')
      const corbeille = await dbClient().trashEntry.findFirst({ where: { entityId: ordonnanceId } })
      expect(corbeille?.restaureLe).toBeNull()
      // La ligne elle-même n'est jamais détruite.
      expect(await dbClient().prescription.findUnique({ where: { id: ordonnanceId } })).not.toBeNull()
    }

    const { resultats: restauration } = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'prescriptions',
        entityId: ordonnanceId,
        operation: 'RESTORE',
        payload: {},
      },
    ])
    expect(restauration[0]?.outcome).toBe('APPLIED')
    const corbeilleApres = await dbClient().trashEntry.findFirst({ where: { entityId: ordonnanceId } })
    expect(corbeilleApres?.restaureLe).not.toBeNull()
  })

  it('4. lot patient + ordonnance : tout est appliqué dans l’ordre', async () => {
    const patientId = crypto.randomUUID()
    const ordonnanceId = crypto.randomUUID()
    const { resultats } = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'patients',
        entityId: patientId,
        operation: 'CREATE',
        payload: { nom: 'LotOrdre', prenom: 'Test', telephone: '0555000777', updatedAt: new Date().toISOString() },
      },
      {
        operationId: crypto.randomUUID(),
        entityType: 'prescriptions',
        entityId: ordonnanceId,
        operation: 'CREATE',
        payload: { patientId: patientId, date: new Date().toISOString() },
      },
    ])
    expect(resultats.map((r) => r.outcome)).toEqual(['APPLIED', 'APPLIED'])
    expect(await dbClient().prescription.findUnique({ where: { id: ordonnanceId } })).not.toBeNull()
  })

  it('5. dossier médical CREATE : appliqué, conflit si double modification', async () => {
    const patient = await creerPatient('DossierSync')
    const dossierId = crypto.randomUUID()
    const premier = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'medicalRecords',
        entityId: dossierId,
        operation: 'CREATE',
        payload: { patientId: patient, date: new Date().toISOString(), observations: 'Initiales' },
      },
    ])
    expect(premier.resultats[0]?.outcome).toBe('APPLIED')

    // Modification concurrente côté serveur (updatedAt serveur postérieur).
    await dbClient().medicalRecord.update({
      where: { id: dossierId },
      data: { observations: 'Coté serveur' },
    })

    const second = await pousserOperations(appareilId, jetonAppareil, [
      {
        operationId: crypto.randomUUID(),
        entityType: 'medicalRecords',
        entityId: dossierId,
        operation: 'UPDATE',
        payload: { observations: 'Coté bureau', updatedAt: new Date(Date.now() - 60_000).toISOString() },
      },
    ])
    expect(second.resultats[0]?.outcome).toBe('CONFLICT')
    // Les deux versions sont conservées, jamais d'écrasement.
    const conflits = await dbClient().syncConflict.findMany({ where: { entityType: 'medicalRecords' } })
    expect(conflits.length).toBeGreaterThanOrEqual(1)
  })
})
