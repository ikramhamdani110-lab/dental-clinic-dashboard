import { prisma } from '@backend/database/prisma'
import {
  FILTRE_RENDEZ_VOUS_PLANIFIES,
  MARQUEUR_SANS_RENDEZ_VOUS,
  motifConsultationDe,
} from '@backend/services/appointments.service'
import { presencesDuJour } from '@backend/services/dashboard-metrics'
import {
  revenusParAnnee,
  revenusParMethode,
  revenusParPeriode,
  totalEncaisse,
  totalRestantARecevoir,
} from '@backend/services/payments.service'

/**
 * =============================================================================
 *  SERVICE RAPPORTS (§27)
 * =============================================================================
 *
 *  Tous les rapports sont produits par des AGREGATIONS EN BASE. Aucun rapport
 *  ne telecharge l'ensemble des lignes pour calculer un total dans l'application
 *  (§18, §35).
 *
 *  AUCUN PDF N'EST GENERE (§45, §27). Les rapports sont consultables a l'ecran
 *  et exportables en CSV par le navigateur, ce qui n'est pas une generation de
 *  document cote serveur.
 */

export interface Periode {
  debut: Date
  fin: Date
}

/** Periodes predefinies (§27) : aujourd'hui, cette semaine, ce mois. */
export function periodeAujourdhui(reference: Date = new Date()): Periode {
  const debut = new Date(reference)
  debut.setHours(0, 0, 0, 0)
  const fin = new Date(reference)
  fin.setHours(23, 59, 59, 999)
  return { debut, fin }
}

export function periodeSemaine(reference: Date = new Date()): Periode {
  const debut = new Date(reference)
  // Semaine commencant le lundi (usage courant en Algerie).
  const jour = debut.getDay()
  const decalage = jour === 0 ? 6 : jour - 1
  debut.setDate(debut.getDate() - decalage)
  debut.setHours(0, 0, 0, 0)
  const fin = new Date(debut)
  fin.setDate(fin.getDate() + 6)
  fin.setHours(23, 59, 59, 999)
  return { debut, fin }
}

export function periodeMois(reference: Date = new Date()): Periode {
  const debut = new Date(reference.getFullYear(), reference.getMonth(), 1, 0, 0)
  const fin = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999)
  return { debut, fin }
}

/**
 * Periode glissante de N jours se terminant aujourd'hui (§27).
 *
 * La borne basse inclut le jour courant : « 7 jours » couvre aujourd'hui et les
 * six jours precedents, soit exactement sept journees civiles.
 */
export function periodeDerniersJours(nombreJours: number, reference: Date = new Date()): Periode {
  const fin = new Date(reference)
  fin.setHours(23, 59, 59, 999)
  const debut = new Date(reference)
  debut.setDate(debut.getDate() - (nombreJours - 1))
  debut.setHours(0, 0, 0, 0)
  return { debut, fin }
}

/** Annee civile complete (1er janvier -> 31 decembre), (§27). */
export function periodeAnnee(annee: number): Periode {
  return {
    debut: new Date(annee, 0, 1, 0, 0),
    fin: new Date(annee, 11, 31, 23, 59, 59, 999),
  }
}

export interface RapportRevenus {
  periode: { debut: string; fin: string }
  totalEncaisseCentimes: number
  nombrePaiements: number
  parMethode: Array<{ methode: string; totalCentimes: number }>
}

/** Rapport de revenus sur une periode (§27). */
export async function rapportRevenus(periode: Periode): Promise<RapportRevenus> {
  const [total, nombre, parMethode] = await Promise.all([
    totalEncaisse(periode.debut, periode.fin),
    prisma.payment.count({
      where: { statut: 'VALIDE', datePaiement: { gte: periode.debut, lte: periode.fin } },
    }),
    revenusParMethode(periode.debut, periode.fin),
  ])

  return {
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    totalEncaisseCentimes: total,
    nombrePaiements: nombre,
    parMethode: parMethode.map((entree) => ({
      methode: entree.methode,
      totalCentimes: entree.totalCentimes,
    })),
  }
}

