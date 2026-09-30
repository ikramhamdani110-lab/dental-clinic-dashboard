import type { TypeEntiteSupprimable } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE, TRASH_WINDOW_MS } from '@backend/domain/constants'
import { AppError, erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { logger } from '@backend/logging/logger'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  CORBEILLE — FENETRE DE RESTAURATION DE 24 HEURES EXACTES (§23)
 * =============================================================================
 *
 *  Regles imperatives :
 *
 *   1. La suppression est LOGIQUE : l'element disparait des vues normales mais
 *      reste en base, restauration possible.
 *
 *   2. La fenetre est de 24 HEURES. Ni 90 jours, ni 30 jours. Ce n'est pas une
 *      valeur configurable : `TRASH_WINDOW_MS` est une constante du domaine, et
 *      une contrainte CHECK en base l'impose
 *      (`trash_entries_fenetre_24h_check` : expireLe = supprimeLe + 24h).
 *
 *   3. `expireLe` est calcule et ECRIT COTE SERVEUR. Le minuteur de l'interface
 *      n'est qu'un affichage : il n'a aucune autorite. Toute restauration est
 *      revalidee serveur en comparant `expireLe` a l'heure courante.
 *
 *   4. La suppression ne detruit JAMAIS de donnees liees. Supprimer un
 *      rendez-vous ne supprime ni le traitement, ni le paiement, ni le dossier
 *      medical associes (§49).
 *
 *  Chaque type d'entite dispose d'une politique de suppression et de
 *  restauration explicite, decrite ci-dessous.
 */

/** Description lisible d'une entite supprimee, pour l'affichage en Corbeille. */
export interface EntreeCorbeille {
  id: string
  entityType: TypeEntiteSupprimable
  description: string
  supprimePar: string | null
  supprimeLe: Date
  expireLe: Date
  tempsRestantMs: number
}

/**
 * Calcule la date d'expiration. Un SEUL endroit produit cette valeur, ce qui
 * garantit qu'elle vaut toujours exactement 24 heures apres la suppression.
 */
export function calculerExpiration(supprimeLe: Date = new Date()): Date {
  return new Date(supprimeLe.getTime() + TRASH_WINDOW_MS)
}

/** Indique si une entree est encore restaurable. */
export function estRestaurable(expireLe: Date, maintenant: Date = new Date()): boolean {
  return expireLe.getTime() > maintenant.getTime()
}

/**
 * Politiques de suppression, par type d'entite.
 *
 * `suppressionLogique` : marque l'entite supprimee SANS destruction, en
 * renseignant le snapshot necessaire a la restauration.
 *
 * IMPORTANT : ces fonctions ne touchent QUE l'entite visee. Elles ne cascade
 * jamais vers les donnees medicales ou financieres liees.
 */
interface PolitiqueSuppression {
  /** Table Prisma concernee. */
  modele:
    | 'patient'
    | 'appointment'
    | 'treatment'
    | 'treatmentVisit'
    | 'payment'
    | 'medicalRecord'
    | 'prescription'
    | 'document'
    | 'odontogramEntry'
  /** Produit la description affichee dans la Corbeille. */
  decrire: (entite: Record<string, unknown>) => string
}

const POLITIQUES: Record<TypeEntiteSupprimable, PolitiqueSuppression> = {
  PATIENT: {
    modele: 'patient',
    decrire: (e) => `Patient : ${String(e.nom ?? '')} ${String(e.prenom ?? '')}`.trim(),
  },
  RENDEZ_VOUS: {
    modele: 'appointment',
    decrire: (e) => `Rendez-vous du ${formaterDate(e.dateDebut as Date)}`,
  },
  TRAITEMENT: {
    modele: 'treatment',
    decrire: (e) => `Traitement : ${String(e.typeTraitement ?? '')}`,
  },
  VISITE_TRAITEMENT: {
    modele: 'treatmentVisit',
    decrire: (e) => `Visite de traitement n°${String(e.numeroSeance ?? '')}`,
  },
  PAIEMENT: {
    modele: 'payment',
    decrire: (e) => `Paiement du ${formaterDate(e.datePaiement as Date)}`,
  },
  DOSSIER_MEDICAL: {
    modele: 'medicalRecord',
    decrire: (e) => `Dossier medical du ${formaterDate(e.date as Date)}`,
  },
  ORDONNANCE: {
    modele: 'prescription',
    decrire: (e) => `Ordonnance du ${formaterDate(e.date as Date)}`,
  },
  DOCUMENT: {
    modele: 'document',
    decrire: (e) => `Document : ${String(e.nomOriginal ?? '')}`,
  },
  ENTREE_ODONTOGRAMME: {
    modele: 'odontogramEntry',
    decrire: (e) => `Dent ${String(e.numeroDent ?? '')} : ${String(e.etat ?? '')}`,
  },
}

/**
 * Retourne la politique d'un type d'entite.
 * Le compilateur garantit l'exhaustivite : `POLITIQUES` couvre TOUS les membres
 * de `TypeEntiteSupprimable`. Le garde-fou protege contre une future valeur
 * d'enum ajoutee sans politique correspondante.
 */
function politiqueDe(type: TypeEntiteSupprimable): PolitiqueSuppression {
  const politique = POLITIQUES[type]
  if (!politique) throw new Error(`Aucune politique de suppression pour : ${String(type)}`)
  return politique
}

function formaterDate(valeur: Date | string | undefined): string {
  if (!valeur) return '(date inconnue)'
  const date = valeur instanceof Date ? valeur : new Date(valeur)
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Place une entite dans la Corbeille.
 *
 * Le snapshot est le contenu COMPLET de l'entite au moment de la suppression :
 * il permet une restauration fidele, meme si d'autres modifications sont
 * survenues entre-temps.
 */
export async function mettreEnCorbeille(
  type: TypeEntiteSupprimable,
  entityId: string,
  contexte: JournalContext,
): Promise<{ id: string; expireLe: Date }> {
  const politique = politiqueDe(type)

  // Lecture de l'entite pour construire la description et le snapshot.
  const entite = await lireEntite(politique.modele, entityId)
  if (!entite) throw erreurs.introuvable('Element')

  const supprimeLe = new Date()
  const expireLe = calculerExpiration(supprimeLe)

  // Une entree existante (deja supprimee) est mise a jour : l'unicite
  // (entityType, entityId) est garantie en base.
  const entree = await prisma.trashEntry.upsert({
    where: { entityType_entityId: { entityType: type, entityId } },
    create: {
      entityType: type,
      entityId,
      description: politique.decrire(entite),
      snapshot: JSON.stringify(entite),
      supprimeParId: contexte.userId,
      supprimeLe,
      expireLe,
    },
    update: {
      description: politique.decrire(entite),
      snapshot: JSON.stringify(entite),
      supprimeParId: contexte.userId,
      supprimeLe,
      expireLe,
      restaureLe: null,
      restaureParId: null,
      supprimeDefinitivementLe: null,
      supprimeDefinitivementParId: null,
    },
  })

  await journaliser(contexte, actionSuppression(type), {
    entityType: type,
    entityId,
    metadata: { description: politique.decrire(entite) },
  })

  return { id: entree.id, expireLe }
}

/** Action journalisee correspondant a une suppression. */
function actionSuppression(type: TypeEntiteSupprimable): (typeof ACTIONS)[keyof typeof ACTIONS] {
  switch (type) {
    case 'PATIENT':
      return ACTIONS.PATIENT_SUPPRIME
    case 'RENDEZ_VOUS':
      return ACTIONS.RENDEZ_VOUS_SUPPRIME
    case 'TRAITEMENT':
      return ACTIONS.TRAITEMENT_SUPPRIME
    case 'VISITE_TRAITEMENT':
      return ACTIONS.VISITE_SUPPRIMEE
    case 'PAIEMENT':
      return ACTIONS.PAIEMENT_SUPPRIME
    case 'DOSSIER_MEDICAL':
      return ACTIONS.DOSSIER_MEDICAL_SUPPRIME
    case 'ORDONNANCE':
      return ACTIONS.ORDONNANCE_SUPPRIMEE
    case 'DOCUMENT':
      return ACTIONS.DOCUMENT_SUPPRIME
    case 'ENTREE_ODONTOGRAMME':
      return ACTIONS.ODONTOGRAMME_SUPPRIME
  }
  // Exhaustivite : le compilateur garantit que tous les cas sont traites. Ce
  // garde-fou protege contre l'ajout futur d'un type sans mise a jour ici.
  throw new Error(`Type d'entite inconnu : ${String(type)}`)
}

/** Action journalisee correspondant a une restauration. */
function actionRestauration(type: TypeEntiteSupprimable): (typeof ACTIONS)[keyof typeof ACTIONS] {
  switch (type) {
    case 'PATIENT':
      return ACTIONS.PATIENT_RESTAURE
    case 'RENDEZ_VOUS':
      return ACTIONS.RENDEZ_VOUS_RESTAURE
    case 'TRAITEMENT':
      return ACTIONS.TRAITEMENT_RESTAURE
    case 'VISITE_TRAITEMENT':
      return ACTIONS.VISITE_RESTAUREE
    case 'PAIEMENT':
      return ACTIONS.PAIEMENT_RESTAURE
    case 'DOSSIER_MEDICAL':
      return ACTIONS.DOSSIER_MEDICAL_RESTAURE
    case 'ORDONNANCE':
      return ACTIONS.ORDONNANCE_RESTAUREE
    case 'DOCUMENT':
      return ACTIONS.DOCUMENT_RESTAURE
    case 'ENTREE_ODONTOGRAMME':
      return ACTIONS.ODONTOGRAMME_RESTAURE
  }
  throw new Error(`Type d'entite inconnu : ${String(type)}`)
}

// -----------------------------------------------------------------------------
//  ACCES AUX MODELES — typage explicite, pas de Prisma dynamique non verifie
// -----------------------------------------------------------------------------

type Modele = PolitiqueSuppression['modele']

/** Lecture d'une entite brute, selon son modele. */
async function lireEntite(modele: Modele, id: string): Promise<Record<string, unknown> | null> {
  switch (modele) {
    case 'patient':
      return (await prisma.patient.findUnique({ where: { id } })) as Record<string, unknown> | null
    case 'appointment':
      return (await prisma.appointment.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
    case 'treatment':
      return (await prisma.treatment.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
    case 'treatmentVisit':
      return (await prisma.treatmentVisit.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
    case 'payment':
      return (await prisma.payment.findUnique({ where: { id } })) as Record<string, unknown> | null
    case 'medicalRecord':
      return (await prisma.medicalRecord.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
    case 'prescription':
      return (await prisma.prescription.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
    case 'document':
      return (await prisma.document.findUnique({ where: { id } })) as Record<string, unknown> | null
    case 'odontogramEntry':
      return (await prisma.odontogramEntry.findUnique({ where: { id } })) as Record<
        string,
        unknown
      > | null
  }
}

/**
 * Identifiants des entites actuellement en corbeille, pour un type donne.
 *
 * MODELE DE SUPPRESSION LOGIQUE
 *   Le schema ne comporte pas de colonne `supprimeLe` sur chaque entite : la
 *   suppression logique est portee UNIQUEMENT par une entree ACTIVE dans
 *   `trash_entries`. Une entite est donc consideree « supprimee » si et
 *   seulement si elle possede une entree de corbeille non restauree, non
 *   supprimee definitivement, et dont la fenetre de 24 h n'est pas ecoulee.
 *
 *   Chaque service de liste applique `filtreExclusion(type)` pour exclure ces
 *   identifiants. Supprimer et restaurer ne fait qu'ecrire dans cette table :
 *   aucune donnee liee n'est jamais touchee.
 */
export async function identifiantsEnCorbeille(type: TypeEntiteSupprimable): Promise<string[]> {
  const entrees = await prisma.trashEntry.findMany({
    where: {
      entityType: type,
      restaureLe: null,
      supprimeDefinitivementLe: null,
      expireLe: { gt: new Date() },
    },
    select: { entityId: true },
  })
  return entrees.map((entree) => entree.entityId)
}

/**
 * Filtre Prisma a ajouter a toute requete de liste :
 * `id: { notIn: await identifiantsEnCorbeille(type) }`.
 */
export async function filtreExclusion(type: TypeEntiteSupprimable): Promise<{ notIn: string[] }> {
  const ids = await identifiantsEnCorbeille(type)
  return { notIn: ids }
}

// -----------------------------------------------------------------------------
//  CONSULTATION DE LA CORBEILLE
// -----------------------------------------------------------------------------

/**
 * Liste PAGINEE des elements restaurables (fenetre de 24 h non ecoulee).
 *
 * La fenetre de restauration reste de 24 heures : c'est une regle du domaine,
 * inchangee. En revanche, le NOMBRE d'elements supprimes pendant ces 24 heures
 * n'est borne par rien (une suppression groupee peut en creer des centaines).
 * La liste est donc paginee COTE SERVEUR : seules les entrees de la page
 * demandee sont lues en base, jamais l'integralite de la Corbeille (§35).
 *
 * `tempsRestantMs` est calcule SERVEUR : le minuteur de l'interface n'a aucune
 * autorite sur la decision de restauration (§23).
 */
export async function listerCorbeille(
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<EntreeCorbeille>> {
  const maintenant = new Date()

  const where = {
    restaureLe: null,
    supprimeDefinitivementLe: null,
    expireLe: { gt: maintenant },
  }
  const { skip, take } = bornesPrisma(pagination)

  const [entrees, total] = await Promise.all([
    prisma.trashEntry.findMany({
      where,
      // Tri deterministe : a date de suppression egale, l'identifiant tranche.
      orderBy: [{ supprimeLe: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: { supprimePar: { select: { displayName: true, email: true } } },
    }),
    prisma.trashEntry.count({ where }),
  ])

  const elements: EntreeCorbeille[] = entrees.map((entree) => ({
    id: entree.id,
    entityType: entree.entityType,
    description: entree.description,
    supprimePar: entree.supprimePar?.displayName ?? entree.supprimePar?.email ?? null,
    supprimeLe: entree.supprimeLe,
    expireLe: entree.expireLe,
    tempsRestantMs: Math.max(0, entree.expireLe.getTime() - maintenant.getTime()),
  }))

  return construirePage(elements, total, pagination)
}

/** Liste PAGINEE des elements deja expires (lecture seule, action impossible). */
export async function listerExpires(
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<EntreeCorbeille>> {
  const maintenant = new Date()

  const where = {
    restaureLe: null,
    supprimeDefinitivementLe: null,
    expireLe: { lte: maintenant },
  }
  const { skip, take } = bornesPrisma(pagination)

  const [entrees, total] = await Promise.all([
    prisma.trashEntry.findMany({
      where,
      orderBy: [{ expireLe: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: { supprimePar: { select: { displayName: true, email: true } } },
    }),
    prisma.trashEntry.count({ where }),
  ])

  const elements: EntreeCorbeille[] = entrees.map((entree) => ({
    id: entree.id,
    entityType: entree.entityType,
    description: entree.description,
    supprimePar: entree.supprimePar?.displayName ?? entree.supprimePar?.email ?? null,
    supprimeLe: entree.supprimeLe,
    expireLe: entree.expireLe,
    tempsRestantMs: 0,
  }))

  return construirePage(elements, total, pagination)
}

// -----------------------------------------------------------------------------
//  RESTAURATION
// -----------------------------------------------------------------------------

/**
 * Restaure un element.
 *
 * REVALIDATION SERVEUR OBLIGATOIRE : meme si l'interface affichait encore du
 * temps restant, la decision est prise ici, en comparant `expireLe` a l'heure
 * serveur. Le minuteur du navigateur n'a aucune autorite (§23, §38).
 */
export async function restaurer(entreeId: string, contexte: JournalContext): Promise<void> {
  const entree = await prisma.trashEntry.findUnique({ where: { id: entreeId } })
  if (!entree) throw erreurs.introuvable('Element de la Corbeille')

  if (entree.restaureLe || entree.supprimeDefinitivementLe) {
    throw erreurs.conflit('Cet element a deja ete traite.')
  }

  // ---- VERIFICATION SERVEUR DE LA FENETRE DE 24 HEURES ----
  if (!estRestaurable(entree.expireLe)) {
    throw erreurs.corbeilleExpiree()
  }

  await prisma.trashEntry.update({
    where: { id: entreeId },
    data: { restaureLe: new Date(), restaureParId: contexte.userId },
  })

  await journaliser(contexte, actionRestauration(entree.entityType), {
    entityType: entree.entityType,
    entityId: entree.entityId,
    metadata: { description: entree.description },
  })
}

// -----------------------------------------------------------------------------
//  SUPPRESSION DEFINITIVE
// -----------------------------------------------------------------------------

/**
 * Politiques de suppression DEFINITIVE, par type.
 *
 * REGLE DE REFERENTIAL INTEGRITE (§23, §49) : la suppression definitive d'une
 * entite ne detruit jamais les donnees medicales ou financieres liees.
 *
 *   - Un PATIENT ne peut pas etre supprime definitivement s'il possede des
 *     traitements ou des paiements : l'historique financier doit etre conserve.
 *     (Les autres donnees du patient, elles, suivent la suppression en cascade
 *     prevue par le schema pour ses dossiers/ordonnances/documents.)
 *
 *   - Un PAIEMENT ne peut PAS etre supprime definitivement : c'est un evenement
 *     financier. Il se corrige par contre-passation, jamais par destruction.
 *     Cette fonction est donc interdite pour ce type.
 *
 *   - Un TRAITEMENT ne peut pas etre supprime definitivement s'il a des
 *     paiements lies.
 */
export async function supprimerDefinitivement(
  entreeId: string,
  contexte: JournalContext,
): Promise<void> {
  const entree = await prisma.trashEntry.findUnique({ where: { id: entreeId } })
  if (!entree) throw erreurs.introuvable('Element de la Corbeille')

  if (entree.restaureLe || entree.supprimeDefinitivementLe) {
    throw erreurs.conflit('Cet element a deja ete traite.')
  }

  // Une entree encore restaurable ne peut pas etre supprimee definitivement par
  // ce chemin : elle doit d'abord expirer, ou etre restauree. Cela evite une
  // destruction accidentelle alors que la restauration reste possible.
  if (estRestaurable(entree.expireLe)) {
    throw erreurs.conflit(
      "Cet element est encore restaurable. Attendez l'expiration des 24 heures ou restaurez-le.",
    )
  }

  await executerSuppressionDefinitive(entree.entityType, entree.entityId)

  await prisma.trashEntry.update({
    where: { id: entreeId },
    data: {
      supprimeDefinitivementLe: new Date(),
      supprimeDefinitivementParId: contexte.userId,
    },
  })

  await journaliser(contexte, ACTIONS.SUPPRESSION_DEFINITIVE, {
    entityType: entree.entityType,
    entityId: entree.entityId,
    metadata: { description: entree.description },
  })
}

/** Applique la suppression definitive selon la politique du type d'entite. */
async function executerSuppressionDefinitive(
  type: TypeEntiteSupprimable,
  entityId: string,
): Promise<void> {
  switch (type) {
    case 'PAIEMENT':
      // Interdit : un paiement est un evenement financier historique.
      throw erreurs.conflit(
        'Un paiement ne peut pas etre supprime definitivement. Utilisez la correction ou l’annulation, qui conserve l’historique.',
      )

    case 'PATIENT': {
      const [traitements, paiements] = await Promise.all([
        prisma.treatment.count({ where: { patientId: entityId } }),
        prisma.payment.count({ where: { patientId: entityId } }),
      ])
      if (traitements > 0 || paiements > 0) {
        throw erreurs.conflit(
          "Ce patient possede des traitements ou des paiements. L'historique medical et financier ne peut pas etre detruit.",
        )
      }
      await prisma.patient.delete({ where: { id: entityId } })
      return
    }

    case 'TRAITEMENT': {
      const paiements = await prisma.payment.count({ where: { treatmentId: entityId } })
      if (paiements > 0) {
        throw erreurs.conflit(
          "Ce traitement possede des paiements. L'historique financier ne peut pas etre detruit.",
        )
      }
      // Les visites suivent la suppression (cascade declaree dans le schema).
      await prisma.treatment.delete({ where: { id: entityId } })
      return
    }

    case 'RENDEZ_VOUS':
      // Supprimer un rendez-vous ne touche NI le traitement NI le paiement :
      // la visite liee voit seulement son `appointmentId` mis a null (SetNull).
      await prisma.appointment.delete({ where: { id: entityId } })
      return

    case 'VISITE_TRAITEMENT':
      await prisma.treatmentVisit.delete({ where: { id: entityId } })
      return

    case 'DOSSIER_MEDICAL':
      await prisma.medicalRecord.delete({ where: { id: entityId } })
      return

    case 'ORDONNANCE':
      // Les lignes suivent (cascade declaree dans le schema).
      await prisma.prescription.delete({ where: { id: entityId } })
      return

    case 'DOCUMENT':
      await prisma.document.delete({ where: { id: entityId } })
      return

    case 'ENTREE_ODONTOGRAMME':
      await prisma.odontogramEntry.delete({ where: { id: entityId } })
      return
  }
}

// -----------------------------------------------------------------------------
//  ENTRETIEN PERIODIQUE
// -----------------------------------------------------------------------------

/**
 * Purge les elements expires selon leur politique.
 *
 * Cette fonction est appelee par un script d'entretien (cron ou planificateur
 * systeme). L'expiration est DECIDEE PAR LE SERVEUR, jamais par le navigateur.
 * Une entite dont la suppression definitive est interdite (paiement, patient
 * avec historique) est laissee en place : l'historique prime.
 */
export async function purgerExpires(): Promise<{
  supprimes: number
  ignores: number
  echecs: number
}> {
  const maintenant = new Date()
  const entrees = await prisma.trashEntry.findMany({
    where: {
      restaureLe: null,
      supprimeDefinitivementLe: null,
      expireLe: { lte: maintenant },
    },
    take: 200,
  })

  let supprimes = 0
  let ignores = 0
  let echecs = 0

  for (const entree of entrees) {
    try {
      await executerSuppressionDefinitive(entree.entityType, entree.entityId)
      await prisma.trashEntry.update({
        where: { id: entree.id },
        data: { supprimeDefinitivementLe: maintenant, supprimeDefinitivementParId: null },
      })
      supprimes += 1
    } catch (erreur) {
      // Deux cas distincts :
      //   - refus volontaire (CONTRAINTE_HISTORIQUE : un CONFLIT applicatif) :
      //     l'historique est protege, l'entree reste. C'est attendu.
      //   - erreur inattendue (base indisponible, etc.) : a signaler.
      if (erreur instanceof AppError && erreur.code === 'CONFLIT') {
        ignores += 1
      } else {
        echecs += 1
        logger.error('Echec de suppression definitive en Corbeille', {
          trashEntryId: entree.id,
          entityType: entree.entityType,
          erreur,
        })
      }
    }
  }

  return { supprimes, ignores, echecs }
}
