/**
 * =============================================================================
 *  INTEGRATION POSTGRESQL — ODONTOGRAMME : CAS « CORBEILLE VIDE »
 * =============================================================================
 *
 *  Regression d'un defaut REEL decouvert par le test de charge Tier 3 :
 *
 *    `etatCourantPatient()` construisait `AND "id" NOT IN (${Prisma.join(ids)})`.
 *    `Prisma.join` REFUSE un tableau vide. Or la Corbeille est le plus souvent
 *    vide : `GET /api/patients/:id/odontogram` renvoyait donc une erreur 500
 *    dans le cas NORMAL d'utilisation.
 *
 *  Le test prouve ici que l'endpoint fonctionne :
 *    - quand AUCUNE entree d'odontogramme n'est en corbeille (cas normal) ;
 *    - quand des entrees SONT en corbeille (exclusion attendue).
 *
 *  Activation : `TEST_DATABASE_URL` (base jetable). Sans elle, suite IGNOREE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll, verifySchemaReady } from '../helpers/db'

const { getOdontogrammePatient } = await import('@backend/services/odontogram.service')

let patientId = ''

describe.skipIf(!ACTIVE)('Odontogramme — integration PostgreSQL (corbeille vide)', () => {
  beforeAll(async () => {
    await verifySchemaReady()
  })

  beforeEach(async () => {
    await truncateAll()
    const patient = await dbClient().patient.create({
      data: { nom: 'Dent', prenom: 'Est', telephone: '0555000000' },
      select: { id: true },
    })
    patientId = patient.id
  })

  afterAll(async () => {
    await closeDb()
  })

  it('ne plante PAS quand la Corbeille est vide (cas normal, ex-defaut 500)', async () => {
    const db = dbClient()
    // Aucune entree en corbeille : c'est l'etat ordinaire.
    await db.odontogramEntry.createMany({
      data: [
        { patientId, numeroDent: '11', etat: 'SAINE', date: new Date('2026-01-01T10:00:00Z') },
        { patientId, numeroDent: '36', etat: 'CARIE', date: new Date('2026-02-01T10:00:00Z') },
      ],
    })

    const odontogramme = await getOdontogrammePatient(patientId)
    expect(odontogramme.etatCourant['11']?.etat).toBe('SAINE')
    expect(odontogramme.etatCourant['36']?.etat).toBe('CARIE')
    expect(Object.keys(odontogramme.etatCourant)).toHaveLength(2)
  })

  it('renvoie un odontogramme vide (sans erreur) pour un patient sans aucune entree', async () => {
    const odontogramme = await getOdontogrammePatient(patientId)
    expect(odontogramme.etatCourant).toEqual({})
    expect(odontogramme.historiqueParDent).toEqual({})
    expect(odontogramme.historiqueTronque).toBe(false)
  })

  it('conserve l’etat courant exact = derniere entree par dent', async () => {
    const db = dbClient()
    await db.odontogramEntry.createMany({
      data: [
        { patientId, numeroDent: '36', etat: 'CARIE', date: new Date('2026-01-01T10:00:00Z') },
        { patientId, numeroDent: '36', etat: 'OBTUREE', date: new Date('2026-03-01T10:00:00Z') },
      ],
    })
    const odontogramme = await getOdontogrammePatient(patientId)
    expect(odontogramme.etatCourant['36']?.etat).toBe('OBTUREE')
    expect(odontogramme.historiqueParDent['36']).toHaveLength(2)
  })

  it('exclut une entree presente en Corbeille', async () => {
    const db = dbClient()
    const entree = await db.odontogramEntry.create({
      data: { patientId, numeroDent: '11', etat: 'ABSENTE', date: new Date('2026-01-01T10:00:00Z') },
      select: { id: true },
    })
    const supprimeLe = new Date()
    await db.trashEntry.create({
      data: {
        entityType: 'ENTREE_ODONTOGRAMME',
        entityId: entree.id,
        description: 'Dent 11',
        snapshot: '{}',
        supprimeLe,
        expireLe: new Date(supprimeLe.getTime() + 24 * 60 * 60 * 1000),
      },
    })

    const odontogramme = await getOdontogrammePatient(patientId)
    // L'entree supprimee ne compte plus dans l'etat courant.
    expect(odontogramme.etatCourant['11']).toBeUndefined()
  })
})