export interface RapportSyntheseFinanciere {
  periode: { debut: string; fin: string }
  /** Somme des paiements VALIDE de la periode (les ANNULE sont exclus). */
  totalRevenusCentimes: number
  /** Nombre de transactions de paiement VALIDE de la periode. */
  nombrePaiements: number
  /** Montant restant a recevoir sur l'ensemble des traitements non annules. */
  montantRestantCentimes: number
  /**
   * Revenus du MOIS DE REFERENCE, c'est-a-dire du mois qui contient la fin de la
   * periode selectionnee — et non du mois calendaire courant.
   *
   * C'est ce qui rend l'indicateur coherent avec le filtre : choisir « annee
   * precedente » doit parler de l'annee precedente, pas du mois en cours.
   */
  revenusMoisCentimes: number
  /** Revenus du mois COMPLET precedent celui de reference, et son libelle. */
  revenusMoisPrecedentCentimes: number
  moisPrecedent: { annee: number; mois: number }
  /** Evolution en pourcentage, ou `null` si la comparaison n'est pas pertinente. */
  variationPourcent: number | null
  /** Faux tant que le mois precedent n'a pas de revenu : aucune comparaison trompeuse. */
  comparaisonDisponible: boolean
}

/**
 * SYNTHESE FINANCIERE DE LA CLINIQUE (§27).
 *
 * Les quatre indicateurs proviennent d'AGREGATIONS EN BASE : aucune liste de
 * paiements n'est chargee dans Node pour calculer un total (§18, §35).
 *
 * MOIS DE REFERENCE — POURQUOI LA FIN DE PERIODE, ET NON « AUJOURD'HUI »
 *
 *   Une version precedente ancrait les revenus du mois et la comparaison sur la
 *   date du jour (`new Date()`). Le filtre de periode n'avait alors AUCUN effet
 *   sur ces deux valeurs : selectionner « annee precedente » continuait
afficher
 *   les revenus du mois en cours, ce qui donnait un rapport incoherent.
 *
 *   Le mois de reference est desormais celui qui CONTIENT LA FIN DE LA PERIODE
 *   selectionnee. Consequence : pour « 30 jours », « cette annee » ou une periode
 *   personnalisee, les revenus du mois decrivent la fin de la fenetre etudiee, et
 *   la comparaison porte sur le mois calendaire precedent cette fin.
 *
 *   Le mois precedent n'est CALCULE QUE s'il a genere des revenus : sans
 *   reference, un pourcentage d'evolution serait trompeur (division par zero, ou
 *   hausse illusoire). L'interface s'appuie sur `comparaisonDisponible`.
 */
export async function rapportSyntheseFinanciere(periode: Periode): Promise<RapportSyntheseFinanciere> {
  /*
   * Le mois de reference est celui de la FIN de la periode : c'est le mois que
   * le medecin regarde quand il lit « Revenus du mois ».
   */
  const reference = periode.fin
  const moisReference = periodeMois(reference)
  const moisPrecedentDebut = new Date(
    reference.getFullYear(),
    reference.getMonth() - 1,
    1,
    0,
    0,
    0,
    0,
  )
  const moisPrecedentFin = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    0,
    23,
    59,
    59,
    999,
  )

  const [totalRevenus, nombre, montantRestant, revenusMois, revenusMoisPrecedent] =
    await Promise.all([
      totalEncaisse(periode.debut, periode.fin),
      prisma.payment.count({
        where: { statut: 'VALIDE', datePaiement: { gte: periode.debut, lte: periode.fin } },
      }),
      totalRestantARecevoir(),
      totalEncaisse(moisReference.debut, moisReference.fin),
      totalEncaisse(moisPrecedentDebut, moisPrecedentFin),
    ])

  const comparaisonDisponible = revenusMoisPrecedent > 0
  const variationPourcent = comparaisonDisponible
    ? ((revenusMois - revenusMoisPrecedent) / revenusMoisPrecedent) * 100
    : null

  return {
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    totalRevenusCentimes: totalRevenus,
    nombrePaiements: nombre,
    montantRestantCentimes: montantRestant,
    revenusMoisCentimes: revenusMois,
    revenusMoisPrecedentCentimes: revenusMoisPrecedent,
    moisPrecedent: {
      annee: moisPrecedentDebut.getFullYear(),
      mois: moisPrecedentDebut.getMonth(),
    },
    variationPourcent,
    comparaisonDisponible,
  }
}

