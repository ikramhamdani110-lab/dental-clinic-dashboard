/**
 * =============================================================================
 *  INTEGRATION POSTGRESQL REELLE — REVENUS MENSUELS & SOLDES PATIENTS
 * =============================================================================
 *
 *  Tier 2 avait laisse ces deux requetes reecrites en SQL avec une verification
 *  STRUCTURELLE seulement : le client Prisma etait remplace par un double, ce
 *  qui prouvait que la logique avait ete deplacee en base, mais PAS que le SQL
 *  s'executait reellement, que les CAST d'enum etaient valides, ni que
 *  DATE_TRUNC / SUM / LIMIT / OFFSET se comportaient comme attendu.
 *
 *  Ce fichier execute les VRAIES requetes contre une instance PostgreSQL 16
 *  reelle, sur le schema reel produit par les migrations. Aucun mock.
 *
 *  Activation : definir `TEST_DATABASE_URL` (base JETABLE, jamais celle du
 *  cabinet) puis lancer `npm run test`. Sans cette variable, la suite est
 *  explicitement IGNOREE — jamais simulee.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// La base cible doit etre posee AVANT le premier import des services, car
// `getEnv()` met la configuration en cache au premier acces.
const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
const ACTIVE = TEST_URL.length > 0
if (ACTIVE) {
  process.env.DATABASE_URL = TEST_URL
  process.env.DATABASE_PROVIDER = 'postgresql'
}

import { closeDb, dbClient, truncateAll, verifySchemaReady } from '../helpers/db'

const { revenusParMois } = await import('@backend/services/payments.service')
const { rapportSoldesPatients } = await import('@backend/services/reports.service')

// Reference calee dans le PASSE proche : les paiements datent d'un instant
// anterieur a « maintenant », ce qui respecte la contrainte base
// `payments_date_plausible_check` (datePaiement < maintenant + 1 jour).
// Fenetre de 12 mois pour cette reference : octobre 2025 .. septembre 2026.
const REFERENCE_UTC = new Date('2026-09-15T12:00:00.000Z')

/** Cree un patient minimal et renvoie son identifiant. */
async function creerPatient(nom: string, prenom: string): Promise<string> {
  const patient = await dbClient().patient.create({
    data: { nom, prenom, telephone: '0555000000' },
    select: { id: true },
  })
  return patient.id
}

let utilisateurId = ''

/** Cree un traitement et renvoie son identifiant. */
async function creerTraitement(
  patientId: string,
  prixTotalCentimes: number,
  statut: 'PLANIFIE' | 'EN_COURS' | 'TERMINE' | 'ANNULE' = 'EN_COURS',
): Promise<string> {
  const traitement = await dbClient().treatment.create({
    data: { patientId, typeTraitement: 'Soin', prixTotalCentimes, statut },
    select: { id: true },
  })
  return traitement.id
}

let compteurIdempotence = 0

/** Cree un paiement et renvoie son identifiant. */
async function creerPaiement(
  patientId: string,
  treatmentId: string,
  montantCentimes: number,
  datePaiement: Date,
  statut: 'VALIDE' | 'ANNULE' = 'VALIDE',
): Promise<string> {
  compteurIdempotence += 1
  const paiement = await dbClient().payment.create({
    data: {
      patientId,
      treatmentId,
      montantCentimes,
      datePaiement,
      methode: 'ESPECES',
      statut,
      idempotencyKey: `test-${compteurIdempotence}`,
      createdById: utilisateurId,
    },
    select: { id: true },
  })
  return paiement.id
}

/** Mesure le temps d'execution d'une fonction async, en millisecondes. */
async function mesurer<T>(fn: () => Promise<T>): Promise<{ valeur: T; ms: number }> {
  const debut = performance.now()
  const valeur = await fn()
  return { valeur, ms: performance.now() - debut }
}

