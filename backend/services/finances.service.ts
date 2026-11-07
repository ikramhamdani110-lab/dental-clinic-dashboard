import { Prisma } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { logger } from '@backend/logging/logger'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  SERVICE FINANCES PRIVEES DU MEDECIN (§finances)
 * =============================================================================
 *
 *  SOURCE DE VERITE — LES PAIEMENTS EXISTANTS
 *
 *   Le revenu « calcule » provient EXCLUSIVEMENT de la table `payments` de la
 *   clinique (meme base, meme regles que l'application de bureau) :
 *
 *     - seuls les paiements de statut VALIDE comptent (les ANNULE sont exclus —
 *       ils ont ete corriges par contre-passation, §17) ;
 *     - les paiements places en Corbeille sont exclus (`filtreExclusion`) ;
 *     - les bornes de date sont exprimées dans le CALENDRIER LOCAL du cabinet,
 *       comme partout ailleurs (voir payments.service pour le raisonnement
 *       complet sur les timestamps naifs).
 *
 *  DISTINCTION MANUEL / CALCULE — ANTI-DOUBLON
 *
 *   Une `ManualIncome` n'est JAMAIS additionnee aux revenus calcules dans un
 *   meme total sans label. Le tableau de bord financier presente TOUJOURS deux
 *   lignes distinctes :
 *
 *     1. « Revenus encaissés (paiements clinique) » — derive de `payments` ;
 *     2. « Revenus manuels » — derive de `manual_incomes`.
 *
 *   La regle d'usage est documentée a l'écran : une encaissement clinique (un
 *   patient qui paye un traitement) se saisit dans l'application de bureau ;
 *   le site financier ne sert qu'aux recettes HORS de ce circuit. La cle
 *   d'idempotence (`idempotencyKey` UNIQUE en base) empeche en outre qu'un
 *   second envoi du meme formulaire crée un doublon.
 *
 *  SOLDES PATIENTS — JAMAIS TRAITES COMME UN REVENU
 *
 *   Le montant restant du par les patients (facture - paye sur les traitements
 *   non annulés) est affiché SEPAREMENT et n'entre JAMAIS dans le solde net.
 *  AGREGATION EN BASE
 *
 *   Tous les totaux sont des `aggregate`/`groupBy`/`$queryRaw` : Node ne
 *   télécharge jamais l'ensemble des paiements pour additionner (§18, §35).
 *   Les listes sont paginées côté serveur.
 */

// -----------------------------------------------------------------------------
//  BORNES DE PERIODE (calendrier local, meme convention que payments.service)
// -----------------------------------------------------------------------------

export interface Periode {
  debut: Date
  fin: Date
}

export function periodeAujourdhui(reference: Date = new Date()): Periode {
  const debut = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 0, 0, 0, 0)
  const fin = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999)
  return { debut, fin }
}

export function periodeDerniersJours(nombreJours: number, reference: Date = new Date()): Periode {
  const fin = periodeAujourdhui(reference).fin
  const debut = new Date(fin)
  debut.setDate(debut.getDate() - (nombreJours - 1))
  debut.setHours(0, 0, 0, 0)
  return { debut, fin }
}

export function periodeMois(reference: Date = new Date()): Periode {
  const debut = new Date(reference.getFullYear(), reference.getMonth(), 1, 0, 0, 0, 0)
  const fin = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999)
  return { debut, fin }
}

/** Trimestre CIVIL en cours (janvier-mars, avril-juin, juillet-septembre, octobre-decembre). */
export function periodeTrimestre(reference: Date = new Date()): Periode {
  const premierMois = Math.floor(reference.getMonth() / 3) * 3
  const debut = new Date(reference.getFullYear(), premierMois, 1, 0, 0, 0, 0)
  const fin = new Date(reference.getFullYear(), premierMois + 3, 0, 23, 59, 59, 999)
  return { debut, fin }
}

export function periodeAnnee(annee: number): Periode {
  const debut = new Date(annee, 0, 1, 0, 0, 0, 0)
  const fin = new Date(annee, 11, 31, 23, 59, 59, 999)
  return { debut, fin }
}

/**
 * Année demandée par le client (paramètre `annee`), bornée à une plage
 * plausible. Absente → `defaut`. Invalide → refus explicite, jamais une
 * substitution silencieuse : un rapport financier qui affiche une autre année
 * que celle demandée est pire qu'une erreur.
 */
export function lireAnnee(valeur: string | null, defaut: number): number {
  if (valeur === null || valeur === '') return defaut
  const annee = Number.parseInt(valeur, 10)
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    throw erreurs.validation('Année invalide.')
  }
  return annee
}

// -----------------------------------------------------------------------------
//  REVENU CALCULE (paiements clinique VALIDE, hors corbeille)
// -----------------------------------------------------------------------------

/** Total des paiements VALIDE sur la periode, excluant la corbeille ET les conflits A_ARBITRER. */
export async function revenusPaiements(debut: Date, fin: Date): Promise<number> {
  const idsCorbeille = await idsPaiementsEnCorbeille()
  const agregat = await prisma.payment.aggregate({
    where: {
      statut: 'VALIDE',
      syncStatut: 'VALIDE', // un paiement en conflit de sync est EXCLU des revenus
      datePaiement: { gte: debut, lte: fin },
      id: idsCorbeille,
    },
    _sum: { montantCentimes: true },
  })
  return agregat._sum.montantCentimes ?? 0
}

/** Nombre de paiements VALIDE sur la periode (idem exclusion A_ARBITRER). */
export async function nombrePaiements(debut: Date, fin: Date): Promise<number> {
  const idsCorbeille = await idsPaiementsEnCorbeille()
  return prisma.payment.count({
    where: {
      statut: 'VALIDE',
      syncStatut: 'VALIDE',
      datePaiement: { gte: debut, lte: fin },
      id: idsCorbeille,
    },
  })
}

/**
 * Identifiants des paiements actuellement en corbeille.
 * Renvoie un filtre Prisma neutre (`{}`) quand la corbeille est vide : la
 * clause `id: {}` n'exclut alors rien.
 */
async function idsPaiementsEnCorbeille(): Promise<Prisma.PaymentWhereInput['id']> {
  try {
    const { filtreExclusion } = await import('@backend/services/trash.service')
    return await filtreExclusion('PAIEMENT')
  } catch (erreur) {
    logger.warn('Filtre corbeille indisponible pour les finances', { error: erreur })
    return {}
  }
}

// -----------------------------------------------------------------------------
//  REVENUS MANUELS — DISTINCTS DU TOTAL « REVENUS » (les trois boites)
// -----------------------------------------------------------------------------

/**
 * Total des revenus manuels sur la periode.
 *
 * ATTENTION : « revenu manuel » est une ANCIENNE source, distincte des
 * paiements du secretariat. Le medecin ne saisissant plus aucun revenu (§3.1),
 * ce total n'entre PAS dans la boite « + REVENUS » : la boite ne contient que
 * les paiements reels enregistres par le secretariat. Il reste expose a part
 * pour ne jamais faire disparaitre silencieusement une ecriture historique.
 */
export async function revenusManuels(debut: Date, fin: Date): Promise<number> {
  const agregat = await prisma.manualIncome.aggregate({
    where: { date: { gte: debut, lte: fin } },
    _sum: { montantCentimes: true },
  })
  return agregat._sum.montantCentimes ?? 0
}

// -----------------------------------------------------------------------------
//  DEPENSES
// -----------------------------------------------------------------------------