/** Liste des annees possedant au moins un paiement VALIDE (menu Annee du graphique). */
export async function anneesAvecRevenus(reference: Date = new Date()): Promise<number[]> {
  const lignes = await prisma.$queryRaw<Array<{ annee: number }>>`
    SELECT DISTINCT EXTRACT(YEAR FROM "datePaiement")::int AS annee
    FROM "payments"
    WHERE "statut" = 'VALIDE'::"StatutPaiement"
    ORDER BY annee DESC
  `

  const annees = lignes.map((ligne) => Number(ligne.annee))
  const anneeCourante = reference.getFullYear()
  // L'annee courante figure TOUJOURS dans le menu, meme sans paiement encore
  // enregistre : le medecin doit pouvoir consulter l'annee en cours.
  if (!annees.includes(anneeCourante)) annees.unshift(anneeCourante)
  return annees
}

/**
 * EVOLUTION DES REVENUS (§27).
 *
 * DEUX MODES, SELON CE QUE LE MEDECIN A CHOISI
 *
 *   - `annee` fourni : la courbe decrit les 12 mois de cette ANNEE CIVILE. C'est
 *     le mode du menu « Annee », qui reste disponible pour comparer deux annees.
 *
 *   - `periode` fourni : la courbe decrit EXACTEMENT la fenetre selectionnee par
 *     le filtre de periode (7 jours, 30 jours, cette annee, annee precedente ou
 *     plage personnalisee). La granularite s'adapte a l'etendue : un point par
 *     jour pour une fenetre courte, un point par mois au-dela.
 *
 *   Sans ce second mode, le graphique restait figE sur l'annee du menu et ne
 *   suivait PAS le filtre : c'etait la cause principale du rapport qui « ne
 *   changeait pas » quand on choisissait une autre periode.
 *
 * Toutes les valeurs proviennent des PAIEMENTS REELS agreges en base (§16) :
 * jamais des prix de traitements, jamais de valeur inventee.
 */
export async function rapportEvolutionRevenus(
  options: { annee: number } | { periode: Periode },
): Promise<{
  annee: number | null
  granularite: 'jour' | 'mois'
  periode: { debut: string; fin: string } | null
  totalCentimes: number
  points: Array<{ mois: number; annee: number; jour: number | null; totalCentimes: number }>
}> {
  // ── Mode « annee civile » : 12 points, un par mois ────────────────────────
  if ('annee' in options) {
    const { annee } = options
    const points = (await revenusParAnnee(annee)).map((point) => ({ ...point, jour: null }))

    return {
      annee,
      granularite: 'mois',
      periode: null,
      totalCentimes: points.reduce((somme, point) => somme + point.totalCentimes, 0),
      points,
    }
  }

  // ── Mode « periode selectionnee » : la courbe suit le filtre ─────────────
  const { periode } = options
  const { granularite, points } = await revenusParPeriode(periode.debut, periode.fin)

  return {
    annee: null,
    granularite,
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    totalCentimes: points.reduce((somme, point) => somme + point.totalCentimes, 0),
    points,
  }
}

export interface RapportTraitements {
  totalTraitements: number
  parStatut: Record<string, number>
  totalFactureCentimes: number
  totalRestantCentimes: number
}

