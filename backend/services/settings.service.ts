import { prisma } from '@backend/database/prisma'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  SERVICE PARAMETRES (§28)
 * =============================================================================
 *
 *  Parametres de presentation et informations administratives du cabinet.
 *
 *  AUCUN SECRET TECHNIQUE n'est stocke ici : ni mot de passe, ni cle d'API, ni
 *  chaine de connexion. Ceux-ci vivent uniquement dans l'environnement du
 *  serveur (§28, §38). Cette table ne contient que des donnees d'affichage.
 */

/** Cles des parametres reconnus. Toute autre cle est ignoree. */
export const CLES_PARAMETRES = [
  'nomClinique',
  'adresseClinique',
  'telephoneClinique',
  'emailClinique',
  'siteWeb',
  'nomMedecin',
  'specialite',
  'numeroOrdre',
  'horaires',
] as const

export type CleParametre = (typeof CLES_PARAMETRES)[number]

export type Parametres = Partial<Record<CleParametre, string>>

/** Lit tous les parametres connus. */
export async function lireParametres(): Promise<Parametres> {
  const lignes = await prisma.setting.findMany({
    where: { key: { in: [...CLES_PARAMETRES] } },
  })

  const resultat: Parametres = {}
  for (const ligne of lignes) {
    if ((CLES_PARAMETRES as readonly string[]).includes(ligne.key)) {
      resultat[ligne.key as CleParametre] = ligne.value
    }
  }
  return resultat
}

/**
 * Enregistre les parametres fournis, dans une transaction.
 * Les cles inconnues sont IGNOREES : le client ne peut pas ecrire une cle
 * arbitraire, ce qui eviterait qu'un parametre technique ne soit introduit.
 */
export async function enregistrerParametres(
  valeurs: Parametres,
  contexte: JournalContext,
): Promise<Parametres> {
  const entrees = Object.entries(valeurs).filter(
    (entree): entree is [CleParametre, string] =>
      (CLES_PARAMETRES as readonly string[]).includes(entree[0]) && typeof entree[1] === 'string',
  )

  if (entrees.length === 0) return lireParametres()

  await prisma.$transaction(
    entrees.map(([cle, valeur]) =>
      prisma.setting.upsert({
        where: { key: cle },
        create: { key: cle, value: valeur },
        update: { value: valeur },
      }),
    ),
  )

  await journaliser(contexte, ACTIONS.PARAMETRES_MODIFIES, {
    entityType: 'Parametres',
    metadata: { cles: entrees.map(([cle]) => cle) },
  })

  return lireParametres()
}
