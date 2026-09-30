import type { EtatDent } from '@prisma/client'
import { Prisma } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { FDI_PERMANENTE, FDI_TEMPORAIRE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion, identifiantsEnCorbeille } from '@backend/services/trash.service'

/**
 * Nombre maximal d'entrees d'historique chargees pour un patient.
 *
 * L'odontogramme n'est PAS une liste paginee : c'est une structure a 32 dents
 * dont l'interface a besoin en entier pour dessiner les arcades. En revanche,
 * l'HISTORIQUE complet par dent peut croitre sans limite au fil des annees.
 * L'etat courant de chaque dent reste exact (requete dediee « derniere entree
 * par dent »), tandis que l'historique detaille renvoye est borne a ce nombre
 * d'entrees recentes (§35).
 */
const HISTORIQUE_ODONTOGRAMME_MAX = 500

/**
 * =============================================================================
 *  SERVICE ODONTOGRAMME FDI (§20)
 * =============================================================================
 *
 *  L'odontogramme represente l'etat des dents. Chaque changement est une NOUVELLE
 *  ENTREE, jamais une ecrasement de l'etat precedent : une dent peut avoir
 *  plusieurs traitements au fil du temps, et cet historique doit rester
 *  consultable.
 *
 *  L'etat COURANT d'une dent est la derniere entree par date.
 */

export interface EntreeOdontogramme {
  id: string
  patientId: string
  treatmentId: string | null
  numeroDent: string
  etat: EtatDent
  commentaire: string | null
  date: Date
  createdAt: Date
}

/**
 * Historique des entrees d'odontogramme d'un patient.
 *
 * La requete est BORNEE EN BASE (§35) : au fil des annees, un patient peut
 * cumuler un grand nombre de changements d'etat. Seules les
 * `HISTORIQUE_ODONTOGRAMME_MAX` entrees les plus recentes sont lues. L'etat
 * courant de chaque dent, lui, n'est jamais tronque : il est calcule a partir
 * d'une requete dediee « derniere entree par dent » (voir `etatCourantPatient`).
 */
export async function listerEntreesPatient(patientId: string): Promise<EntreeOdontogramme[]> {
  const idsEnCorbeille = await filtreExclusion('ENTREE_ODONTOGRAMME')

  const lignes = await prisma.odontogramEntry.findMany({
    where: { patientId, id: idsEnCorbeille },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: HISTORIQUE_ODONTOGRAMME_MAX,
  })

  return lignes.map((ligne) => ({
    id: ligne.id,
    patientId: ligne.patientId,
    treatmentId: ligne.treatmentId,
    numeroDent: ligne.numeroDent,
    etat: ligne.etat,
    commentaire: ligne.commentaire,
    date: ligne.date,
    createdAt: ligne.createdAt,
  }))
}

/**
 * Etat COURANT de chaque dent : la derniere entree connue par numero de dent.
 *
 * Requete SQL « DISTINCT ON » : la base renvoie AU PLUS une ligne par dent, ce
 * qui borne le resultat a 32 lignes (denture permanente) quel que soit le
 * volume d'historique accumule. L'etat affiche est donc toujours exact, meme
 * lorsque l'historique detaille est borne.
 */
async function etatCourantPatient(patientId: string): Promise<EntreeOdontogramme[]> {
  const idsEnCorbeille = await identifiantsEnCorbeille('ENTREE_ODONTOGRAMME')

  type LigneOdontogramme = {
    id: string
    patientId: string
    treatmentId: string | null
    numeroDent: string
    etat: EntreeOdontogramme['etat']
    commentaire: string | null
    date: Date
    createdAt: Date
  }

  // `Prisma.join` refuse un tableau VIDE (« Expected `join([])` to be called with
  // an array of multiple elements »). Or la Corbeille est le plus souvent vide :
  // le cas « aucun identifiant a exclure » est le cas NORMAL, pas l'exception.
  // Sans ce branchement, l'endpoint renvoyait une erreur 500 des qu'aucune entree
  // d'odontogramme n'etait en corbeille — c'est-a-dire presque toujours.
  // Les deux requetes restent parametrees (valeur liee pour `patientId`).
  if (idsEnCorbeille.length === 0) {
    return prisma.$queryRaw<LigneOdontogramme[]>`
      SELECT DISTINCT ON ("numeroDent")
        "id", "patientId", "treatmentId", "numeroDent", "etat", "commentaire", "date", "createdAt"
      FROM "odontogram_entries"
      WHERE "patientId" = ${patientId}::uuid
      ORDER BY "numeroDent", "date" DESC, "createdAt" DESC
    `
  }

  return prisma.$queryRaw<LigneOdontogramme[]>`
    SELECT DISTINCT ON ("numeroDent")
      "id", "patientId", "treatmentId", "numeroDent", "etat", "commentaire", "date", "createdAt"
    FROM "odontogram_entries"
    WHERE "patientId" = ${patientId}::uuid
      AND "id"::text NOT IN (${Prisma.join(idsEnCorbeille)})
    ORDER BY "numeroDent", "date" DESC, "createdAt" DESC
  `
}