/** Rapport sur les traitements : volumes et montants (§27). */
export async function rapportTraitements(periode: Periode): Promise<RapportTraitements> {
  const where = { createdAt: { gte: periode.debut, lte: periode.fin } }

  const [total, parStatut, totalFacture, totalPaye] = await Promise.all([
    prisma.treatment.count({ where }),
    prisma.treatment.groupBy({
      by: ['statut'],
      where,
      _count: { _all: true },
    }),
    prisma.treatment.aggregate({
      where: { ...where, statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
    }),
    prisma.payment.aggregate({
      where: { statut: 'VALIDE', datePaiement: { gte: periode.debut, lte: periode.fin } },
      _sum: { montantCentimes: true },
    }),
  ])

  const totauxParStatut: Record<string, number> = {}
  for (const groupe of parStatut) {
    totauxParStatut[groupe.statut] = groupe._count._all
  }

  const totalFactureCentimes = totalFacture._sum.prixTotalCentimes ?? 0
  const totalPayeCentimes = totalPaye._sum.montantCentimes ?? 0

  return {
    totalTraitements: total,
    parStatut: totauxParStatut,
    totalFactureCentimes,
    totalRestantCentimes: Math.max(0, totalFactureCentimes - totalPayeCentimes),
  }
}

export interface LigneSoldePatient {
  patientId: string
  nom: string
  prenom: string
  telephone: string
  totalFactureCentimes: number
  totalPayeCentimes: number
  resteAPayerCentimes: number
}

/**
 * Soldes patients : patients presentant un montant restant a recevoir (§27).
 *
 * Le calcul (facture - paye), le filtre des soldes positifs, le tri et la
 * pagination sont entierement realises EN BASE. Node ne charge que les lignes
 * de la page demandee, jamais l'ensemble des patients (§35).
 */
export async function rapportSoldesPatients(params: { page: number; taille: number }): Promise<{
  elements: LigneSoldePatient[]
  total: number
  page: number
  taille: number
  pages: number
}> {
  // ---------------------------------------------------------------------------
  //  FILTRAGE, TRI ET PAGINATION EN BASE
  // ---------------------------------------------------------------------------
  //
  //  AVANT : la base renvoyait TOUS les groupes (un par patient ayant des
  //  traitements) et TOUS les groupes de paiements ; Node appliquait ensuite
  //  filtre, tri et decoupage (`slice`) en memoire. Le volume charge grandissait
  //  donc avec le nombre de patients de la clinique, alors que l'interface
  //  n'affiche qu'une page (§35).
  //
  //  APRES : la jointure, le calcul du reste, le filtre `reste > 0`, le tri et
  //  la pagination sont exécutés par PostgreSQL. Node ne recoit QUE les lignes
  //  de la page demandee.
  //
  //  SEMANTIQUE STRICTEMENT CONSERVEE :
  //    - ensemble de depart = patients possedant au moins un traitement non
  //      ANNULE (les patients sans traitement n'apparaissent pas, comme avant) ;
  //    - facture = somme des prix des traitements non ANNULE ;
  //    - paye    = somme des paiements VALIDE (les paiements ANNULE/inexistants
  //      comptent pour 0 grâce au LEFT JOIN et au COALESCE) ;
  //    - reste   = facture - paye ;
  //    - seuls les patients a reste > 0 sont renvoyes ;
  //    - tri par reste decroissant, avec un tri secondaire deterministe sur
  //      l'identifiant patient pour stabiliser les ex aequo.
  //
  //  Toutes les valeurs sont liees (`${...}`) : aucune concatenation SQL.
  const totalLignes = await prisma.$queryRaw<Array<{ total: bigint }>>`
    WITH facturation AS (
      SELECT "patientId", SUM("prixTotalCentimes")::bigint AS facture
      FROM "treatments"
      WHERE "statut" <> 'ANNULE'::"StatutTraitement"
      GROUP BY "patientId"
    ),
    encaissement AS (
      SELECT "patientId", SUM("montantCentimes")::bigint AS paye
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
      GROUP BY "patientId"
    ),
    soldes AS (
      SELECT
        f."patientId" AS "patientId",
        f.facture AS facture,
        COALESCE(e.paye, 0)::bigint AS paye,
        (f.facture - COALESCE(e.paye, 0))::bigint AS reste
      FROM facturation f
      LEFT JOIN encaissement e ON e."patientId" = f."patientId"
    )
    SELECT COUNT(*)::bigint AS total
    FROM soldes
    WHERE reste > 0
  `

  const total = Number(totalLignes[0]?.total ?? 0n)
  const pages = Math.max(1, Math.ceil(total / params.taille))
  // Le numero de page est borne a l'intervalle [1, pages], exactement comme
  // l'implementation precedente (une page hors bornes retombe sur la derniere).
  const page = Math.min(Math.max(1, params.page), pages)
  const skip = (page - 1) * params.taille

  const lignesPage = await prisma.$queryRaw<
    Array<{ patientId: string; facture: bigint; paye: bigint; reste: bigint }>
  >`
    WITH facturation AS (
      SELECT "patientId", SUM("prixTotalCentimes")::bigint AS facture
      FROM "treatments"
      WHERE "statut" <> 'ANNULE'::"StatutTraitement"
      GROUP BY "patientId"
    ),
    encaissement AS (
      SELECT "patientId", SUM("montantCentimes")::bigint AS paye
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
      GROUP BY "patientId"
    ),
    soldes AS (
      SELECT
        f."patientId" AS "patientId",
        f.facture AS facture,
        COALESCE(e.paye, 0)::bigint AS paye,
        (f.facture - COALESCE(e.paye, 0))::bigint AS reste
      FROM facturation f
      LEFT JOIN encaissement e ON e."patientId" = f."patientId"
    )
    SELECT "patientId", facture, paye, reste
    FROM soldes
    WHERE reste > 0
    ORDER BY reste DESC, "patientId" ASC
    LIMIT ${params.taille} OFFSET ${skip}
  `

  // Chargement des identites uniquement pour la page demandee.
  const patients = await prisma.patient.findMany({
    where: { id: { in: lignesPage.map((ligne) => ligne.patientId) } },
    select: { id: true, nom: true, prenom: true, telephone: true },
  })
  const patientsMap = new Map(patients.map((patient) => [patient.id, patient]))

  const elements: LigneSoldePatient[] = lignesPage.flatMap((ligne) => {
    const patient = patientsMap.get(ligne.patientId)
    if (!patient) return []
    return [
      {
        patientId: patient.id,
        nom: patient.nom,
        prenom: patient.prenom,
        telephone: patient.telephone,
        totalFactureCentimes: Number(ligne.facture),
        totalPayeCentimes: Number(ligne.paye),
        resteAPayerCentimes: Number(ligne.reste),
      },
    ]
  })

  return { elements, total, page, taille: params.taille, pages }
}

export interface RapportRendezVous {
  totalRendezVous: number
  parStatut: Record<string, number>
}

/** Rapport sur les rendez-vous (§27). */
export async function rapportRendezVous(periode: Periode): Promise<RapportRendezVous> {
  const where = { dateDebut: { gte: periode.debut, lte: periode.fin } }

  const [total, parStatut] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.groupBy({ by: ['statut'], where, _count: { _all: true } }),
  ])

  const totaux: Record<string, number> = {}
  for (const groupe of parStatut) {
    totaux[groupe.statut] = groupe._count._all
  }

  return { totalRendezVous: total, parStatut: totaux }
}

