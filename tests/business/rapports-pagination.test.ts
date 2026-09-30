import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * =============================================================================
 *  REGRESSION — REVENUS MENSUELS & SOLDES PATIENTS (§18, §27, §35)
 * =============================================================================
 *
 *  Ces tests verifient les DEUX requetes reecrites en Tier 2 :
 *
 *    1. `revenusParMois`  — agregation mensuelle desormais faite en base
 *       (`DATE_TRUNC('month', ...)` + `GROUP BY`) au lieu de charger tous les
 *       paiements dans Node et de les regrouper en JavaScript.
 *
 *    2. `rapportSoldesPatients` — filtrage des soldes positifs, tri et pagination
 *       desormais faits en base (`WHERE reste > 0`, `ORDER BY`, `LIMIT`/`OFFSET`)
 *       au lieu de charger tous les groupes et de decouper en memoire.
 *
 *  Aucune base PostgreSQL n'est disponible dans l'environnement de test. Le
 *  client Prisma est donc remplace par un double qui :
 *    - intercepte `$queryRaw` (requete etiquetee) et renvoie des lignes pilotees
 *      par le contenu SQL, ce qui permet de verifier QUE la logique a bien ete
 *      deplacee en base ;
 *    - expose `patient.findMany` pour les identites.
 *
 *  Le double reproduit FIDELEMENT la semantique SQL decrite (regroupement par
 *  mois, filtre des soldes, tri, pagination) afin de comparer le resultat obtenu
 *  a celui de l'ancienne implementation. L'objectif est de prouver l'EGALITE DU
 *  RESULTAT METIER, pas seulement l'absence d'erreur.
 */

// -----------------------------------------------------------------------------
//  JEU DE DONNEES PILOTE (en centimes)
// -----------------------------------------------------------------------------

interface Paiement {
  patientId: string
  datePaiement: Date
  montantCentimes: number
  statut: 'VALIDE' | 'ANNULE'
}

interface Traitement {
  patientId: string
  prixTotalCentimes: number
  statut: 'PLANIFIE' | 'EN_COURS' | 'TERMINE' | 'ANNULE'
}

let paiements: Paiement[] = []
let traitements: Traitement[] = []
let patients: Array<{ id: string; nom: string; prenom: string; telephone: string }> = []

/** Compresse un montant en bigint, comme le ferait une colonne SQL SUM(...)::bigint. */
const big = (valeur: number): bigint => BigInt(valeur)

/**
 * Reproduction EN JAVASCRIPT de la requete `revenusParMois` : regroupe les
 * paiements VALIDE posterieurs a `debut` par mois CALENDAIRE LOCAL.
 * Renvoie une ligne par mois present, exactement comme le `GROUP BY`.
 *
 * POURQUOI LE CALENDRIER LOCAL, ET NON UTC
 *
 *   La version precedente de ce double modelait un regroupement UTC, parce que
 *   la requete SQL groupait alors `DATE_TRUNC('month', "datePaiement")` sur la
 *   colonne TIMESTAMP naive (qui contient un instant UTC).
 *
 *   C'etait incoherent avec le reste de l'application : TOUTES les bornes de
 *   periode (`periodeAujourdhui`, `periodeMois`, `periodeAnnee`, la periode
 *   personnalisee des rapports) sont construites en HEURE LOCALE, parce que
 *   c'est le calendrier du medecin qui fait foi. Avec un serveur en UTC+1, un
 *   paiement encaisse a 00:30 heure locale le 1er du mois etait donc classe au
 *   mois PRECEDENT par le graphique, alors que le tableau de bord le comptait
 *   dans le mois courant : le meme argent apparaissait dans deux mois.
 *
 *   La requete reelle convertit desormais l'instant stocke vers l'heure locale
 *   avant de le tronquer au mois. Ce double doit donc modeliser la MEME regle,
 *   sinon il ne represente plus le code qu'il remplace.
 *
 * `debutNaif` est la CHAINE naive envoyee par le service (« YYYY-MM-DD HH:MM:SS »),
 * exprimee dans le calendrier LOCAL. La comparaison porte sur les composants
 * de date LOCAUX.
 */
