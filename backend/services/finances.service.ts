import type { Prisma } from '@prisma/client'

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

export function periodeAnnee(annee: number): Periode {
  const debut = new Date(annee, 0, 1, 0, 0, 0, 0)
  const fin = new Date(annee, 11, 31, 23, 59, 59, 999)
  return { debut, fin }
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
//  REVENU MANUEL
// -----------------------------------------------------------------------------

/** Total des revenus manuels sur la periode. */
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
  /** Nombre de paiements clinique VALIDE de la periode. */
  nombrePaiements: number
  /** Somme des revenus manuels de la periode (source : `manual_incomes`). */
  revenusManuelsCentimes: number
  /** Somme des depenses de la periode (source : `expenses`). */
  depensesCentimes: number
  /**
   * SOLDE NET = revenusPaiements + revenusManuels - depenses.
   * Les montants restant dus par les patients n'y entrent JAMAIS.
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
}

export async function syntheseFinanciere(periode: Periode): Promise<SyntheseFinanciere> {
  const [revenusPai, revenusMan, depenses, restantDu, nombre] = await Promise.all([
    revenusPaiements(periode.debut, periode.fin),
    revenusManuels(periode.debut, periode.fin),
    totalDepenses(periode.debut, periode.fin),
    totalRestantDu(),
    nombrePaiements(periode.debut, periode.fin),
  ])

  return {
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    revenusPaiementsCentimes: revenusPai,
    nombrePaiements: nombre,
    revenusManuelsCentimes: revenusMan,
    depensesCentimes: depenses,
    soldeNetCentimes: revenusPai + revenusMan - depenses,
    restantDuCentimes: restantDu,
    mention:
      "Synthèse fondée sur les écritures enregistrées (paiements clinique, revenus manuels, dépenses saisies) — et non sur la position comptable complète du cabinet.",
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

/** Categories de depenses proposees par defaut (extensibles). */
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
  montantCentimes: number
  date: Date
  categorie: string
  description: string | null
  notes: string | null
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

  const ligne = await prisma.expense.create({
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

  await journaliser(contexte, ACTIONS.DEPENSE_CREEE, {
    entityType: 'Expense',
    entityId: ligne.id,
    metadata: { montantCentimes: donnees.montantCentimes, categorie: donnees.categorie },
  })

  return { id: ligne.id, dejaEnregistre: false }
}

export async function modifierDepense(
  id: string,
  donnees: Partial<Pick<DonneesDepense, 'montantCentimes' | 'date' | 'categorie' | 'description' | 'notes'>>,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.expense.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Dépense')

  if (donnees.montantCentimes !== undefined && donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }

  await prisma.expense.update({
    where: { id },
    data: {
      ...(donnees.montantCentimes !== undefined ? { montantCentimes: donnees.montantCentimes } : {}),
      ...(donnees.date !== undefined ? { date: donnees.date } : {}),
      ...(donnees.categorie !== undefined ? { categorie: donnees.categorie } : {}),
      ...(donnees.description !== undefined ? { description: donnees.description } : {}),
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
  montantCentimes: number
  date: string
  categorie: string
  description: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
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
//  LISTES DETAILLEES — TROIS BOITES DU TABLEAU DE BORD SIMPLIFIE
// -----------------------------------------------------------------------------

export interface LignePaiementRecu {
  id: string
  patient: string
  montantCentimes: number
  date: string
  description: string | null
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
    })),
    total,
    totalCentimes: agregat._sum.montantCentimes ?? 0,
    page,
    pages: Math.max(1, Math.ceil(total / taille)),
    taille,
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