/** Total des depenses sur la periode. */
export async function totalDepenses(debut: Date, fin: Date): Promise<number> {
  const agregat = await prisma.expense.aggregate({
    where: { date: { gte: debut, lte: fin } },
    _sum: { montantCentimes: true },
  })
  return agregat._sum.montantCentimes ?? 0
}

// -----------------------------------------------------------------------------
//  SOLDES PATIENTS RESTANTS DUS (JAMAIS un revenu)
// -----------------------------------------------------------------------------

/**
 * Montant TOTAL restant dû par les patients : somme des prix des traitements
 * non ANNULE, moins la somme des paiements VALIDE. Calcule EN BASE.
 * Identique a la regle existante `totalRestantARecevoir` (§18).
 */
export async function totalRestantDu(): Promise<number> {
  const [traitements, paiements] = await Promise.all([
    prisma.treatment.aggregate({
      where: { statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
    }),
    prisma.payment.aggregate({
      where: { statut: 'VALIDE', syncStatut: 'VALIDE' },
      _sum: { montantCentimes: true },
    }),
  ])

  const total = traitements._sum.prixTotalCentimes ?? 0
  const paye = paiements._sum.montantCentimes ?? 0
  return Math.max(0, total - paye)
}

// -----------------------------------------------------------------------------
//  SYNTHESE FINANCIERE (tableau de bord prive)
// -----------------------------------------------------------------------------

export interface SyntheseFinanciere {
  periode: { debut: string; fin: string }
  /** Somme des paiements clinique VALIDE de la periode (source : `payments`). */
  revenusPaiementsCentimes: number
  /**
   * TOTAL « + REVENUS » DE LA BOITE : argent REELLEMENT recu sur la periode.
   * Uniquement des paiements enregistres par le secretariat — jamais un
   * revenu saisi par le medecin. Aliase explicite de `revenusPaiementsCentimes`
   * pour que l'interface n'ait aucune somme a refaire.
   */
  revenusCentimes: number
  /** Nombre de paiements clinique VALIDE de la periode. */
  nombrePaiements: number
  /** Somme des revenus manuels de la periode (source : `manual_incomes`). */
  revenusManuelsCentimes: number
  /** TOTAL « − DEPENSES » DE LA BOITE : depenses saisies par le medecin. */
  depensesCentimes: number
  /** Nombre de depenses de la periode. */
  nombreDepenses: number
  /**
   * SOLDE NET = revenus recus - depenses. Les revenus manuels historiques et le
   * restant du sont VOLONTAIREMENT exclus : le premier ne fut jamais encaisse
   * via le secretariat, le second n'est pas encore de l'argent recu. Ils sont
   * exposes separement (`revenusManuelsCentimes`, `restantDuCentimes`).
   */
  soldeNetCentimes: number
  /** Montant restant dû par les patients, AFFICHE separement (pas un revenu). */
  restantDuCentimes: number
  /**
   * Mention obligatoire : la synthese decrit les entrees enregistrees
   * (paiements clinique, revenus manuels, depenses saisies) et NON la position
   * comptable complete du cabinet.
   */
  mention: string
  /**
   * Revenus du MOIS EN COURS (1er du mois -> aujourd'hui), INDEPENDAMMENT de la
   * periode selectionnee.
   *
   * L'ancien tableau de bord affichait ici `revenusPaiementsCentimes`, c'est a
   * dire la periode filtree : la carte « Revenus du mois » repetait alors
   * « Total des revenus » et ne decrivait pas le mois. C'est une mesure
   * distincte, donc un calcul distinct.
   */
  revenusMoisCentimes: number
  /** Nombre de paiements VALIDE du mois en cours. */
  nombrePaiementsMois: number
  /** Nombre de patients ayant encore un solde a payer (dette > 0). */
  nombrePatientsDebiteurs: number
}

export async function syntheseFinanciere(periode: Periode): Promise<SyntheseFinanciere> {
  const moisEnCours = periodeMois()
  const [revenusPai, revenusMan, depenses, nombreDep, restantDu, nombreDebiteurs, nombre, revenusMois, nombreMois] =
    await Promise.all([
      revenusPaiements(periode.debut, periode.fin),
      revenusManuels(periode.debut, periode.fin),
      totalDepenses(periode.debut, periode.fin),
      prisma.expense.count({ where: { date: { gte: periode.debut, lte: periode.fin } } }),
      totalRestantDu(),
      nombrePatientsDebiteurs(),
      nombrePaiements(periode.debut, periode.fin),
      revenusPaiements(moisEnCours.debut, moisEnCours.fin),
      nombrePaiements(moisEnCours.debut, moisEnCours.fin),
    ])

  return {
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    revenusPaiementsCentimes: revenusPai,
    revenusCentimes: revenusPai,
    nombrePaiements: nombre,
    revenusManuelsCentimes: revenusMan,
    depensesCentimes: depenses,
    nombreDepenses: nombreDep,
    soldeNetCentimes: revenusPai - depenses,
    restantDuCentimes: restantDu,
    nombrePatientsDebiteurs: nombreDebiteurs,
    mention:
      'Revenus et dette issus des encaissements et des traitements du secretariat — dépenses saisies par le médecin.',
    revenusMoisCentimes: revenusMois,
    nombrePaiementsMois: nombreMois,
  }
}

// -----------------------------------------------------------------------------
//  SERIE REVENUS / DEPENSES DU GRAPHIQUE (agregation EN BASE)
// -----------------------------------------------------------------------------

export interface PointEvolution {
  /** Premier jour de la maille, format `aaaa-mm-jj`. */
  date: string
  revenusCentimes: number
  depensesCentimes: number
}

export interface EvolutionFinanciere {
  /** `jour` : une barre par jour. `mois` : une barre par mois civil. */
  maille: 'jour' | 'mois'
  points: PointEvolution[]
}

/**
 * Série REVENUS(+) / DEPENSES(−) du graphique.
 *
 * MAILLE AUTOMATIQUE
 *   Une année complète fait 365 barres : illisible et inutile. On regroupe donc
 *   par MOIS dès que la période dépasse 62 jours, par JOUR sinon. Le serveur
 *   choisit la maille et l'annonce (`maille`) : le navigateur n'arbitre rien.
 *
 * AGRÉGATION EN BASE
 *   `GROUP BY` sur le jour civil (calendrier local du cabinet, même conversion
 *   que `serieJournaliereRevenus`) puis regroupement sur la maille demandée.
 *   Les jours sans mouvement sont ABSENTS : le graphique trace une ligne
 *   continue entre deux points existants.
 *
 * PÉRIMÈTRE : mêmes prédicats que les boîtes (paiements VALIDE hors corbeille,
 *   hors conflit de sync ; dépenses saisies par le médecin). La somme des
 *   points est donc ÉGALE aux totaux des boîtes pour la période.
 */
export async function evolutionFinanciere(periode: Periode): Promise<EvolutionFinanciere> {
  const jours = Math.round((periode.fin.getTime() - periode.debut.getTime()) / 86_400_000) + 1
  const maille: 'jour' | 'mois' = jours > 62 ? 'mois' : 'jour'

  const idsCorbeille = await idsPaiementsEnCorbeille()
  const exclus =
    idsCorbeille && typeof idsCorbeille === 'object' && 'not' in (idsCorbeille as object)
      ? ((idsCorbeille as { not?: string[] }).not ?? [])
      : []
  const exclusion =
    exclus.length > 0
      ? Prisma.sql`AND p.id NOT IN (${Prisma.join(exclus.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty

  const [revenus, depenses] = await Promise.all([
    prisma.$queryRaw<Array<{ cle: string; total: bigint | number }>>`
      SELECT ${maille === 'mois' ? Prisma.sql`TO_CHAR(jour, 'YYYY-MM')` : Prisma.sql`TO_CHAR(jour, 'YYYY-MM-DD')`} AS cle,
             SUM(p."montantCentimes")::bigint AS total
        FROM (
          SELECT (p."datePaiement" AT TIME ZONE 'UTC' AT TIME ZONE current_setting('TimeZone'))::date AS jour,
                 p."montantCentimes"
            FROM payments p
           WHERE p.statut = 'VALIDE'
             AND p."syncStatut" = 'VALIDE'
             AND p."datePaiement" >= ${periode.debut}
             AND p."datePaiement" <= ${periode.fin}
             ${exclusion}
        ) p
       GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ cle: string; total: bigint | number }>>`
      SELECT ${maille === 'mois' ? Prisma.sql`TO_CHAR(jour, 'YYYY-MM')` : Prisma.sql`TO_CHAR(jour, 'YYYY-MM-DD')`} AS cle,
             SUM(d."montantCentimes")::bigint AS total
        FROM (
          SELECT (d."date" AT TIME ZONE 'UTC' AT TIME ZONE current_setting('TimeZone'))::date AS jour,
                 d."montantCentimes"
            FROM expenses d
           WHERE d."date" >= ${periode.debut}
             AND d."date" <= ${periode.fin}
        ) d
       GROUP BY 1
    `,
  ])

  const cles = new Map<string, PointEvolution>()
  const point = (cle: string): PointEvolution => {
    const existant = cles.get(cle)
    if (existant) return existant
    const nouveau: PointEvolution = {
      date: maille === 'mois' ? `${cle}-01` : cle,
      revenusCentimes: 0,
      depensesCentimes: 0,
    }
    cles.set(cle, nouveau)
    return nouveau
  }
  for (const ligne of revenus) point(ligne.cle).revenusCentimes = Number(ligne.total)
  for (const ligne of depenses) point(ligne.cle).depensesCentimes = Number(ligne.total)

  const points = [...cles.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, valeur]) => valeur)

  return { maille, points }
}