function executerRevenusMensuels(debutNaif: string) {
  // La borne est une heure LOCALE : on la lit comme telle, sans suffixe `Z`.
  const debutMs = Date.parse(debutNaif.replace(' ', 'T'))
  const parMois = new Map<string, number>()
  for (const p of paiements) {
    if (p.statut !== 'VALIDE') continue
    if (p.datePaiement.getTime() < debutMs) continue
    const cle = `${p.datePaiement.getFullYear()}-${p.datePaiement.getMonth()}`
    parMois.set(cle, (parMois.get(cle) ?? 0) + p.montantCentimes)
  }
  return [...parMois.entries()]
    .map(([cle, total]) => {
      const [annee, mois] = cle.split('-').map(Number)
      return { annee: annee as number, mois: mois as number, total_centimes: big(total) }
    })
    .sort((a, b) => a.annee - b.annee || a.mois - b.mois)
}

/**
 * Reproduction EN JAVASCRIPT de l'ancienne implementation des soldes patients
 * (celle qui sera supprimee) : chargement de TOUS les groupes, calcul du reste,
 * filtre, tri, puis decoupage en memoire. Elle sert de reference d'egalite.
 */
function ancienneImplementationSoldes(page: number, taille: number) {
  const parPatient = new Map<string, { facture: number; paye: number }>()
  for (const t of traitements) {
    if (t.statut === 'ANNULE') continue
    const entree = parPatient.get(t.patientId) ?? { facture: 0, paye: 0 }
    entree.facture += t.prixTotalCentimes
    parPatient.set(t.patientId, entree)
  }
  for (const p of paiements) {
    if (p.statut !== 'VALIDE') continue
    const entree = parPatient.get(p.patientId)
    if (!entree) continue
    entree.paye += p.montantCentimes
  }

  const avecSolde = [...parPatient.entries()]
    .map(([patientId, { facture, paye }]) => ({ patientId, facture, paye, reste: facture - paye }))
    .filter((e) => e.reste > 0)
    .sort((a, b) => b.reste - a.reste)

  const total = avecSolde.length
  const pages = Math.max(1, Math.ceil(total / taille))
  const pageBornee = Math.min(Math.max(1, page), pages)
  const elements = avecSolde.slice((pageBornee - 1) * taille, pageBornee * taille)

  return { elements, total, page: pageBornee, taille, pages }
}

// -----------------------------------------------------------------------------
//  DOUBLE PRISMA
// -----------------------------------------------------------------------------

const fakePrisma = {
  patient: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      patients.filter((p) => where.id.in.includes(p.id)),
    ),
  },
  $queryRaw: vi.fn(async (morceaux: TemplateStringsArray, ..._valeurs: unknown[]) => {
    const sql = morceaux.join('?')

    // Requete de soldes : soit le COUNT, soit la page (LIMIT/OFFSET).
    if (sql.includes('WITH facturation AS')) {
      // Reconstitution des soldes a partir du jeu de donnees, comme le CTE SQL.
      const parPatient = new Map<string, { facture: number; paye: number }>()
      for (const t of traitements) {
        if (t.statut === 'ANNULE') continue
        const entree = parPatient.get(t.patientId) ?? { facture: 0, paye: 0 }
        entree.facture += t.prixTotalCentimes
        parPatient.set(t.patientId, entree)
      }
      for (const p of paiements) {
        if (p.statut !== 'VALIDE') continue
        const entree = parPatient.get(p.patientId)
        if (!entree) continue
        entree.paye += p.montantCentimes
      }
      const soldes = [...parPatient.entries()]
        .map(([patientId, { facture, paye }]) => ({
          patientId,
          facture,
          paye,
          reste: facture - paye,
        }))
        .filter((e) => e.reste > 0)
        .sort((a, b) => b.reste - a.reste || a.patientId.localeCompare(b.patientId))

      if (sql.includes('SELECT COUNT(*)')) {
        return [{ total: big(soldes.length) }]
      }

      // Les deux derniers parametres lies sont LIMIT puis OFFSET.
      const taille = Number(_valeurs[_valeurs.length - 2])
      const skip = Number(_valeurs[_valeurs.length - 1])
      return soldes.slice(skip, skip + taille).map((s) => ({
        patientId: s.patientId,
        facture: big(s.facture),
        paye: big(s.paye),
        reste: big(s.reste),
      }))
    }

    //
    // Requete de revenus mensuels.
    //
    // Le premier parametre lie est la borne basse, une chaine naive
    // « YYYY-MM-DD HH:MM:SS » exprimee dans le CALENDRIER LOCAL.
    //
    // Le motif de reconnaissance porte sur `AT TIME ZONE`, qui est la marque du
    // regroupement en heure locale introduit par le correctif : la requete
    // convertit l'instant stocke (UTC) vers le fuseau du serveur avant de le
    // tronquer au mois. S'appuyer sur cette sous-chaine, et non sur un alias
    // interne, evite que le double cesse de reconnaitre la requete si le SQL est
    // un jour reformate.
    //
    if (sql.includes('AT TIME ZONE')) {
      return executerRevenusMensuels(_valeurs[0] as string)
    }

    throw new Error(`Requete inattendue dans le double Prisma: ${sql}`)
  }),
}