// -----------------------------------------------------------------------------
//  TABLEAU DE BORD (§25)
// -----------------------------------------------------------------------------

export interface TableauBordDonnees {
  /**
   * Rendez-vous PLANIFIES du jour, tries par heure.
   *
   * Ne contient JAMAIS une visite spontanee : les deux populations sont
   * disjointes, un patient ne pouvant pas etre a la fois attendu sur un creneau
   * et arrive sans creneau.
   */
  rendezVousDuJour: Array<{
    id: string
    patient: string
    telephone: string
    dateDebut: string
    dateFin: string
    statut: string
    motif: string | null
    /**
     * Faux UNIQUEMENT si aucun rendez-vous anterieur n'existe pour ce patient :
     * le rendez-vous du jour est alors sa PREMIERE visite au cabinet.
     */
    patientConnu: boolean
  }>
  /**
   * Visites du jour SANS rendez-vous planifie (patients venus spontanement).
   *
   * La distinction repose sur le marqueur de motif
   * (`MARQUEUR_SANS_RENDEZ_VOUS`), jamais sur l'anciennete du patient :
   * un patient connu peut arriver sans rendez-vous, un patient nouveau peut
   * avoir un rendez-vous planifie.
   */
  patientsSansRendezVous: Array<{
    id: string
    patient: string
    telephone: string
    dateDebut: string
    /** Motif de consultation seul, marqueur retire. */
    motifConsultation: string | null
    /** Faux si le patient n'avait AUCUN rendez-vous anterieur a aujourd'hui. */
    patientConnu: boolean
  }>
  /** Nombre total de patients enregistres au cabinet. */
  totalPatients: number
  /**
   * Patients DISTINCTS venus aujourd'hui, tous modes de venue confondus
   * (rendez-vous planifie, visite spontanee, premier passage). Un patient venu
   * deux fois ne compte qu'une fois.
   */
  patientsVenusJour: number
  /** Parmi les patients venus aujourd'hui, ceux dont c'est la premiere visite. */
  nouveauxPatientsJour: number
  /** Rendez-vous du jour dont le patient a deja consulte (anciens). */
  rendezVousAnciens: number
  /** Rendez-vous du jour qui constituent la PREMIERE visite du patient. */
  rendezVousNouveaux: number
  nombrePatientsAttendus: number
  traitementsEnCours: number
  revenusJourCentimes: number
  nombrePaiementsJour: number
  revenusSemaineCentimes: number
  revenusMoisCentimes: number
  totalRestantCentimes: number
  /**
   * Rendez-vous a VENIR (strictement posterieurs a la journee en cours), tries
   * du plus proche au plus lointain. C'est la liste des rendez-vous encore a
   * honorer : elle ne recoupe jamais celle d'aujourd'hui.
   */
  nouveauxRendezVous: Array<{
    id: string
    patient: string
    telephone: string
    dateDebut: string
    dateFin: string
    statut: string
    motif: string | null
  }>
  prochainsRendezVous: Array<{
    id: string
    patient: string
    dateDebut: string
    statut: string
  }>
}