/**
 * Etat courant de chaque dent calcule a partir d'une liste d'entrees en memoire.
 * Conserve pour les usages ou l'historique est deja charge (tests, calculs).
 */
export function calculerEtatCourant(
  entrees: EntreeOdontogramme[],
): Map<string, EntreeOdontogramme> {
  const courant = new Map<string, EntreeOdontogramme>()
  for (const entree of entrees) {
    const existante = courant.get(entree.numeroDent)
    if (!existante || entree.date.getTime() >= existante.date.getTime()) {
      courant.set(entree.numeroDent, entree)
    }
  }
  return courant
}

/** Historique d'une dent precise. */
export function historiqueDent(
  entrees: EntreeOdontogramme[],
  numeroDent: string,
): EntreeOdontogramme[] {
  return entrees
    .filter((entree) => entree.numeroDent === numeroDent)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

/** Structure complete de l'odontogramme d'un patient. */
export interface OdontogrammePatient {
  etatCourant: Record<string, { etat: EtatDent; date: Date; commentaire: string | null }>
  historiqueParDent: Record<string, EntreeOdontogramme[]>
  dentsPermanentes: readonly string[]
  dentsTemporaires: readonly string[]
  historiqueTronque: boolean
}

export async function getOdontogrammePatient(patientId: string): Promise<OdontogrammePatient> {
  // Deux lectures bornees en base : l'etat exact par dent (<= 32 lignes) et un
  // historique recent borne. Le volume charge ne depend PAS du nombre d'annees
  // d'exploitation (§35).
  const [courantLignes, entrees] = await Promise.all([
    etatCourantPatient(patientId),
    listerEntreesPatient(patientId),
  ])

  const etatCourant: OdontogrammePatient['etatCourant'] = {}
  for (const entree of courantLignes) {
    etatCourant[entree.numeroDent] = {
      etat: entree.etat,
      date: entree.date,
      commentaire: entree.commentaire,
    }
  }

  const historiqueParDent: Record<string, EntreeOdontogramme[]> = {}
  for (const entree of entrees) {
    const liste = historiqueParDent[entree.numeroDent] ?? []
    liste.push(entree)
    historiqueParDent[entree.numeroDent] = liste
  }

  return {
    etatCourant,
    historiqueParDent,
    dentsPermanentes: FDI_PERMANENTE,
    dentsTemporaires: FDI_TEMPORAIRE,
    historiqueTronque: entrees.length >= HISTORIQUE_ODONTOGRAMME_MAX,
  }
}

export interface DonneesEntreeOdontogramme {
  patientId: string
  treatmentId: string | null
  numeroDent: string
  etat: EtatDent
  commentaire: string | null
  date: Date
}

/** Verifie qu'un numero de dent FDI appartient a la denture permanente ou temporaire. */
export function estDentFdiConnue(numeroDent: string): boolean {
  return (
    (FDI_PERMANENTE as readonly string[]).includes(numeroDent) ||
    (FDI_TEMPORAIRE as readonly string[]).includes(numeroDent)
  )
}

/**
 * Enregistre un changement d'etat.
 * AJOUTE une entree : l'etat precedent n'est jamais ecrase (§20).
 */
export async function enregistrerChangement(
  donnees: DonneesEntreeOdontogramme,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  if (!estDentFdiConnue(donnees.numeroDent)) {
    throw erreurs.validation('Le numero de dent ne correspond a aucune dent FDI valide.', [
      { champ: 'numeroDent', message: 'Numero de dent FDI invalide.' },
    ])
  }

  const entree = await prisma.odontogramEntry.create({
    data: {
      patientId: donnees.patientId,
      treatmentId: donnees.treatmentId,
      numeroDent: donnees.numeroDent,
      etat: donnees.etat,
      commentaire: donnees.commentaire,
      date: donnees.date,
      createdById: contexte.userId,
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.ODONTOGRAMME_MODIFIE, {
    entityType: 'EntreeOdontogramme',
    entityId: entree.id,
    metadata: { patientId: donnees.patientId, numeroDent: donnees.numeroDent, etat: donnees.etat },
  })

  return entree
}