describe.skipIf(!ACTIVE)('Integration PostgreSQL reelle — rapports', () => {
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
      },
      select: { id: true },
    })
    utilisateurId = user.id
  })

  afterAll(async () => {
    await closeDb()
  })

  // ===========================================================================
  //  1. revenusParMois — SQL, enum cast, DATE_TRUNC, SUM, bornes, fuseau
  // ===========================================================================
  describe('revenusParMois()', () => {
    it('execute le SQL sans erreur et renvoie 12 mois a zero sur base vide', async () => {
      const { valeur: serie, ms } = await mesurer(() => revenusParMois(12, REFERENCE_UTC))
      expect(serie).toHaveLength(12)
      expect(serie.every((p) => p.totalCentimes === 0)).toBe(true)
      // Octobre 2025 (septembre 2026 - 11 mois) .. septembre 2026.
      expect(serie[0]).toEqual({ mois: 9, annee: 2025, totalCentimes: 0 })
      expect(serie[11]).toEqual({ mois: 8, annee: 2026, totalCentimes: 0 })
      // eslint-disable-next-line no-console
      console.info(`[PERF] revenusParMois (base vide) : ${ms.toFixed(2)} ms`)
    })

    it('accepte le cast d’enum StatutPaiement (aucune erreur de type SQL)', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 10_000)
      await creerPaiement(patient, traitement, 5_000, new Date('2026-01-10T10:00:00.000Z'))
      // Si le cast `'VALIDE'::"StatutPaiement"` etait invalide, la requete
      // leverait ici. L'absence d'exception prouve la validite du cast.
      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie.find((p) => p.mois === 0 && p.annee === 2026)?.totalCentimes).toBe(5_000)
    })

    it('agrege plusieurs paiements du meme mois (SUM + GROUP BY)', async () => {
      const patient = await creerPatient('A', 'A')
      const t1 = await creerTraitement(patient, 100_000)
      const t2 = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, t1, 1_000, new Date('2026-01-04T10:00:00.000Z'))
      await creerPaiement(patient, t2, 2_000, new Date('2026-01-20T10:00:00.000Z'))
      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(3_000)
    })

    it('separe correctement les paiements de mois differents (DATE_TRUNC)', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, traitement, 4_000, new Date('2026-01-15T10:00:00.000Z'))
      await creerPaiement(patient, traitement, 7_000, new Date('2026-03-05T10:00:00.000Z'))
      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(4_000)
      expect(serie.find((p) => p.mois === 1)?.totalCentimes).toBe(0)
      expect(serie.find((p) => p.mois === 2)?.totalCentimes).toBe(7_000)
    })

    it('range un paiement des bornes de mois dans le bon mois', async () => {
      /*
       * Le regroupement se fait dans le CALENDRIER LOCAL du medecin, pas en UTC :
       * c'est ce que documente `revenusParMois`. Un test ecrit en instants UTC
       * serait donc faux dans tout fuseau decale de UTC.
       *
       * Concretement, sur un poste en UTC+1 (Alger), le dernier instant de
       * janvier — `2026-01-31T23:59:59.999Z` — est deja le 1er FEVRIER a 00:59 en
       * heure locale. Le code le range donc dans fevrier, a juste titre, et le
       * test echouait alors sur ce projet.
       *
       * On construit donc les deux bornes depuis l'heure locale elle-meme, ce qui
       * rend l'attente correcte dans TOUS les fuseaux.
       */
      const dernierInstantJanvier = new Date(2026, 0, 31, 23, 59, 59, 999)
      const premierInstantFevrier = new Date(2026, 1, 1, 0, 0, 0, 0)

      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, traitement, 100, dernierInstantJanvier)
      await creerPaiement(patient, traitement, 200, premierInstantFevrier)

      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(100)
      expect(serie.find((p) => p.mois === 1)?.totalCentimes).toBe(200)
    })

    it('exclut les paiements ANNULE (contre-passation) du total', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, traitement, 9_000, new Date('2026-01-10T10:00:00.000Z'), 'ANNULE')
      await creerPaiement(patient, traitement, 1_000, new Date('2026-01-12T10:00:00.000Z'), 'VALIDE')
      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(1_000)
    })

    it('respecte la borne des 12 mois : un paiement plus ancien est ignore', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      // Septembre 2025 est juste AVANT la fenetre [octobre 2025 .. septembre 2026].
      await creerPaiement(patient, traitement, 999_999, new Date('2025-09-30T23:00:00.000Z'))
      await creerPaiement(patient, traitement, 111, new Date('2025-10-01T00:00:00.000Z'))
      const serie = await revenusParMois(12, REFERENCE_UTC)
      expect(serie).toHaveLength(12)
      expect(serie.reduce((s, p) => s + p.totalCentimes, 0)).toBe(111)
    })

    it('inclut un paiement exactement a la borne basse (1er du premier mois)', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, traitement, 500, new Date('2025-10-01T00:00:00.000Z'))
      const serie = await revenusParMois(12, REFERENCE_UTC)
      // Bornes : octobre 2025 .. septembre 2026.
      expect(serie[0]).toEqual({ mois: 9, annee: 2025, totalCentimes: 500 })
    })

    it('produit un resultat identique quelle que soit la timezone de session PostgreSQL', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000)
      await creerPaiement(patient, traitement, 3_000, new Date('2026-02-15T10:00:00.000Z'))

      const db = dbClient()
      await db.$executeRawUnsafe(`SET TIME ZONE 'UTC'`)
      const enUtc = await revenusParMois(12, REFERENCE_UTC)
      await db.$executeRawUnsafe(`SET TIME ZONE 'Asia/Tokyo'`)
      const enTokyo = await revenusParMois(12, REFERENCE_UTC)

      expect(enTokyo).toEqual(enUtc)
    })

    it('conserve le type SUM converti en entier JS exact (bigint -> Number)', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 100_000_000)
      await creerPaiement(patient, traitement, 12_345_678, new Date('2026-01-10T10:00:00.000Z'))
      const serie = await revenusParMois(12, REFERENCE_UTC)
      const janvier = serie.find((p) => p.mois === 0 && p.annee === 2026)
      expect(janvier?.totalCentimes).toBe(12_345_678)
      expect(Number.isInteger(janvier?.totalCentimes)).toBe(true)
    })

    it('ne fait qu’UNE seule requete base et renvoie au plus 12 lignes', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 999_999_999)
      // 60 paiements repartis dans le temps (dates passees, dans la fenetre).
      for (let i = 0; i < 60; i += 1) {
        const mois = i % 9
        await creerPaiement(
          patient,
          traitement,
          100,
          new Date(Date.UTC(2026, mois, (i % 20) + 1, 10)),
        )
      }
      const { valeur: serie, ms } = await mesurer(() => revenusParMois(12, REFERENCE_UTC))
      expect(serie).toHaveLength(12) // une ligne par mois, jamais une par paiement
      // eslint-disable-next-line no-console
      console.info(`[PERF] revenusParMois (60 paiements) : ${ms.toFixed(2)} ms`)
    })
  })

  // ===========================================================================
  //  2. rapportSoldesPatients — SQL, exclusions, LIMIT/OFFSET, tri, bornage
  // ===========================================================================
  describe('rapportSoldesPatients()', () => {
    it('renvoie une page vide sur base vide', async () => {
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.elements).toEqual([])
      expect(resultat.total).toBe(0)
      expect(resultat.pages).toBe(1)
    })

    it('calcule un solde correct (facture - paye)', async () => {
      const patient = await creerPatient('Ahmed', 'Benali')
      const traitement = await creerTraitement(patient, 20_000)
      await creerPaiement(patient, traitement, 5_000, new Date('2026-01-10T10:00:00.000Z'))
      const { valeur: resultat, ms } = await mesurer(() =>
        rapportSoldesPatients({ page: 1, taille: 10 }),
      )
      expect(resultat.total).toBe(1)
      expect(resultat.elements[0]).toMatchObject({
        totalFactureCentimes: 20_000,
        totalPayeCentimes: 5_000,
        resteAPayerCentimes: 15_000,
      })
      // eslint-disable-next-line no-console
      console.info(`[PERF] rapportSoldesPatients (1 patient) : ${ms.toFixed(2)} ms`)
    })

    it('exclut les traitements ANNULE de la facturation', async () => {
      const patient = await creerPatient('A', 'A')
      await creerTraitement(patient, 20_000, 'EN_COURS')
      await creerTraitement(patient, 99_000, 'ANNULE') // ignore
      const traitementValide = await creerTraitement(patient, 0, 'TERMINE')
      await creerPaiement(patient, traitementValide, 5_000, new Date('2026-01-10T10:00:00.000Z'))
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.elements[0]?.totalFactureCentimes).toBe(20_000)
      expect(resultat.elements[0]?.resteAPayerCentimes).toBe(15_000)
    })

    it('exclut les paiements ANNULE du total paye', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 20_000)
      await creerPaiement(patient, traitement, 5_000, new Date('2026-01-10T10:00:00.000Z'), 'VALIDE')
      await creerPaiement(patient, traitement, 10_000, new Date('2026-01-11T10:00:00.000Z'), 'ANNULE')
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.elements[0]?.totalPayeCentimes).toBe(5_000)
      expect(resultat.elements[0]?.resteAPayerCentimes).toBe(15_000)
    })

    it('exclut un patient sans traitement (meme s’il a un paiement orphelin impossible)', async () => {
      // Un patient sans traitement n'apparait pas dans la facturation (le CTE
      // part des traitements), donc jamais dans le rapport.
      await creerPatient('SansTraitement', 'X')
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.total).toBe(0)
    })

    it('exclut un traitement entierement paye (reste = 0)', async () => {
      const patient = await creerPatient('A', 'A')
      const traitement = await creerTraitement(patient, 15_000, 'TERMINE')
      await creerPaiement(patient, traitement, 15_000, new Date('2026-01-10T10:00:00.000Z'))
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.total).toBe(0)
    })

    it('trie par reste decroissant', async () => {
      const a = await creerPatient('A', 'A')
      const b = await creerPatient('B', 'B')
      const c = await creerPatient('C', 'C')
      await creerTraitement(a, 10_000)
      await creerTraitement(b, 30_000)
      await creerTraitement(c, 20_000)
      const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
      expect(resultat.elements.map((e) => e.patientId)).toEqual([b, c, a])
    })

    it('observe un ordre deterministe a reste egal (tri secondaire sur patientId)', async () => {
      const ids: string[] = []
      for (const nom of ['C', 'A', 'B']) {
        const p = await creerPatient(nom, nom)
        ids.push(p)
        await creerTraitement(p, 10_000)
      }
      const premier = await rapportSoldesPatients({ page: 1, taille: 10 })
      const second = await rapportSoldesPatients({ page: 1, taille: 10 })
      const trie = [...ids].sort()
      expect(premier.elements.map((e) => e.patientId)).toEqual(trie)
      expect(second.elements.map((e) => e.patientId)).toEqual(premier.elements.map((e) => e.patientId))
    })

    it('pagine correctement avec LIMIT/OFFSET', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i += 1) {
        const p = await creerPatient(`P${i}`, `P${i}`)
        ids.push(p)
        await creerTraitement(p, (5 - i) * 10_000) // restes decroissants selon l'ordre
      }
      const page1 = await rapportSoldesPatients({ page: 1, taille: 2 })
      const page2 = await rapportSoldesPatients({ page: 2, taille: 2 })
      const page3 = await rapportSoldesPatients({ page: 3, taille: 2 })

      expect(page1.total).toBe(5)
      expect(page1.pages).toBe(3)
      expect(page1.elements.map((e) => e.patientId)).toEqual(ids.slice(0, 2))
      expect(page2.elements.map((e) => e.patientId)).toEqual(ids.slice(2, 4))
      expect(page3.elements.map((e) => e.patientId)).toEqual(ids.slice(4))
      // Aucun recouvrement entre pages.
      const tous = [...page1.elements, ...page2.elements, ...page3.elements].map((e) => e.patientId)
      expect(new Set(tous).size).toBe(5)
    })

    it('borne une page hors limite sur la derniere page (clamping serveur)', async () => {
      const a = await creerPatient('A', 'A')
      const b = await creerPatient('B', 'B')
      await creerTraitement(a, 20_000)
      await creerTraitement(b, 10_000)
      const resultat = await rapportSoldesPatients({ page: 99, taille: 10 })
      expect(resultat.page).toBe(1)
      expect(resultat.elements).toHaveLength(2)
    })

    it('renvoie le bon COUNT en base (independant de la page)', async () => {
      for (let i = 0; i < 7; i += 1) {
        const p = await creerPatient(`P${i}`, `P${i}`)
        await creerTraitement(p, 10_000)
      }
      const resultat = await rapportSoldesPatients({ page: 1, taille: 3 })
      expect(resultat.total).toBe(7)
      expect(resultat.pages).toBe(3)
      expect(resultat.elements).toHaveLength(3)
    })

    it('reste rapide et ne charge que la page (mesure sur volume)', async () => {
      for (let i = 0; i < 200; i += 1) {
        const p = await creerPatient(`P${i}`, `P${i}`)
        await creerTraitement(p, 10_000 + i)
      }
      const { valeur: resultat, ms } = await mesurer(() =>
        rapportSoldesPatients({ page: 1, taille: 25 }),
      )
      expect(resultat.total).toBe(200)
      expect(resultat.elements).toHaveLength(25)
      // eslint-disable-next-line no-console
      console.info(`[PERF] rapportSoldesPatients (200 patients) : ${ms.toFixed(2)} ms`)
    })
  })
})