// -----------------------------------------------------------------------------
//  DETTES PATIENTS AVEC TRAITEMENT / RENDEZ-VOUS LIE
// -----------------------------------------------------------------------------

export interface LigneDetteDetaillee {
  patientId: string
  patient: string
  telephone: string
  resteAPayerCentimes: number
  /** Traitement porteur du solde le plus eleve encore impaye, s'il existe. */
  traitement: string | null
  /** Rendez-vous le plus recent lie a un traitement du patient. */
  rendezVous: string | null
  /** Montant total facture au patient (traitements non ANNULE). */
  totalDuCentimes: number
  /** Montant deja encaisse (paiements VALIDE). */
  payeCentimes: number
  /** Date du dernier paiement VALIDE, s'il y en a un. */
  dernierPaiement: string | null
  /** Situation de paiement du patient, deduite du solde. */
  statutPaiement: 'NON_PAYE' | 'PARTIEL' | 'SOLDE'
}

/** Nombre de patients ayant encore un solde strictement positif. */
export async function nombrePatientsDebiteurs(): Promise<number> {
  const lignes = await prisma.$queryRaw<Array<{ total: bigint }>>`
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
    )
    SELECT COUNT(*)::bigint AS total
      FROM facturation f
      LEFT JOIN encaissement e ON e."patientId" = f."patientId"
     WHERE (f.facture - COALESCE(e.paye, 0)) > 0
  `
  return Number(lignes[0]?.total ?? 0n)
}

/**
 * Dettes des patients, enrichies du traitement et du rendez-vous concernes.
 *
 * La regle de solde est IDENTIQUE a `listerDettesPatients` (facture − paye,
 * traitements non ANNULE, paiements VALIDE) : les deux vues ne peuvent pas
 * diverger. Seules des informations de CONTEXTE sont ajoutees ici.
 */
export async function listerDettesDetaillees(params: {
  page: number
  taille?: number
}): Promise<{
  elements: LigneDetteDetaillee[]
  total: number
  totalCentimes: number
  page: number
  pages: number
  taille: number
}> {
  const page = await listerDettesPatients(params)
  const ids = page.elements.map((ligne) => ligne.patientId)

  if (ids.length === 0) {
    return {
      elements: [],
      total: page.total,
      totalCentimes: page.totalCentimes,
      page: page.page,
      pages: page.pages,
      taille: page.taille,
    }
  }

  const [soins, rendezVous] = await Promise.all([
    prisma.treatment.findMany({
      where: { patientId: { in: ids }, statut: { not: 'ANNULE' } },
      select: {
        patientId: true,
        typeTraitement: true,
        prixTotalCentimes: true,
        payments: { where: { statut: 'VALIDE' }, select: { montantCentimes: true } },
      },
    }),
    prisma.appointment.findMany({
      where: { patientId: { in: ids }, statut: { not: 'ANNULE' } },
      orderBy: { dateDebut: 'desc' },
      select: { patientId: true, dateDebut: true },
    }),
  ])

  const parPatient = new Map<string, { libelle: string; reste: number }>()
  const encaisseParPatient = new Map<string, number>()
  const factureParPatient = new Map<string, number>()
  for (const soin of soins) {
    const paye = soin.payments.reduce((somme, p) => somme + p.montantCentimes, 0)
    encaisseParPatient.set(soin.patientId, (encaisseParPatient.get(soin.patientId) ?? 0) + paye)
    factureParPatient.set(
      soin.patientId,
      (factureParPatient.get(soin.patientId) ?? 0) + soin.prixTotalCentimes,
    )
    const reste = Math.max(0, soin.prixTotalCentimes - paye)
    const actuel = parPatient.get(soin.patientId)
    if (!actuel || reste > actuel.reste) {
      parPatient.set(soin.patientId, { libelle: soin.typeTraitement, reste })
    }
  }

  const prochainRdv = new Map<string, Date>()
  for (const rdv of rendezVous) {
    if (!prochainRdv.has(rdv.patientId)) prochainRdv.set(rdv.patientId, rdv.dateDebut)
  }

  return {
    elements: page.elements.map((ligne) => {
      const soin = parPatient.get(ligne.patientId)
      const rdv = prochainRdv.get(ligne.patientId)
      const paye = encaisseParPatient.get(ligne.patientId) ?? 0
      return {
        patientId: ligne.patientId,
        patient: ligne.patient,
        telephone: ligne.telephone,
        resteAPayerCentimes: ligne.resteAPayerCentimes,
        traitement: soin?.libelle ?? null,
        rendezVous: rdv ? rdv.toISOString() : null,
        totalDuCentimes: factureParPatient.get(ligne.patientId) ?? 0,
        payeCentimes: paye,
        dernierPaiement: ligne.dernierPaiement,
        statutPaiement: paye === 0 ? 'NON_PAYE' : 'PARTIEL',
      }
    }),
    total: page.total,
    totalCentimes: page.totalCentimes,
    page: page.page,
    pages: page.pages,
    taille: page.taille,
  }
}

// -----------------------------------------------------------------------------
//  TENDANCES MENSUELLES (graphique revenus / depenses)
// -----------------------------------------------------------------------------

export interface PointMensuel {
  annee: number
  /** 0 = janvier (index `Date.getMonth()`). */
  mois: number
  revenusPaiementsCentimes: number
  revenusManuelsCentimes: number
  depensesCentimes: number
}

