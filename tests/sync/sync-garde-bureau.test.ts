/**
 * =============================================================================
 *  GARDE-FOU SAHED_DESKTOP_LOCAL — §4 de la mission finale
 * =============================================================================
 *  Vérifie le COMPORTEMENT RÉEL (pas le nom d'une variable) :
 *
 *    1. Sans la variable (production/dev) : AUCUNE écriture dans sync_queue,
 *       quel que soit le service métier appelé.
 *    2. Avec SAHED_DESKTOP_LOCAL=1 : chaque écriture métier produit bien UNE
 *       opération dans la file, avec le bon entityType et le bon operationId.
 *    3. La variable ne peut pas « fuiter » : les tests réinitialisent l'état
 *       et vérifient le contexte d'exécution réel du module.
 *
 *  Base jetable uniquement — jamais la base du cabinet.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll } from '../helpers/db'

const { journaliserOperationLocale, estBureauLocal, chargeUtile } = await import(
  '@backend/services/sync-outbox.service'
)
const { creerPatient } = await import('@backend/services/patients.service')
const { enregistrerChangement } = await import('@backend/services/odontogram.service')

const contexte = { userId: '', userEmail: 'garde@cabinet.local' }

/** Donnees minimales valides pour creerPatient (champs optionnels inclus). */
function donneesPatient(nom: string, telephone: string): Parameters<typeof creerPatient>[0] {
  return {
    nom,
    prenom: 'X',
    age: 30,
    dateNaissance: null,
    sexe: 'NON_PRECISE',
    telephone,
    telephoneSecondaire: null,
    adresse: null,
    email: null,
    allergies: null,
    antecedentsMedicaux: null,
    medicamentsActuels: null,
    contactUrgence: null,
    notesGenerales: null,
  } as Parameters<typeof creerPatient>[0]
}

describe.skipIf(!ACTIVE)('garde-fou SAHED_DESKTOP_LOCAL (comportement réel)', () => {
  beforeEach(async () => {
    await truncateAll()
    delete process.env.SAHED_DESKTOP_LOCAL
    const utilisateur = await dbClient().user.create({
      data: {
        email: 'garde@cabinet.local',
        displayName: 'Garde',
        role: 'MEDECIN',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FoZWQtc2VudGluZWwtZHVtbXk$3N0qBq0AV2q6ZBjKQyq1lF8xW2m1XqkV5yZ4wG7bH8c',
      },
    })
    contexte.userId = utilisateur.id
  })

  afterAll(async () => {
    await closeDb()
  })

  it('1. SANS la variable (mode production) : aucun écriture dans la file', async () => {
    delete process.env.SAHED_DESKTOP_LOCAL
    expect(estBureauLocal()).toBe(false)

    const patient = await creerPatient(donneesPatient('ProdSilence', '051111'))
    await enregistrerChangement(
      { patientId: patient.id, treatmentId: null, numeroDent: '11', etat: 'CARIE', commentaire: null, date: new Date() },
      contexte,
    )

    const n = await dbClient().syncQueueEntry.count()
    expect(n).toBe(0)
  })

  it('2. AVEC la variable : chaque écriture métier journalise UNE opération', async () => {
    process.env.SAHED_DESKTOP_LOCAL = '1'
    expect(estBureauLocal()).toBe(true)

    const patient = await creerPatient(donneesPatient('BureauActif', '0511111112'))
    let ops = await dbClient().syncQueueEntry.findMany({ where: { entityId: patient.id } })
    expect(ops).toHaveLength(1)
    expect(ops[0]!.entityType).toBe('patients')
    expect(ops[0]!.operation).toBe('CREATE')
    expect(ops[0]!.status).toBe('PENDING')
    // L'operationId est un UUID strict (clé d'idempotence serveur).
    expect(ops[0]!.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

    await enregistrerChangement(
      { patientId: patient.id, treatmentId: null, numeroDent: '12', etat: 'OBTUREE', commentaire: null, date: new Date() },
      contexte,
    )
    ops = await dbClient().syncQueueEntry.findMany({ where: { entityType: 'odontogramEntries' } })
    expect(ops).toHaveLength(1)
    expect(JSON.parse(ops[0]!.payload).numeroDent).toBe('12')
  })

  it('3. une valeur autre que "1" NE active PAS le mode bureau', async () => {
    for (const valeur of ['true', 'oui', 'yes', '0', '1 ', '']) {
      process.env.SAHED_DESKTOP_LOCAL = valeur
      expect(estBureauLocal()).toBe(false)
    }
    delete process.env.SAHED_DESKTOP_LOCAL
  })

  it('4. insertion hors transaction : jamais bloquante pour l’écriture métier', async () => {
    process.env.SAHED_DESKTOP_LOCAL = '1'
    // Payload non sérialisable (référence circulaire) : l'insertion doit être
    // capturée et l'écriture métier COMMITTÉE quand même.
    const circulaire: Record<string, unknown> = {}
    circulaire.luiMeme = circulaire
    await expect(
      journaliserOperationLocale({
        entityType: 'patients',
        entityId: crypto.randomUUID(),
        operation: 'CREATE',
        payload: circulaire,
      }),
    ).resolves.toBeUndefined()
  })

  it('5. chargeUtile : dates en ISO, colonnes techniques exclues', async () => {
    const maintenant = new Date()
    const charge = chargeUtile({
      id: 'abc',
      updatedAt: maintenant,
      createdAt: maintenant,
      creneau: '[2026,2027)',
      nom: 'Test',
    })
    expect(charge.updatedAt).toBe(maintenant.toISOString())
    expect(charge.creneau).toBeUndefined()
    expect(charge.nom).toBe('Test')
  })
})