/**
 * Rassemble les indicateurs du tableau de bord (§25).
 *
 * Toutes les valeurs proviennent d'AGREGATIONS EN BASE. Le graphique des
 * revenus mensuels repose sur les PAIEMENTS REELS, jamais sur les prix des
 * traitements (§16, §18).
 *
 * Le total des patients est un `COUNT` execute par PostgreSQL : la liste des
 * patients n'est JAMAIS chargee dans Node pour etre comptee (§18, §35).
 * Aucun filtre n'est applique : le schema ne definit ni statut actif ni
 * archivage, `prisma.patient.count()` est donc exactement la regle existante
 * (le service patients compte de la meme facon).
 *
 * Les revenus du jour sont la SOMME des paiements VALIDE dont la date tombe
 * aujourd'hui : jamais un total de traitement, jamais un montant estime (§16).
 */
export async function donneesTableauBord(): Promise<TableauBordDonnees> {
  const aujourdhui = periodeAujourdhui()
  const semaine = periodeSemaine()
  const mois = periodeMois()

  const [
    rendezVousJour,
    visitesJour,
    totalPatients,
    traitementsEnCours,
    revenusJour,
    nbPaiementsJour,
    revenusSemaine,
    revenusMois,
    restant,
    prochain,
    nouveaux,
  ] = await Promise.all([
    //
    // RENDEZ-VOUS PLANIFIES DU JOUR.
    //
    // Le filtre sur le motif est indispensable : les visites spontanees vivent
    // dans la MEME table (voir appointments.service). Filtrer `startsWith`
    // directement en SQL evite de charger puis d'ecarter les visites en memoire.
    //
    prisma.appointment.findMany({
      where: {
        dateDebut: { gte: aujourdhui.debut, lte: aujourdhui.fin },
        statut: { notIn: ['ANNULE'] },
        AND: [FILTRE_RENDEZ_VOUS_PLANIFIES],
      },
      orderBy: { dateDebut: 'asc' },
      select: {
        id: true,
        dateDebut: true,
        dateFin: true,
        statut: true,
        motif: true,
        patient: { select: { id: true, nom: true, prenom: true, telephone: true } },
      },
    }),
    //
    // VISITES DU JOUR SANS RENDEZ-VOUS.
    //
    // Meme table, filtre INVERSE. Seules les visites non annulees sont
    // conservees : une visite annulee n'a pas eu lieu.
    //
    prisma.appointment.findMany({
      where: {
        dateDebut: { gte: aujourdhui.debut, lte: aujourdhui.fin },
        statut: { notIn: ['ANNULE'] },
        motif: { startsWith: MARQUEUR_SANS_RENDEZ_VOUS },
      },
      orderBy: { dateDebut: 'asc' },
      select: {
        id: true,
        dateDebut: true,
        motif: true,
        patient: { select: { id: true, nom: true, prenom: true, telephone: true } },
      },
    }),
    // COUNT cote base : aucun patient n'est rapatrie dans Node.
    prisma.patient.count(),
    prisma.treatment.count({ where: { statut: 'EN_COURS' } }),
    totalEncaisse(aujourdhui.debut, aujourdhui.fin),
    prisma.payment.count({
      where: { statut: 'VALIDE', datePaiement: { gte: aujourdhui.debut, lte: aujourdhui.fin } },
    }),
    totalEncaisse(semaine.debut, semaine.fin),
    totalEncaisse(mois.debut, mois.fin),
    totalRestantARecevoir(),
    prisma.appointment.findMany({
      where: {
        dateDebut: { gt: aujourdhui.fin },
        statut: { notIn: ['ANNULE', 'ABSENT'] },
        AND: [FILTRE_RENDEZ_VOUS_PLANIFIES],
      },
      orderBy: { dateDebut: 'asc' },
      take: 5,
      select: {
        id: true,
        dateDebut: true,
        statut: true,
        patient: { select: { nom: true, prenom: true } },
      },
    }),
    //
    // NOUVEAUX RENDEZ-VOUS (dates a venir).
    //
    //  Strictement apres la fin de la journee : la liste ne peut donc pas
    //  contenir un rendez-vous d'aujourd'hui, ce qui garantit que les deux
    //  listes du tableau de bord sont bien disjointes.
    //
    //  ANNULE est exclu (creneau supprime). ABSENT ne l'est PAS : un statut
    //  « absent » sur une date future ne veut rien dire, et un rendez-vous
    //  reporte doit rester visible pour que le medecin le retrouve.
    //
    prisma.appointment.findMany({
      where: {
        dateDebut: { gt: aujourdhui.fin },
        statut: { not: 'ANNULE' },
        AND: [FILTRE_RENDEZ_VOUS_PLANIFIES],
      },
      orderBy: { dateDebut: 'asc' },
      take: 20,
      select: {
        id: true,
        dateDebut: true,
        dateFin: true,
        statut: true,
        motif: true,
        patient: { select: { nom: true, prenom: true, telephone: true } },
      },
    }),
  ])

  //
  // CLASSIFICATION ANCIEN / NOUVEAU (§25)
  //
  //  Un rendez-vous du jour est « nouveau » si le patient n'a AUCUN rendez-vous
  //  anterieur a aujourd'hui — sa visite est la premiere au cabinet. Sinon il est
  //  « ancien » : le patient a deja consulte.
  //
  //  La comparaison porte sur les rendez-vous STRICTEMENT ANTERIEURS au debut de
  //  la journee, et non sur « les autres rendez-vous du jour » : un patient venu
  //  deux fois le meme jour doit rester « ancien » a partir de sa deuxieme visite,
  //  et un patient dont le rendez-vous a ete annule la semaine derniere reste
  //  « connu » du cabinet.
  //
  //  Les rendez-vous planifies ET les visites spontanees comptent comme
  //  historique : un patient deja venu sans rendez-vous est un patient connu.
  //  La recherche d'historique est faite UNE SEULE FOIS pour les deux listes.
  //
  //  La reponse de la base est UNIQUEMENT la liste des patients deja connus :
  //  le regroupement est fait par `DISTINCT` cote SQL, jamais en chargeant
  //  l'historique complet des rendez-vous dans Node (§18, §35).
  //
  const patientsDuJour = [
    ...new Set([
      ...rendezVousJour.map((rdv) => rdv.patient.id),
      ...visitesJour.map((visite) => visite.patient.id),
    ]),
  ]
  const patientsConnus =
    patientsDuJour.length === 0
      ? []
      : await prisma.appointment.findMany({
          where: {
            patientId: { in: patientsDuJour },
            dateDebut: { lt: aujourdhui.debut },
          },
          distinct: ['patientId'],
          select: { patientId: true },
        })
  const dejaVenus = new Set(patientsConnus.map((ligne) => ligne.patientId))

  // Presences du jour : derivees des deux listes deja chargees, donc sans
  // requete supplementaire. Le detail de la regle est documente dans
  // `backend/services/dashboard-metrics.ts`.
  const { patientsVenusJour, nouveauxPatientsJour } = presencesDuJour(
    rendezVousJour,
    visitesJour,
    dejaVenus,
  )

  const rendezVousDuJour = rendezVousJour.map((rdv) => ({
    id: rdv.id,
    patient: `${rdv.patient.prenom} ${rdv.patient.nom}`,
    telephone: rdv.patient.telephone,
    dateDebut: rdv.dateDebut.toISOString(),
    dateFin: rdv.dateFin.toISOString(),
    statut: rdv.statut,
    motif: rdv.motif,
    patientConnu: dejaVenus.has(rdv.patient.id),
  }))

  const patientsSansRendezVous = visitesJour.map((visite) => ({
    id: visite.id,
    patient: `${visite.patient.prenom} ${visite.patient.nom}`,
    telephone: visite.patient.telephone,
    dateDebut: visite.dateDebut.toISOString(),
    motifConsultation: motifConsultationDe(visite.motif),
    patientConnu: dejaVenus.has(visite.patient.id),
  }))

  return {
    rendezVousDuJour,
    patientsSansRendezVous,
    totalPatients,
    patientsVenusJour,
    nouveauxPatientsJour,
    rendezVousAnciens: rendezVousDuJour.filter((rdv) => rdv.patientConnu).length,
    rendezVousNouveaux: rendezVousDuJour.filter((rdv) => !rdv.patientConnu).length,
    nombrePatientsAttendus: rendezVousJour.length,
    traitementsEnCours,
    revenusJourCentimes: revenusJour,
    nombrePaiementsJour: nbPaiementsJour,
    revenusSemaineCentimes: revenusSemaine,
    revenusMoisCentimes: revenusMois,
    totalRestantCentimes: restant,
    nouveauxRendezVous: nouveaux.map((rdv) => ({
      id: rdv.id,
      patient: `${rdv.patient.prenom} ${rdv.patient.nom}`,
      telephone: rdv.patient.telephone,
      dateDebut: rdv.dateDebut.toISOString(),
      dateFin: rdv.dateFin.toISOString(),
      statut: rdv.statut,
      motif: rdv.motif,
    })),
    prochainsRendezVous: prochain.map((rdv) => ({
      id: rdv.id,
      patient: `${rdv.patient.prenom} ${rdv.patient.nom}`,
      dateDebut: rdv.dateDebut.toISOString(),
      statut: rdv.statut,
    })),
  }
}