/**
 * Serie mensuelle sur les `nombreMois` derniers mois, agregée EN BASE
 * (une ligne par mois par source). Les mois sans mouvement restent presents a
 * zero pour garder une maille reguliere.
 */
export async function tendancesMensuelles(
  nombreMois: number,
  reference: Date = new Date(),
): Promise<PointMensuel[]> {
  const debut = new Date(
    reference.getFullYear(),
    reference.getMonth() - (nombreMois - 1),
    1,
    0,
    0,
  )
  const fin = periodeMois(reference).fin

  const idsCorbeille = await idsPaiementsEnCorbeille()
  const filtrePaiements: Prisma.PaymentWhereInput = {
    statut: 'VALIDE',
    datePaiement: { gte: debut, lte: fin },
    ...(idsCorbeille ? { id: idsCorbeille } : {}),
  }

  // Les resultats detailles ne sont pas consommes : le regroupement mensuel
  // passe par SQL brut plus bas. La lecture prealable ne sert qu'a valider
  // l'acces aux tables avant la requete d'agregation.
  void (
    await Promise.all([
      prisma.payment.count({ where: filtrePaiements }).catch(() => 0),
      prisma.manualIncome.count({ where: { date: { gte: debut, lte: fin } } }).catch(() => 0),
      prisma.expense.count({ where: { date: { gte: debut, lte: fin } } }).catch(() => 0),
    ])
  )

  // Regroupement mensuel via SQL brut (DATE_TRUNC sur le calendrier local).
  const [paiementsMensuels, manuelsMensuels, depensesMensuelles] = await Promise.all([
    prisma.$queryRaw<Array<{ annee: number; mois: number; total: bigint }>>`
      SELECT EXTRACT(YEAR FROM mois_local)::int AS annee,
             EXTRACT(MONTH FROM mois_local)::int AS mois,
             SUM("montantCentimes")::bigint AS total
      FROM (
        SELECT DATE_TRUNC('month', ("datePaiement" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')) AS mois_local,
               "montantCentimes"
        FROM "payments"
        WHERE "statut" = 'VALIDE'::"StatutPaiement"
          AND "datePaiement" >= ${debut}::timestamp
          AND "datePaiement" <= ${fin}::timestamp
      ) AS p
      GROUP BY mois_local
    `,
    prisma.$queryRaw<Array<{ annee: number; mois: number; total: bigint }>>`
      SELECT EXTRACT(YEAR FROM mois_local)::int AS annee,
             EXTRACT(MONTH FROM mois_local)::int AS mois,
             SUM("montantCentimes")::bigint AS total
      FROM (
        SELECT DATE_TRUNC('month', ("date" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')) AS mois_local,
               "montantCentimes"
        FROM "manual_incomes"
        WHERE "date" >= ${debut}::timestamp
          AND "date" <= ${fin}::timestamp
      ) AS m
      GROUP BY mois_local
    `,
    prisma.$queryRaw<Array<{ annee: number; mois: number; total: bigint }>>`
      SELECT EXTRACT(YEAR FROM mois_local)::int AS annee,
             EXTRACT(MONTH FROM mois_local)::int AS mois,
             SUM("montantCentimes")::bigint AS total
      FROM (
        SELECT DATE_TRUNC('month', ("date" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')) AS mois_local,
               "montantCentimes"
        FROM "expenses"
        WHERE "date" >= ${debut}::timestamp
          AND "date" <= ${fin}::timestamp
      ) AS d
      GROUP BY mois_local
    `,
  ])

  // Les resultats du decompte prealable ne sont pas consommes.

  const cles = new Map<string, PointMensuel>()
  const cle = (annee: number, moisZeroBase: number) => `${annee}-${moisZeroBase}`

  const injecter = (
    lignes: Array<{ annee: number; mois: number; total: bigint }>,
    champ: 'revenusPaiementsCentimes' | 'revenusManuelsCentimes' | 'depensesCentimes',
  ) => {
    for (const ligne of lignes) {
      const moisZeroBase = ligne.mois - 1
      const k = cle(ligne.annee, moisZeroBase)
      const point = cles.get(k) ?? {
        annee: ligne.annee,
        mois: moisZeroBase,
        revenusPaiementsCentimes: 0,
        revenusManuelsCentimes: 0,
        depensesCentimes: 0,
      }
      point[champ] = Number(ligne.total)
      cles.set(k, point)
    }
  }

  injecter(paiementsMensuels, 'revenusPaiementsCentimes')
  injecter(manuelsMensuels, 'revenusManuelsCentimes')
  injecter(depensesMensuelles, 'depensesCentimes')

  // Remplit les mois vides pour garder une maille reguliere.
  const serie: PointMensuel[] = []
  for (let i = 0; i < nombreMois; i += 1) {
    const d = new Date(debut.getFullYear(), debut.getMonth() + i, 1)
    const k = cle(d.getFullYear(), d.getMonth())
    serie.push(
      cles.get(k) ?? {
        annee: d.getFullYear(),
        mois: d.getMonth(),
        revenusPaiementsCentimes: 0,
        revenusManuelsCentimes: 0,
        depensesCentimes: 0,
      },
    )
  }
  return serie
}

// -----------------------------------------------------------------------------
//  SERIE JOURNALIERE DES REVENUS (graphique du tableau de bord prive)
// -----------------------------------------------------------------------------

/**
 * Un point de la courbe : un JOUR CIVIL et le total des paiements valides de ce
 * jour, en centimes.
 *
 * `date` est au format `aaaa-mm-jj` (jour civil, sans heure ni fuseau) : le
 * navigateur n'a aucune conversion a faire pour l'afficher, et aucun jour ne
 * peut glisser d'un cran selon le fuseau du poste.
 */
export interface PointJournalier {
  date: string
  montantCentimes: number
}

/**
 * Revenus par jour sur une periode.
 *
 * REGROUPEMENT Fait EN BASE, jamais en memoire.
 *
 *   Le graphique doit rester correct sur une annee entiere : charger tous les
 *   paiements dans le navigateur pour les additionner par jour exposerait
 *   l'historique complet et ferait grossir la reponse sans limite. `GROUP BY`
 *   sur le jour civil rend une ligne par jour AU PLUS — la taille de la serie
 *   est bornee par la duree de la periode, pas par le volume d'encaissements.
 *
 *   La conversion de fuseau suit exactement celle de `tendancesMensuelles` : on
 *   ramene d'abord l'horodatage UTC vers l'heure locale du serveur, puis on
 *   tronque au jour. Sans cette double conversion, un paiement du soir pourrait
 *   etre compte la veille.
 *
 *   Les jours SANS paiement ne sont pas renvoyes par la requete ; l'appelant les
 *   traite comme un trou de la courbe (le graphique relie les points existants).
 */