vi.mock('@backend/database/prisma', () => ({ prisma: fakePrisma }))

/** Acces indexe typé sûr : leve si l'element est absent (echec de test explicite). */
function element<T>(liste: readonly T[], index: number): T {
  const valeur = liste[index]
  if (valeur === undefined) throw new Error(`Element ${index} absent (liste de ${liste.length}).`)
  return valeur
}

// Les imports viennent APRES l'enregistrement du mock.
const { revenusParMois } = await import('@backend/services/payments.service')
const { rapportSoldesPatients } = await import('@backend/services/reports.service')

beforeEach(() => {
  paiements = []
  traitements = []
  patients = []
  fakePrisma.$queryRaw.mockClear()
  fakePrisma.patient.findMany.mockClear()
})

/** Cree une identite patient minimale et l'ajoute au double. */
function ajouterPatient(id: string, nom = 'Nom', prenom = 'Prenom'): void {
  patients.push({ id, nom, prenom, telephone: '0555' })
}

// =============================================================================
//  1. REVENUS MENSUELS
// =============================================================================

describe('revenusParMois — agregation mensuelle en base', () => {
  /*
   * Reference construite en HEURE LOCALE : c'est le calendrier du medecin qui
   * borne les mois. La fenetre de 12 mois doit donc couvrir janvier..decembre
   * 2025, ce que les attentes ci-dessous supposent (elles cherchent le mois 0 de
   * 2025 comme premier point de la serie).
   *
   * Construite en `Date.UTC`, la reference tombait un 15 decembre mais la borne
   * basse glissait d'un mois selon le decalage horaire du poste, et la serie
   * commencait en decembre 2024 : les attentes ne decrivaient alors plus la
   * meme fenetre.
   */
  const REFERENCE = new Date(2025, 11, 15) // 15 decembre 2025, heure locale

  it('renvoie 12 mois a zero lorsqu’il n’y a aucun paiement', async () => {
    const serie = await revenusParMois(12, REFERENCE)

    expect(serie).toHaveLength(12)
    expect(serie.every((point) => point.totalCentimes === 0)).toBe(true)
    // Premier mois = janvier 2025 (decembre - 11 mois), dernier = decembre 2025.
    expect(serie[0]).toEqual({ mois: 0, annee: 2025, totalCentimes: 0 })
    expect(element(serie, 11)).toEqual({ mois: 11, annee: 2025, totalCentimes: 0 })
  })

  it('compte un paiement unique dans son mois', async () => {
    paiements = [
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 5, 10)), montantCentimes: 5_000, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    const juin = serie.find((p) => p.mois === 5 && p.annee === 2025)
    expect(juin?.totalCentimes).toBe(5_000)
    expect(serie.find((p) => p.mois === 4)?.totalCentimes).toBe(0)
  })

  it('additionne plusieurs paiements du meme mois', async () => {
    paiements = [
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 5, 1)), montantCentimes: 1_000, statut: 'VALIDE' },
      { patientId: 'p2', datePaiement: new Date(Date.UTC(2025, 5, 15)), montantCentimes: 2_000, statut: 'VALIDE' },
      { patientId: 'p3', datePaiement: new Date(Date.UTC(2025, 5, 30)), montantCentimes: 3_000, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie.find((p) => p.mois === 5)?.totalCentimes).toBe(6_000)
  })

  it('separe correctement des paiements de mois differents', async () => {
    paiements = [
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 4, 20)), montantCentimes: 4_000, statut: 'VALIDE' },
      { patientId: 'p2', datePaiement: new Date(Date.UTC(2025, 6, 5)), montantCentimes: 7_000, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie.find((p) => p.mois === 4)?.totalCentimes).toBe(4_000)
    expect(serie.find((p) => p.mois === 6)?.totalCentimes).toBe(7_000)
    expect(serie.find((p) => p.mois === 5)?.totalCentimes).toBe(0)
  })

  it('exclut un paiement ANNULE (contre-passation)', async () => {
    paiements = [
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 5, 10)), montantCentimes: 9_000, statut: 'ANNULE' },
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 5, 12)), montantCentimes: 1_000, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie.find((p) => p.mois === 5)?.totalCentimes).toBe(1_000)
  })

  it('ne recompte pas un paiement corrige : l’annule disparait, la contre-passation valide compte', async () => {
    // Correction de montant : l'original est ANNULE, un nouveau VALIDE est cree.
    paiements = [
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 2, 3)), montantCentimes: 8_000, statut: 'ANNULE' },
      { patientId: 'p1', datePaiement: new Date(Date.UTC(2025, 2, 3)), montantCentimes: 6_500, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie.find((p) => p.mois === 2)?.totalCentimes).toBe(6_500)
  })

  it('range un paiement de debut et de fin de mois dans le bon mois (bornes)', async () => {
    paiements = [
      // Dernier instant de janvier et premier instant de fevrier, en HEURE
      // LOCALE : c'est le calendrier du medecin qui borne les mois.
      { patientId: 'p1', datePaiement: new Date(2025, 0, 31, 23, 59, 59), montantCentimes: 100, statut: 'VALIDE' },
      { patientId: 'p2', datePaiement: new Date(2025, 1, 1, 0, 0, 0), montantCentimes: 200, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(100)
    expect(serie.find((p) => p.mois === 1)?.totalCentimes).toBe(200)
  })

  it('range un encaissement de 00:30 locale dans le mois LOCAL, pas le mois UTC precedent', async () => {
    /*
     * C'est le scenario EXACT du defaut corrige.
     *
     * Un paiement encaisse a 00:30 heure locale le 1er fevrier porte l'instant
     * UTC 31 janvier 23:30. Un regroupement en UTC le classait donc en JANVIER,
     * alors que le tableau de bord (bornes locales) le comptait en FEVRIER.
     *
     * La construction est volontairement LOCALE pour que le test exprime
     * l'intention metier (« un encaissement du 1er fevrier ») et reste vrai
     * quelle que soit la timezone du poste qui execute la suite.
     */
    paiements = [
      { patientId: 'p1', datePaiement: new Date(2025, 1, 1, 0, 30, 0), montantCentimes: 1_234, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)

    // Il doit etre en fevrier (mois 1) et SURTOUT pas en janvier (mois 0).
    expect(serie.find((p) => p.mois === 1)?.totalCentimes).toBe(1_234)
    expect(serie.find((p) => p.mois === 0)?.totalCentimes).toBe(0)
  })

  it('respecte la borne des 12 mois : un paiement plus ancien est ignore', async () => {
    paiements = [
      // Decembre 2024 est juste AVANT la fenetre de 12 mois (janvier..decembre 2025).
      // Instants construits en HEURE LOCALE, comme les bornes de la periode.
      { patientId: 'p1', datePaiement: new Date(2024, 11, 31), montantCentimes: 999_999, statut: 'VALIDE' },
      { patientId: 'p1', datePaiement: new Date(2025, 0, 1), montantCentimes: 111, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(serie).toHaveLength(12)
    expect(serie[0]).toEqual({ mois: 0, annee: 2025, totalCentimes: 111 })
    const somme = serie.reduce((s, p) => s + p.totalCentimes, 0)
    expect(somme).toBe(111) // Le paiement de 2024 n'est pas compte.
  })

  it('inclut un paiement exactement a la borne basse (1er du premier mois)', async () => {
    paiements = [
      { patientId: 'p1', datePaiement: new Date(2025, 0, 1, 0, 0, 0), montantCentimes: 500, statut: 'VALIDE' },
    ]
    const serie = await revenusParMois(12, REFERENCE)
    expect(element(serie, 0).totalCentimes).toBe(500)
  })

  it('n’ouvre qu’UNE seule ligne par mois en base (pas de chargement ligne a ligne)', async () => {
    paiements = Array.from({ length: 50 }, (_, index) => ({
      patientId: `p${index}`,
      datePaiement: new Date(2025, 5, (index % 28) + 1),
      montantCentimes: 100,
      statut: 'VALIDE' as const,
    }))
    await revenusParMois(12, REFERENCE)

    // Une seule requete brute, et aucune lecture de paiement ligne a ligne.
    expect(fakePrisma.$queryRaw).toHaveBeenCalledTimes(1)
    const sqlAppele = fakePrisma.$queryRaw.mock.calls[0]?.[0].join('?') ?? ''
    // Le regroupement reste fait EN BASE (aucun paiement rapatrie dans Node).
    expect(sqlAppele).toContain("DATE_TRUNC")
    expect(sqlAppele).toContain("'month'")
    expect(sqlAppele).toContain('GROUP BY')
    // Le regroupement se fait au calendrier LOCAL (voir le commentaire de la
    // requete) : c'est cette conversion qui aligne le graphique sur le tableau
    // de bord. Sans elle, les deux ecrans rangent un meme paiement dans deux
    // mois differents.
    expect(sqlAppele).toContain('AT TIME ZONE')
    expect(sqlAppele).not.toContain('findMany')
  })

  it('transmet la borne de date comme chaine naive LOCALE (aucune concatenation SQL)', async () => {
    await revenusParMois(12, REFERENCE)
    const valeurs = fakePrisma.$queryRaw.mock.calls[0]?.slice(1) ?? []
    expect(valeurs).toHaveLength(1)
    // La borne est un parametre LIE (jamais concatene). C'est une chaine naive
    // coherente avec la colonne TIMESTAMP : le service la castera en ::timestamp
    // cote SQL, ce qui rend la comparaison independante de la timezone de
    // session. Elle est exprimee dans le calendrier LOCAL, comme les bornes de
    // periode utilisees partout ailleurs.
    expect(typeof valeurs[0]).toBe('string')
    expect(valeurs[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // La borne basse correspond au 1er janvier local de l'annee de reference.
    expect(valeurs[0]).toMatch(/^\d{4}-01-01 00:00:00$/)
  })
})

// =============================================================================
//  2. SOLDES PATIENTS
// =============================================================================

describe('rapportSoldesPatients — pagination et tri en base', () => {
  it('renvoie une page vide quand aucun patient n’a de solde', async () => {
    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.elements).toEqual([])
    expect(resultat.total).toBe(0)
    expect(resultat.pages).toBe(1)
  })

  it('renvoie un seul patient et son solde', async () => {
    ajouterPatient('a', 'Ahmed', 'Benali')
    traitements = [{ patientId: 'a', prixTotalCentimes: 20_000, statut: 'EN_COURS' }]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 5_000, statut: 'VALIDE' },
    ]

    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.total).toBe(1)
    expect(resultat.elements[0]).toMatchObject({ patientId: 'a', totalFactureCentimes: 20_000, totalPayeCentimes: 5_000, resteAPayerCentimes: 15_000 })
  })

  it('trie par reste decroissant et gere plusieurs patients', async () => {
    ajouterPatient('a', 'A', 'A')
    ajouterPatient('b', 'B', 'B')
    ajouterPatient('c', 'C', 'C')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 10_000, statut: 'TERMINE' },
      { patientId: 'b', prixTotalCentimes: 30_000, statut: 'EN_COURS' },
      { patientId: 'c', prixTotalCentimes: 20_000, statut: 'PLANIFIE' },
    ]

    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.total).toBe(3)
    expect(resultat.elements.map((e) => e.patientId)).toEqual(['b', 'c', 'a'])
  })

  it('additionne plusieurs traitements et plusieurs paiements par patient', async () => {
    ajouterPatient('a', 'A', 'A')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 20_000, statut: 'EN_COURS' },
      { patientId: 'a', prixTotalCentimes: 15_000, statut: 'TERMINE' },
    ]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 10_000, statut: 'VALIDE' },
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 1, 1)), montantCentimes: 5_000, statut: 'VALIDE' },
    ]

    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.elements[0]).toMatchObject({
      totalFactureCentimes: 35_000,
      totalPayeCentimes: 15_000,
      resteAPayerCentimes: 20_000,
    })
  })

  it('gere un traitement partiellement paye (reste > 0, present)', async () => {
    ajouterPatient('a', 'A', 'A')
    traitements = [{ patientId: 'a', prixTotalCentimes: 15_000, statut: 'EN_COURS' }]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 5_000, statut: 'VALIDE' },
    ]
    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.total).toBe(1)
    expect(element(resultat.elements, 0).resteAPayerCentimes).toBe(10_000)
  })

  it('exclut un traitement entierement paye (reste = 0)', async () => {
    ajouterPatient('a', 'A', 'A')
    traitements = [{ patientId: 'a', prixTotalCentimes: 15_000, statut: 'TERMINE' }]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 15_000, statut: 'VALIDE' },
    ]
    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.total).toBe(0)
  })

  it('ignore un traitement ANNULE et exclut un paiement ANNULE du total paye', async () => {
    ajouterPatient('a', 'A', 'A')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 20_000, statut: 'EN_COURS' },
      { patientId: 'a', prixTotalCentimes: 99_000, statut: 'ANNULE' }, // ignore
    ]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 5_000, statut: 'VALIDE' },
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 2)), montantCentimes: 50_000, statut: 'ANNULE' }, // ignore
    ]
    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.elements[0]).toMatchObject({
      totalFactureCentimes: 20_000,
      totalPayeCentimes: 5_000,
      resteAPayerCentimes: 15_000,
    })
  })

  it('n’expose pas un patient sans traitement (meme s’il a des paiements)', async () => {
    // Cas limite : paiement orphelin sans traitement (ne devrait pas arriver,
    // la FK l’interdit, mais l’ancienne implementation partait des traitements).
    ajouterPatient('a', 'A', 'A')
    traitements = []
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 5_000, statut: 'VALIDE' },
    ]
    const resultat = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(resultat.total).toBe(0)
  })

  it('pagine : page 1, page 2 et derniere page coherentes', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) ajouterPatient(id, id.toUpperCase(), 'X')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 50_000, statut: 'EN_COURS' },
      { patientId: 'b', prixTotalCentimes: 40_000, statut: 'EN_COURS' },
      { patientId: 'c', prixTotalCentimes: 30_000, statut: 'EN_COURS' },
      { patientId: 'd', prixTotalCentimes: 20_000, statut: 'EN_COURS' },
      { patientId: 'e', prixTotalCentimes: 10_000, statut: 'EN_COURS' },
    ]

    const page1 = await rapportSoldesPatients({ page: 1, taille: 2 })
    const page2 = await rapportSoldesPatients({ page: 2, taille: 2 })
    const page3 = await rapportSoldesPatients({ page: 3, taille: 2 })

    expect(page1.total).toBe(5)
    expect(page1.pages).toBe(3)
    expect(page1.elements.map((e) => e.patientId)).toEqual(['a', 'b'])
    expect(page2.elements.map((e) => e.patientId)).toEqual(['c', 'd'])
    expect(page3.elements.map((e) => e.patientId)).toEqual(['e'])
  })

  it('borne une page hors limite sur la derniere page (comme avant)', async () => {
    for (const id of ['a', 'b']) ajouterPatient(id, id.toUpperCase(), 'X')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 20_000, statut: 'EN_COURS' },
      { patientId: 'b', prixTotalCentimes: 10_000, statut: 'EN_COURS' },
    ]
    const resultat = await rapportSoldesPatients({ page: 99, taille: 10 })
    expect(resultat.page).toBe(1)
    expect(resultat.elements).toHaveLength(2)
  })

  it('produit un ordre deterministe quand plusieurs patients ont le meme reste', async () => {
    // Trois patients au reste identique : l'ordre secondaire sur l'identifiant
    // garantit un resultat stable entre deux appels.
    for (const id of ['c', 'a', 'b']) ajouterPatient(id, id.toUpperCase(), 'X')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 10_000, statut: 'EN_COURS' },
      { patientId: 'b', prixTotalCentimes: 10_000, statut: 'EN_COURS' },
      { patientId: 'c', prixTotalCentimes: 10_000, statut: 'EN_COURS' },
    ]
    const premier = await rapportSoldesPatients({ page: 1, taille: 10 })
    const second = await rapportSoldesPatients({ page: 1, taille: 10 })
    expect(premier.elements.map((e) => e.patientId)).toEqual(['a', 'b', 'c'])
    expect(second.elements.map((e) => e.patientId)).toEqual(premier.elements.map((e) => e.patientId))
  })

  it('charge en base UNIQUEMENT la page demandee (LIMIT/OFFSET, pas tout le dataset)', async () => {
    for (const id of Array.from({ length: 25 }, (_, index) => `pat-${index}`)) {
      ajouterPatient(id, id, 'X')
      traitements.push({ patientId: id, prixTotalCentimes: 10_000, statut: 'EN_COURS' })
    }

    const resultat = await rapportSoldesPatients({ page: 2, taille: 10 })
    expect(resultat.total).toBe(25)
    expect(resultat.elements).toHaveLength(10)

    // La requete de page contient bien LIMIT et OFFSET, et les valeurs liees
    // correspondent a la page 2 / taille 10 -> OFFSET 10.
    const appelPage = fakePrisma.$queryRaw.mock.calls.find(
      (appel) => appel[0].join('?').includes('LIMIT'),
    )
    expect(appelPage).toBeDefined()
    const sqlPage = appelPage?.[0].join('?') ?? ''
    expect(sqlPage).toContain('ORDER BY reste DESC')
    expect(sqlPage).toContain('WHERE reste > 0')
    const valeurs = appelPage?.slice(1) ?? []
    expect(Number(valeurs[valeurs.length - 1])).toBe(10) // OFFSET
    expect(Number(valeurs[valeurs.length - 2])).toBe(10) // LIMIT
  })

  it('renvoie le meme resultat metier que l’ancienne implementation (test de reference)', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) ajouterPatient(id, id.toUpperCase(), 'X')
    traitements = [
      { patientId: 'a', prixTotalCentimes: 100_000, statut: 'EN_COURS' },
      { patientId: 'a', prixTotalCentimes: 50_000, statut: 'TERMINE' },
      { patientId: 'b', prixTotalCentimes: 80_000, statut: 'EN_COURS' },
      { patientId: 'c', prixTotalCentimes: 80_000, statut: 'EN_COURS' }, // meme reste que b
      { patientId: 'd', prixTotalCentimes: 40_000, statut: 'ANNULE' }, // ignore
      { patientId: 'e', prixTotalCentimes: 30_000, statut: 'EN_COURS' },
      { patientId: 'f', prixTotalCentimes: 10_000, statut: 'TERMINE' }, // sera solde
    ]
    paiements = [
      { patientId: 'a', datePaiement: new Date(Date.UTC(2025, 0, 1)), montantCentimes: 30_000, statut: 'VALIDE' },
      { patientId: 'b', datePaiement: new Date(Date.UTC(2025, 0, 2)), montantCentimes: 10_000, statut: 'VALIDE' },
      { patientId: 'e', datePaiement: new Date(Date.UTC(2025, 0, 3)), montantCentimes: 1_000, statut: 'ANNULE' }, // ignore
      { patientId: 'f', datePaiement: new Date(Date.UTC(2025, 0, 4)), montantCentimes: 10_000, statut: 'VALIDE' }, // solde f
    ]

    for (const page of [1, 2, 3]) {
      const attendu = ancienneImplementationSoldes(page, 2)
      const obtenu = await rapportSoldesPatients({ page, taille: 2 })
      expect(obtenu.total).toBe(attendu.total)
      expect(obtenu.pages).toBe(attendu.pages)
      expect(obtenu.page).toBe(attendu.page)
      expect(obtenu.elements.map((e) => ({
        patientId: e.patientId,
        facture: e.totalFactureCentimes,
        paye: e.totalPayeCentimes,
        reste: e.resteAPayerCentimes,
      }))).toEqual(
        attendu.elements.map((e) => ({
          patientId: e.patientId,
          facture: e.facture,
          paye: e.paye,
          reste: e.reste,
        })),
      )
    }
  })
})
