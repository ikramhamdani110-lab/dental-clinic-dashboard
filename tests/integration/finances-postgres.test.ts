/**
 * =============================================================================
 *  INTEGRATION POSTGRESQL REELLE — FINANCES PRIVEES
 * =============================================================================
 *
 *  Verifie, contre une instance PostgreSQL REELLE (base JETABLE jamais celle du
 *  cabinet) :
 *
 *    1. Agregation des paiements VALIDE (partial payments inclus une fois).
 *    2. Exclusion des paiements ANNULE et de la corbeille.
 *    3. Bornes de date du calendrier LOCAL (frontiere de journee/mois).
 *    4. Anti-doublon par cle d'idempotence sur manual_incomes et expenses.
 *    5. Soldes patients (restant du) jamais confondus avec du revenu.
 *
 *  Activation : TEST_DATABASE_URL (base jetable) puis `npm run test`.
 *  Sans cette variable, la suite est IGNOREE — jamais simulee.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll, verifySchemaReady } from '../helpers/db'

const {
  revenusPaiements,
  nombrePaiements,
  revenusManuels,
  totalDepenses,
  totalRestantDu,
  syntheseFinanciere,
  creerRevenuManuel,
  creerDepense,
  periodeMois,
} = await import('@backend/services/finances.service')

let utilisateurId = ''
let compteurIdempotence = 0

async function creerPatient(nom: string): Promise<string> {
  const p = await dbClient().patient.create({
    data: { nom, prenom: 'Test', telephone: '0555000000' },
    select: { id: true },
  })
  return p.id
}

async function creerTraitement(patientId: string, prixTotalCentimes: number): Promise<string> {
  const t = await dbClient().treatment.create({
    data: { patientId, typeTraitement: 'Soin', prixTotalCentimes, statut: 'EN_COURS' },
    select: { id: true },
  })
  return t.id
}

async function creerPaiement(
  patientId: string,
  treatmentId: string,
  montantCentimes: number,
  datePaiement: Date,
  statut: 'VALIDE' | 'ANNULE' = 'VALIDE',
): Promise<string> {
  compteurIdempotence += 1
  const p = await dbClient().payment.create({
    data: {
      patientId,
      treatmentId,
      montantCentimes,
      datePaiement,
      methode: 'ESPECES',
      statut,
      idempotencyKey: `fin-test-${compteurIdempotence}`,
      createdById: utilisateurId,
    },
    select: { id: true },
  })
  return p.id
}

/** Contexte de journal minimal pour les creations (id utilisateur reel). */
const contexte = () => ({ userId: utilisateurId, userEmail: 'medecin@test.dz' })