export async function serieJournaliereRevenus(periode: Periode): Promise<PointJournalier[]> {
  /*
   * FILTRE IDENTIQUE A CELUI DES TOTAUX.
   *
   *   La courbe doit s'additionner EXACTEMENT au total « Paiements reçus »
   *   affiché dans la carte KPI. Elle réutilise donc le même prédicat (`statut`
   *   VALIDE, `syncStatut` VALIDE, période, exclusion de la corbeille) que
   *   `revenusPaiements` ci-dessus, qui reste la référence du calcul.
   *
   * AGRÉGATION EN BASE — PAS DE RAPATRIEMENT.
   *
   *   Avant, la route chargeait TOUS les paiements de la période en mémoire pour
   *   les additionner par jour : une année complète, c'est tout l'historique
   *   côté serveur. Le regroupement est maintenant fait par PostgreSQL
   *   (`GROUP BY` sur le JOUR CIVIL), qui ne renvoie qu'une ligne par jour.
   *
   *   La conversion de fuseau reprend la règle métier du projet : l'horodatage
   *   UTC est ramené à l'heure locale du serveur AVANT d'être tronqué au jour,
   *   sinon un paiement du soir serait compté la veille.
   */
  const idsCorbeille = await idsPaiementsEnCorbeille()
  const exclus =
    idsCorbeille && typeof idsCorbeille === 'object' && 'not' in (idsCorbeille as object)
      ? ((idsCorbeille as { not?: string[] }).not ?? [])
      : []

  const lignes = await prisma.$queryRaw<Array<{ jour: Date; total: bigint | number }>>`
    SELECT (p."datePaiement" AT TIME ZONE 'UTC' AT TIME ZONE current_setting('TimeZone'))::date AS jour,
           SUM(p."montantCentimes")::bigint AS total
      FROM payments p
     WHERE p.statut = 'VALIDE'
       AND p."syncStatut" = 'VALIDE'
       AND p."datePaiement" >= ${periode.debut}
       AND p."datePaiement" <= ${periode.fin}
       ${exclus.length > 0 ? Prisma.sql`AND p.id NOT IN (${Prisma.join(exclus.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
     GROUP BY 1
     ORDER BY 1
  `

  return lignes.map((ligne) => ({
    date: `${ligne.jour.getFullYear()}-${String(ligne.jour.getMonth() + 1).padStart(2, '0')}-${String(
      ligne.jour.getDate(),
    ).padStart(2, '0')}`,
    montantCentimes: Number(ligne.total),
  }))
}

// -----------------------------------------------------------------------------
//  HISTORIQUE DES TRANSACTIONS (pagine)
// -----------------------------------------------------------------------------

export interface TransactionHistorique {
  id: string
  source: 'PAIEMENT_CLINIQUE' | 'REVENU_MANUEL' | 'DEPENSE'
  montantCentimes: number
  date: string
  libelle: string
  categorie: string | null
  createdAt: string
}

export async function historiqueTransactions(
  filtres: { debut?: Date; fin?: Date; page: number; taille: number },
): Promise<{
  elements: TransactionHistorique[]
  total: number
  page: number
  pages: number
  taille: number
}> {
  const taille = Math.min(Math.max(1, filtres.taille), 100)
  const debut = filtres.debut ?? new Date(0)
  const fin = filtres.fin ?? new Date('2999-12-31T23:59:59.999Z')

  // Trois sources, reuni par UNION ALL en base : la pagination reste serveur.
  const idsCorbeille = await idsPaiementsEnCorbeille()
  const exclusCorbeille =
    idsCorbeille && typeof idsCorbeille === 'object' && 'not' in (idsCorbeille as object)
      ? (idsCorbeille as { not: string[] }).not
      : []

  const paiements = await prisma.payment.findMany({
    where: {
      statut: 'VALIDE',
      datePaiement: { gte: debut, lte: fin },
      ...(exclusCorbeille.length > 0 ? { id: { notIn: exclusCorbeille } } : {}),
    },
    orderBy: { datePaiement: 'desc' },
    include: {
      patient: { select: { nom: true, prenom: true } },
      treatment: { select: { typeTraitement: true } },
    },
  })
  const manuels = await prisma.manualIncome.findMany({
    where: { date: { gte: debut, lte: fin } },
    orderBy: { date: 'desc' },
  })
  const depenses = await prisma.expense.findMany({
    where: { date: { gte: debut, lte: fin } },
    orderBy: { date: 'desc' },
  })

  const toutes: TransactionHistorique[] = [
    ...paiements.map((p) => ({
      id: p.id,
      source: 'PAIEMENT_CLINIQUE' as const,
      montantCentimes: p.montantCentimes,
      date: p.datePaiement.toISOString(),
      // ACOMPTES (§paiements-avance) : traitement absent — libellé dédié.
      libelle: p.treatment
        ? `Paiement — ${p.patient.prenom} ${p.patient.nom} (${p.treatment.typeTraitement})`
        : `Acompte — ${p.patient.prenom} ${p.patient.nom}`,
      categorie: null,
      createdAt: p.createdAt.toISOString(),
    })),
    ...manuels.map((m) => ({
      id: m.id,
      source: 'REVENU_MANUEL' as const,
      montantCentimes: m.montantCentimes,
      date: m.date.toISOString(),
      libelle: m.description ?? 'Revenu manuel',
      categorie: m.categorie,
      createdAt: m.createdAt.toISOString(),
    })),
    ...depenses.map((d) => ({
      id: d.id,
      source: 'DEPENSE' as const,
      montantCentimes: d.montantCentimes,
      date: d.date.toISOString(),
      libelle: d.description ?? 'Dépense',
      categorie: d.categorie,
      createdAt: d.createdAt.toISOString(),
    })),
  ]

  toutes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const total = toutes.length
  const pages = Math.max(1, Math.ceil(total / taille))
  const page = Math.min(Math.max(1, filtres.page), pages)
  return {
    elements: toutes.slice((page - 1) * taille, page * taille),
    total,
    page,
    pages,
    taille,
  }
}

// -----------------------------------------------------------------------------
//  REVENUS MANUELS — CRUD
// -----------------------------------------------------------------------------

export interface DonneesRevenuManuel {
  montantCentimes: number
  date: Date
  categorie: string
  description: string | null
  notes: string | null
  idempotencyKey: string
}

export async function creerRevenuManuel(
  donnees: DonneesRevenuManuel,
  contexte: JournalContext,
): Promise<{ id: string; dejaEnregistre: boolean }> {
  if (donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }

  // Anti-doublon par cle d'idempotence : un renvoi du meme formulaire ne cree
  // pas une seconde ligne.
  const existant = await prisma.manualIncome.findUnique({
    where: { idempotencyKey: donnees.idempotencyKey },
    select: { id: true },
  })
  if (existant) return { id: existant.id, dejaEnregistre: true }

  const ligne = await prisma.manualIncome.create({
    data: {
      montantCentimes: donnees.montantCentimes,
      date: donnees.date,
      categorie: donnees.categorie,
      description: donnees.description,
      notes: donnees.notes,
      idempotencyKey: donnees.idempotencyKey,
      createdById: contexte.userId ?? '',
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.REVENU_MANUEL_CREE, {
    entityType: 'ManualIncome',
    entityId: ligne.id,
    metadata: { montantCentimes: donnees.montantCentimes, categorie: donnees.categorie },
  })

  return { id: ligne.id, dejaEnregistre: false }
}

export async function modifierRevenuManuel(
  id: string,
  donnees: Partial<Pick<DonneesRevenuManuel, 'montantCentimes' | 'date' | 'categorie' | 'description' | 'notes'>>,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.manualIncome.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Revenu manuel')

  if (donnees.montantCentimes !== undefined && donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }

  await prisma.manualIncome.update({
    where: { id },
    data: {
      ...(donnees.montantCentimes !== undefined ? { montantCentimes: donnees.montantCentimes } : {}),
      ...(donnees.date !== undefined ? { date: donnees.date } : {}),
      ...(donnees.categorie !== undefined ? { categorie: donnees.categorie } : {}),
      ...(donnees.description !== undefined ? { description: donnees.description } : {}),
      ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
    },
  })

  await journaliser(contexte, ACTIONS.REVENU_MANUEL_MODIFIE, {
    entityType: 'ManualIncome',
    entityId: id,
  })
}

export async function supprimerRevenuManuel(id: string, contexte: JournalContext): Promise<void> {
  const existant = await prisma.manualIncome.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Revenu manuel')

  await prisma.manualIncome.delete({ where: { id } })

  await journaliser(contexte, ACTIONS.REVENU_MANUEL_SUPPRIME, {
    entityType: 'ManualIncome',
    entityId: id,
  })
}

export interface LigneRevenuManuel {
  id: string
  montantCentimes: number
  date: string
  categorie: string
  description: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export async function listerRevenusManuels(filtres: {
  debut?: Date
  fin?: Date
  page: number
  taille?: number
}): Promise<{ elements: LigneRevenuManuel[]; total: number; page: number; pages: number; taille: number }> {
  const taille = Math.min(Math.max(1, filtres.taille ?? DEFAULT_PAGE_SIZE), 100)
  const page = Math.max(1, filtres.page)
  const where: Prisma.ManualIncomeWhereInput = {
    ...(filtres.debut || filtres.fin
      ? { date: { ...(filtres.debut ? { gte: filtres.debut } : {}), ...(filtres.fin ? { lte: filtres.fin } : {}) } }
      : {}),
  }

  const [lignes, total] = await Promise.all([
    prisma.manualIncome.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * taille,
      take: taille,
    }),
    prisma.manualIncome.count({ where }),
  ])

  return {
    elements: lignes.map((l) => ({
      id: l.id,
      montantCentimes: l.montantCentimes,
      date: l.date.toISOString(),
      categorie: l.categorie,
      description: l.description,
      notes: l.notes,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / taille)),
    taille,
  }
}

// -----------------------------------------------------------------------------
//  DEPENSES — CRUD
// -----------------------------------------------------------------------------

/**
 * Categories de depenses proposees par defaut (extensibles).
 *
 * Le medecin saisit un TITRE libre ; la categorie n'est qu'un rangement
 * interne. Un titre inconnu tombe dans `AUTRE` cote service.
 */
export const CATEGORIES_DEPENSE = [
  'EQUIPEMENT',
  'FOURNITURES',
  'LOYER',
  'UTILITES',
  'SALAIRES',
  'MAINTENANCE',
  'AUTRE',
] as const

export interface DonneesDepense {
  /** Titre libre saisi par le medecin (obligatoire). Stocke dans `description`. */
  titre: string
  montantCentimes: number
  date: Date
  /** Rangement interne, deduit du titre si absent. */
  categorie?: string
  notes?: string | null
  idempotencyKey: string
}

export async function creerDepense(
  donnees: DonneesDepense,
  contexte: JournalContext,
): Promise<{ id: string; dejaEnregistre: boolean }> {
  if (donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }

  const existant = await prisma.expense.findUnique({
    where: { idempotencyKey: donnees.idempotencyKey },
    select: { id: true },
  })
  if (existant) return { id: existant.id, dejaEnregistre: true }

  const titre = donnees.titre.trim()
  if (titre.length === 0) throw erreurs.validation('Le titre de la dépense est obligatoire.')
  const categorie = donnees.categorie ?? categorieDepuisTitre(titre)

  const ligne = await prisma.expense.create({
    data: {
      montantCentimes: donnees.montantCentimes,
      date: donnees.date,
      categorie,
      description: titre,
      notes: donnees.notes ?? null,
      idempotencyKey: donnees.idempotencyKey,
      createdById: contexte.userId ?? '',
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.DEPENSE_CREEE, {
    entityType: 'Expense',
    entityId: ligne.id,
    metadata: { montantCentimes: donnees.montantCentimes, categorie },
  })

  return { id: ligne.id, dejaEnregistre: false }
}

export async function modifierDepense(
  id: string,
  donnees: Partial<Pick<DonneesDepense, 'titre' | 'montantCentimes' | 'date' | 'categorie' | 'notes'>>,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.expense.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Dépense')

  if (donnees.montantCentimes !== undefined && donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }

  const titre = donnees.titre?.trim()
  if (titre !== undefined && titre.length === 0) {
    throw erreurs.validation('Le titre de la dépense est obligatoire.')
  }

  await prisma.expense.update({
    where: { id },
    data: {
      ...(donnees.montantCentimes !== undefined ? { montantCentimes: donnees.montantCentimes } : {}),
      ...(donnees.date !== undefined ? { date: donnees.date } : {}),
      ...(titre !== undefined
        ? {
            description: titre,
            categorie: donnees.categorie ?? categorieDepuisTitre(titre),
          }
        : donnees.categorie !== undefined
          ? { categorie: donnees.categorie }
          : {}),
      ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
    },
  })

  await journaliser(contexte, ACTIONS.DEPENSE_MODIFIEE, { entityType: 'Expense', entityId: id })
}

export async function supprimerDepense(id: string, contexte: JournalContext): Promise<void> {
  const existant = await prisma.expense.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Dépense')

  await prisma.expense.delete({ where: { id } })

  await journaliser(contexte, ACTIONS.DEPENSE_SUPPRIMEE, { entityType: 'Expense', entityId: id })
}

export interface LigneDepense {
  id: string
  /** Titre saisi par le medecin (colonne `description` en base, historique). */
  titre: string
  montantCentimes: number
  date: string
  categorie: string
  createdAt: string
  updatedAt: string
}

/** Deduit une categorie de rangement a partir du titre libre saisi. */
export function categorieDepuisTitre(titre: string): string {
  const t = titre.toLowerCase()
  if (/(loyer|location)/.test(t)) return 'LOYER'
  if (/(electricite|eau|gaz|internet|telephone|utilit)/.test(t)) return 'UTILITES'
  if (/(materiel|equipement|fauteuil|radiographie|instrument)/.test(t)) return 'EQUIPEMENT'
  if (/(fourniture|gant|masque|gaze|anesthes)/.test(t)) return 'FOURNITURES'
  if (/(maintenance|reparation|entretien)/.test(t)) return 'MAINTENANCE'
  if (/(salaire|paie|prime)/.test(t)) return 'SALAIRES'
  return 'AUTRE'
}

export async function listerDepenses(filtres: {
  debut?: Date
  fin?: Date
  categorie?: string
  page: number
  taille?: number
}): Promise<{ elements: LigneDepense[]; total: number; page: number; pages: number; taille: number }> {
  const taille = Math.min(Math.max(1, filtres.taille ?? DEFAULT_PAGE_SIZE), 100)
  const page = Math.max(1, filtres.page)
  const where: Prisma.ExpenseWhereInput = {
    ...(filtres.categorie ? { categorie: filtres.categorie } : {}),
    ...(filtres.debut || filtres.fin
      ? { date: { ...(filtres.debut ? { gte: filtres.debut } : {}), ...(filtres.fin ? { lte: filtres.fin } : {}) } }
      : {}),
  }

  const [lignes, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * taille,
      take: taille,
    }),
    prisma.expense.count({ where }),
  ])

  return {
    elements: lignes.map((l) => ({
      id: l.id,
      titre: l.description?.trim() || l.categorie,
      montantCentimes: l.montantCentimes,
      date: l.date.toISOString(),
      categorie: l.categorie,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / taille)),
    taille,
  }
}

// -----------------------------------------------------------------------------
//  LISTES DETAILLEES — TROIS BOITES DU TABLEAU DE BORD SIMPLIFIE
// -----------------------------------------------------------------------------

export interface LignePaiementRecu {
  id: string
  patient: string
  montantCentimes: number
  date: string
  description: string | null
  /** Statut d'encaissement — la colonne « statut » de l'historique. */
  statutPaiement: 'VALIDE'
}

/**
 * Paiements VALIDE de la periode, ligne par ligne (hors corbeille).
 *
 * Chaque paiement est une ligne SEPAREE : les paiements partiels d'un même
 * traitement apparaissent individuellement, avec leur propre date — et le
 * total correspond exactement à `revenusPaiements()` (même filtre, même
 * calendrier). C'est ce qui garantit que la liste « s'additionne » au total
 * affiché dans la boîte verte.
 */
export async function listerPaiementsRecus(filtres: {
  debut: Date
  fin: Date
  page: number
  taille?: number
}): Promise<{ elements: LignePaiementRecu[]; total: number; totalCentimes: number; page: number; pages: number; taille: number }> {
  const taille = Math.min(Math.max(1, filtres.taille ?? DEFAULT_PAGE_SIZE), 100)
  const page = Math.max(1, filtres.page)
  const idsCorbeille = await idsPaiementsEnCorbeille()
  const where: Prisma.PaymentWhereInput = {
    statut: 'VALIDE',
    syncStatut: 'VALIDE',
    datePaiement: { gte: filtres.debut, lte: filtres.fin },
    id: idsCorbeille,
  }

  const [lignes, total, agregat] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { datePaiement: 'desc' },
      skip: (page - 1) * taille,
      take: taille,
      select: {
        id: true,
        montantCentimes: true,
        datePaiement: true,
        notes: true,
        patient: { select: { nom: true, prenom: true } },
        treatment: { select: { typeTraitement: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { montantCentimes: true } }),
  ])

  return {
    elements: lignes.map((l) => ({
      id: l.id,
      patient: `${l.patient.prenom} ${l.patient.nom}`,
      montantCentimes: l.montantCentimes,
      date: l.datePaiement.toISOString(),
      description: l.notes ?? l.treatment?.typeTraitement ?? null,
      statutPaiement: 'VALIDE' as const,
    })),
    total,
    totalCentimes: agregat._sum.montantCentimes ?? 0,
    page,
    pages: Math.max(1, Math.ceil(total / taille)),
    taille,
  }
}

// -----------------------------------------------------------------------------
//  DETAIL D'UN PAIEMENT (panneau lateral du tableau de bord)
// -----------------------------------------------------------------------------

export interface DetailPaiement {
  id: string
  patient: string
  telephone: string | null
  datePaiement: string
  montantCentimes: number
  statut: 'VALIDE' | 'ANNULE'
  notes: string | null
  /**
   * Rendezvous lie. Un acompte n'en a aucun : les champs valent alors `null`.
   * La relation reelle passe par la VISITE (`treatmentVisit.appointment`) quand
   * elle existe ; on ne l'invente jamais a partir d'une date proche.
   */
  rendezVous: { id: string; dateDebut: string; dateFin: string; statut: string } | null
  traitement: {
    id: string
    type: string
    statut: string
    dents: string
    prixTotalCentimes: number
    /** Montant deja regle sur ce traitement (paiements VALIDE, celui-ci inclus). */
    payeCentimes: number
    /** Reste a payer sur ce traitement, jamais negatif. */
    restantCentimes: number
  } | null
  /**
   * Position du PATIENT sur l'ensemble de ses traitements non annules — la meme
   * regle que `totalRestantDu` / `listerDettesPatients` (facture - paye). C'est
   * ce qui donne son sens a un paiement partiel : le solde ne porte pas sur la
   * seule ligne affichee, mais sur ce que le patient doit encore au cabinet.
   */
  patientTotalDuCentimes: number
  patientPayeCentimes: number
  patientRestantCentimes: number
}

/**
 * Detail d'UN paiement, pour le panneau lateral du site financier.
 *
 * LECTURE SEULE. Aucune ecriture, aucune modification de l'existant : on lit
 * les relations deja en place (paiement -> traitement -> patient) et on calcule
 * les soldes en base avec les memes filtres que les autres vues financieres
 * (`statut` VALIDE, `syncStatut` VALIDE).
 *
 * Le moyen de paiement (`methode`) n'est VOLONTAIREMENT PAS selectionne : il
 * ne doit apparaitre nulle part dans l'interface (§demande cabinet).
 */
export async function detailPaiement(id: string): Promise<DetailPaiement> {
  const paiement = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      montantCentimes: true,
      datePaiement: true,
      statut: true,
      notes: true,
      patientId: true,
      treatmentId: true,
      patient: { select: { nom: true, prenom: true, telephone: true } },
      treatment: {
        select: {
          id: true,
          typeTraitement: true,
          statut: true,
          dents: true,
          prixTotalCentimes: true,
        },
      },
      treatmentVisit: { select: { appointment: { select: { id: true, dateDebut: true, dateFin: true, statut: true } } } },
    },
  })

  if (!paiement) throw erreurs.introuvable('Paiement introuvable.')

  const filtreValide = { statut: 'VALIDE', syncStatut: 'VALIDE' } as const

  const [payeTraitement, patient, payePatient] = await Promise.all([
    paiement.treatmentId
      ? prisma.payment.aggregate({
          where: { ...filtreValide, treatmentId: paiement.treatmentId },
          _sum: { montantCentimes: true },
        })
      : Promise.resolve({ _sum: { montantCentimes: 0 } }),
    prisma.treatment.aggregate({
      where: { patientId: paiement.patientId, statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
    }),
    prisma.payment.aggregate({
      where: { ...filtreValide, patientId: paiement.patientId },
      _sum: { montantCentimes: true },
    }),
  ])

  const payeTraitementCentimes = payeTraitement._sum.montantCentimes ?? 0
  const patientTotalDu = patient._sum.prixTotalCentimes ?? 0
  const patientPaye = payePatient._sum.montantCentimes ?? 0

  return {
    id: paiement.id,
    patient: `${paiement.patient.prenom} ${paiement.patient.nom}`,
    telephone: paiement.patient.telephone ?? null,
    datePaiement: paiement.datePaiement.toISOString(),
    montantCentimes: paiement.montantCentimes,
    statut: paiement.statut === 'ANNULE' ? 'ANNULE' : 'VALIDE',
    notes: paiement.notes ?? null,
    rendezVous: paiement.treatmentVisit?.appointment
      ? {
          id: paiement.treatmentVisit.appointment.id,
          dateDebut: paiement.treatmentVisit.appointment.dateDebut.toISOString(),
          dateFin: paiement.treatmentVisit.appointment.dateFin.toISOString(),
          statut: paiement.treatmentVisit.appointment.statut,
        }
      : null,
    traitement: paiement.treatment
      ? {
          id: paiement.treatment.id,
          type: paiement.treatment.typeTraitement,
          statut: paiement.treatment.statut,
          dents: paiement.treatment.dents,
          prixTotalCentimes: paiement.treatment.prixTotalCentimes,
          payeCentimes: payeTraitementCentimes,
          restantCentimes: Math.max(0, paiement.treatment.prixTotalCentimes - payeTraitementCentimes),
        }
      : null,
    patientTotalDuCentimes: patientTotalDu,
    patientPayeCentimes: patientPaye,
    patientRestantCentimes: Math.max(0, patientTotalDu - patientPaye),
  }
}

export interface LigneDettePatient {
  patientId: string
  patient: string
  telephone: string
  resteAPayerCentimes: number
  dernierPaiement: string | null
}

/**
 * Patients qui DOIVENT encore de l'argent au cabinet (solde positif).
 *
 * La règle métier est celle du cabinet : facturé (traitements non ANNULE)
 * moins encaissé (paiements VALIDE), par patient. Le total renvoyé est le
 * solde GLOBAL du cabinet — les dettes ne dépendent PAS de la période
 * regardée (un patient qui doit 5 000 DA aujourd'hui le doit toujours, quelle
 * que soit la fenêtre affichée). Le médecin filtre par « solde positif », pas
 * par date d'écriture : c'est explicité à l'écran.
 *
 * Réutilise la même requête SQL que `rapportSoldesPatients` (reports.service)
 * pour ne JAMAIS diverger des règles existantes — une seule implémentation de
 * « facturé − payé ».
 */
export async function listerDettesPatients(params: {
  page: number
  taille?: number
}): Promise<{ elements: LigneDettePatient[]; total: number; totalCentimes: number; page: number; pages: number; taille: number }> {
  const taille = Math.min(Math.max(1, params.taille ?? DEFAULT_PAGE_SIZE), 100)
  const page = Math.max(1, params.page)

  // Total global dû (pour la boîte orange) : même règle que `totalRestantDu()`,
  // calculée en base sans charger aucune liste.
  const [traitements, paiements] = await Promise.all([
    prisma.treatment.aggregate({
      where: { statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
    }),
    prisma.payment.aggregate({ where: { statut: 'VALIDE' }, _sum: { montantCentimes: true } }),
  ])
  const totalCentimes = Math.max(0, (traitements._sum.prixTotalCentimes ?? 0) - (paiements._sum.montantCentimes ?? 0))

  const comptage = await prisma.$queryRaw<Array<{ total: bigint }>>`
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
  const total = Number(comptage[0]?.total ?? 0n)
  const pages = Math.max(1, Math.ceil(total / taille))
  const pageEffective = Math.min(Math.max(1, page), pages)
  const skip = (pageEffective - 1) * taille

  const lignesPage = await prisma.$queryRaw<
    Array<{ patientId: string; reste: bigint }>
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
    SELECT "patientId", reste
    FROM soldes
    WHERE reste > 0
    ORDER BY reste DESC, "patientId" ASC
    LIMIT ${taille} OFFSET ${skip}
  `

  // Identités + dernier paiement VALIDE de chaque patient de la page.
  const ids = lignesPage.map((l) => l.patientId)
  const [patients, derniersPaiements] = await Promise.all([
    prisma.patient.findMany({
      where: { id: { in: ids } },
      select: { id: true, nom: true, prenom: true, telephone: true },
    }),
    prisma.payment.groupBy({
      by: ['patientId'],
      where: { patientId: { in: ids }, statut: 'VALIDE' },
      _max: { datePaiement: true },
    }),
  ])
  const patientsMap = new Map(patients.map((p) => [p.id, p]))
  const derniersMap = new Map(derniersPaiements.map((d) => [d.patientId, d._max.datePaiement]))

  const elements: LigneDettePatient[] = lignesPage.flatMap((ligne) => {
    const patient = patientsMap.get(ligne.patientId)
    if (!patient) return []
    const dernier = derniersMap.get(ligne.patientId)
    return [
      {
        patientId: patient.id,
        patient: `${patient.prenom} ${patient.nom}`,
        telephone: patient.telephone,
        resteAPayerCentimes: Number(ligne.reste),
        dernierPaiement: dernier ? dernier.toISOString() : null,
      },
    ]
  })

  return { elements, total, totalCentimes, page: pageEffective, pages, taille }
}

// -----------------------------------------------------------------------------
//  AUTHENTIFICATION FINANCIERE (connexion dediee)
// -----------------------------------------------------------------------------

export interface ContexteRequeteFinancier {
  ipAddress: string | null
  userAgent: string | null
}

const MESSAGE_ECHEC_GENERIQUE =
  'Identifiants incorrects. Vérifiez votre email et votre mot de passe.'

/**
 * Connexion au site financier.
 *
 * Reutilise la verification Argon2id et la protection anti-force brute de
 * l'application clinique, mais cree une session DEDIEE (`finance_sessions`) :
 * la session du tableau de bord clinique ne donne JAMAIS acces au site
 * financier, et reciproquement.
 *
 * Seul le role MEDECIN actif est accepte : aucun autre compte ne peut ouvrir
 * une session financiere, meme avec des identifiants valides.
 */
export async function connexionFinanciere(
  email: string,
  password: string,
  contexte: ContexteRequeteFinancier,
): Promise<{
  utilisateur: { id: string; email: string; displayName: string }
  jeton: string
  csrfToken: string
}> {
  const { verifyPassword } = await import('@backend/auth/password')
  const { checkLoginAllowed, recordLoginAttempt, registerFailedLogin, registerSuccessfulLogin } =
    await import('@backend/auth/login-throttle')

  const ip = contexte.ipAddress ?? 'inconnue'

  const throttle = await checkLoginAllowed(email, ip)
  if (!throttle.autorise) {
    await recordLoginAttempt({
      email,
      ipAddress: ip,
      successful: false,
      failureReason: throttle.raison === 'IP_LIMIT' ? 'IP_LIMIT' : 'COMPTE_VERROUILLE',
    })
    if (throttle.raison === 'IP_LIMIT') throw erreurs.tropDeRequetes()
    throw erreurs.compteVerrouille(15)
  }

  const utilisateur = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  })

  // Hachage factice pour garder un temps de reponse comparable (anti-canal
  // temporel), comme dans auth.service.
  const hashFactice =
    '$argon2id$v=19$m=19456,t=2,p=1$c2FoZWQtc2VudGluZWwtZHVtbXk$3N0qBq0AV2q6ZBjKQyq1lF8xW2m1XqkV5yZ4wG7bH8c'
  const motDePasseValide = await verifyPassword(utilisateur?.passwordHash ?? hashFactice, password)

  if (!utilisateur || !utilisateur.isActive || !motDePasseValide || utilisateur.role !== 'MEDECIN') {
    await registerFailedLogin(utilisateur?.id ?? null)
    await recordLoginAttempt({
      email,
      ipAddress: ip,
      successful: false,
      failureReason: utilisateur?.role !== 'MEDECIN' ? 'ROLE_NON_AUTORISE' : 'IDENTIFIANTS',
    })
    throw erreurs.validation(MESSAGE_ECHEC_GENERIQUE)
  }

  await registerSuccessfulLogin(utilisateur.id)
  await recordLoginAttempt({ email, ipAddress: ip, successful: true })

  const { creerSessionFinanciere } = await import('@backend/auth/finance-session')
  const { jeton, csrfToken } = await creerSessionFinanciere(utilisateur.id, {
    ipAddress: contexte.ipAddress,
    userAgent: contexte.userAgent,
  })

  await journaliser(
    {
      userId: utilisateur.id,
      userEmail: utilisateur.email,
      ipAddress: contexte.ipAddress,
      userAgent: contexte.userAgent,
    },
    ACTIONS.CONNEXION_FINANCIERE,
  )

  return {
    utilisateur: {
      id: utilisateur.id,
      email: utilisateur.email,
      displayName: utilisateur.displayName,
    },
    jeton,
    csrfToken,
  }
}

/** Deconnexion financiere : revoque la session dediee. */
export async function deconnexionFinanciere(
  sessionId: string,
  contexte: { userId: string; userEmail: string; ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  const { revokeSessionFinanciere } = await import('@backend/auth/finance-session')
  await revokeSessionFinanciere(sessionId, 'Déconnexion volontaire (espace financier).')

  await journaliser(contexte, ACTIONS.DECONNEXION_FINANCIERE)
}