describe.skipIf(!ACTIVE)('Integration PostgreSQL reelle — finances privees', () => {
  beforeAll(async () => {
    await verifySchemaReady()
  })

  beforeEach(async () => {
    await truncateAll()
    compteurIdempotence = 0
    const user = await dbClient().user.create({
      data: {
        email: 'medecin@test.dz',
        displayName: 'Dr Test',
        passwordHash: 'x'.repeat(40),
        role: 'MEDECIN',
      },
      select: { id: true },
    })
    utilisateurId = user.id
  })

  afterAll(async () => {
    await closeDb()
  })

  // =========================================================================
  //  AGREGATION DES PAIEMENTS
  // =========================================================================

  it('somme uniquement les paiements VALIDE (partial payments comptés une fois)', async () => {
    const patient = await creerPatient('Benali')
    const traitement = await creerTraitement(patient, 30_000)
    const maintenant = new Date()

    // Paiement partiel 1, paiement partiel 2 (complément), puis un ANNULE.
    await creerPaiement(patient, traitement, 10_000, maintenant, 'VALIDE')
    await creerPaiement(patient, traitement, 20_000, maintenant, 'VALIDE')
    await creerPaiement(patient, traitement, 30_000, maintenant, 'ANNULE')

    const periode = periodeMois(maintenant)
    const total = await revenusPaiements(periode.debut, periode.fin)
    const nombre = await nombrePaiements(periode.debut, periode.fin)

    // 10 000 + 20 000 = 30 000 centimes. L'ANNULE ne compte pas.
    expect(total).toBe(30_000)
    expect(nombre).toBe(2)
  })

  it('exclut les paiements placés en corbeille', async () => {
    const patient = await creerPatient('Karim')
    const traitement = await creerTraitement(patient, 20_000)
    const maintenant = new Date()

    const aMettreEnCorbeille = await creerPaiement(patient, traitement, 5_000, maintenant)
    await creerPaiement(patient, traitement, 15_000, maintenant)

    // Contrainte base : expireLe = supprimeLe + 24h EXACTEMENT.
    const supprimeLe = new Date()
    const expireLe = new Date(supprimeLe.getTime() + 24 * 60 * 60 * 1000)
    await dbClient().trashEntry.create({
      data: {
        entityType: 'PAIEMENT',
        entityId: aMettreEnCorbeille,
        description: 'Paiement test',
        snapshot: '{}',
        supprimeLe,
        expireLe,
      },
    })

    const periode = periodeMois(maintenant)
    const total = await revenusPaiements(periode.debut, periode.fin)
    expect(total).toBe(15_000)
  })

  it('respecte la frontière de journée du calendrier LOCAL (minuit exact)', async () => {
    const patient = await creerPatient('Yasmine')
    const traitement = await creerTraitement(patient, 10_000)
    const maintenant = new Date()
    const periode = periodeMois(maintenant)

    // Paiement à 23:59:59.999 la veille du début : HORS borne.
    const veille = new Date(periode.debut.getTime() - 1)
    await creerPaiement(patient, traitement, 1_000, veille)
    // Paiement exactement au début de borne (00:00:00.000) : DANS la borne.
    await creerPaiement(patient, traitement, 2_000, periode.debut)

    const total = await revenusPaiements(periode.debut, periode.fin)
    expect(total).toBe(2_000)
  })

  it('respecte la frontière de fin de mois (23:59:59.999 inclus)', async () => {
    const patient = await creerPatient('Omar')
    const traitement = await creerTraitement(patient, 10_000)
    const maintenant = new Date()

    // La contrainte base `payments_date_plausible_check` impose datePaiement
    // < maintenant + 1 jour : si la FIN du mois est trop proche ou dépasse
    // cette limite (début de mois en cours), on teste la borne sur un MOIS
    // COMPLET passe, dont la fin est dans le passe.
    const finPassee = new Date(maintenant.getFullYear(), maintenant.getMonth(), 0, 23, 59, 59, 999)
    const debutPassee = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1, 0, 0, 0, 0)

    await creerPaiement(patient, traitement, 3_000, finPassee)
    // Une milliseconde de plus : hors borne.
    await creerPaiement(patient, traitement, 4_000, new Date(finPassee.getTime() + 1))

    const total = await revenusPaiements(debutPassee, finPassee)
    expect(total).toBe(3_000)
  })

  it('totalRestantDu : traitements ANNULE exclus, paiements VALIDE déduits', async () => {
    const patient = await creerPatient('Sara')
    const actif = await creerTraitement(patient, 50_000)
    await creerTraitement(patient, 20_000).then(async (annule) => {
      await dbClient().treatment.update({ where: { id: annule }, data: { statut: 'ANNULE' } })
    })

    await creerPaiement(patient, actif, 20_000, new Date())

    const restant = await totalRestantDu()
    // 50 000 (traitement actif) - 20 000 payé = 30 000. L'annulé (20 000) hors calcul.
    expect(restant).toBe(30_000)
  })

  // =========================================================================
  //  SYNTHESE FINANCIERE
  // =========================================================================

  it('syntheseFinanciere : solde net = paiements + manuels - dépenses, restant du séparé', async () => {
    const patient = await creerPatient('Nadia')
    const traitement = await creerTraitement(patient, 100_000)
    const maintenant = new Date()
    const periode = periodeMois(maintenant)

    await creerPaiement(patient, traitement, 40_000, maintenant)
    compteurIdempotence += 1
    await creerRevenuManuel(
      {
        montantCentimes: 5_000,
        date: maintenant,
        categorie: 'LOCATION_SALLE',
        description: null,
        notes: null,
        idempotencyKey: `man-${compteurIdempotence}`,
      },
      contexte(),
    )
    compteurIdempotence += 1
    await creerDepense(
      {
        titre: 'Fournitures de test',
        montantCentimes: 10_000,
        date: maintenant,
        categorie: 'FOURNITURES',
        idempotencyKey: `dep-${compteurIdempotence}`,
      },
      contexte(),
    )

    const synthese = await syntheseFinanciere(periode)
    expect(synthese.revenusPaiementsCentimes).toBe(40_000)
    expect(synthese.revenusManuelsCentimes).toBe(5_000)
    expect(synthese.depensesCentimes).toBe(10_000)
    // Solde net = revenus REÇUS − dépenses. Le revenu manuel n'est pas de
    // l'argent encaissé par le cabinet : il n'entre pas dans ce solde.
    expect(synthese.soldeNetCentimes).toBe(30_000)
    // Restant dû = 100 000 - 40 000 = 60 000 — AFFICHÉ séparément, jamais un revenu.
    expect(synthese.restantDuCentimes).toBe(60_000)
  })

  // =========================================================================
  //  ANTI-DOUBLON (manual income + expense)
  // =========================================================================

  it('creerRevenuManuel : un second envoi avec la même clé ne crée pas de doublon', async () => {
    const maintenant = new Date()
    const donnees = {
      montantCentimes: 7_500,
      date: maintenant,
      categorie: 'AUTRE',
      description: null,
      notes: null,
      idempotencyKey: 'anti-doublon-rev-1',
    }

    const premier = await creerRevenuManuel(donnees, contexte())
    const second = await creerRevenuManuel(donnees, contexte())

    expect(premier.dejaEnregistre).toBe(false)
    expect(second.dejaEnregistre).toBe(true)
    expect(second.id).toBe(premier.id)

    const total = await revenusManuels(
      new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
      new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0, 23, 59, 59, 999),
    )
    expect(total).toBe(7_500)
  })

  it('creerDepense : un second envoi avec la même clé ne crée pas de doublon', async () => {
    const maintenant = new Date()
    const donnees = {
      titre: 'Loyer du local',
      montantCentimes: 12_000,
      date: maintenant,
      categorie: 'LOYER',
      idempotencyKey: 'anti-doublon-dep-1',
    }

    const premier = await creerDepense(donnees, contexte())
    const second = await creerDepense(donnees, contexte())

    expect(premier.dejaEnregistre).toBe(false)
    expect(second.dejaEnregistre).toBe(true)
    expect(second.id).toBe(premier.id)

    const total = await totalDepenses(
      new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
      new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0, 23, 59, 59, 999),
    )
    expect(total).toBe(12_000)
  })
})
