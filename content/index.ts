import fr from './fr.json'
import ar from './ar.json'

/**
 * =============================================================================
 *  TEXTES DE L'INTERFACE — CENTRALISATION (§31)
 * =============================================================================
 *
 *  L'application est FRANÇAISE PAR DÉFAUT. Le médecin peut toutefois basculer
 *  l'interface en ARABE (RTL) : le choix est mémorisé dans le navigateur
 *  (localStorage `sahed-lang`) et respecté par tout le rendu client.
 *
 *  Les libellés sont centralisés ici, et non dispersés dans les composants :
 *  corriger une formulation ou harmoniser un terme médical se fait à un seul
 *  endroit, sans risque d'oublier un écran.
 *
 *  `t` résout un chemin pointé (« patients.nom ») et `tf` interpole des
 *  variables (« {{reste}} »). Les fonctions acceptent une langue optionnelle ;
 *  sans argument, elles utilisent la langue du contexte d'appel (fr par défaut
 *  côté serveur, langue choisie côté client via le fournisseur de langue).
 */

export type Langue = 'fr' | 'ar'
export type ContenuFr = typeof fr

const DICTIONNAIRES = { fr, ar } as const

/** Clé localStorage du choix de langue. */
export const CLE_LANGUE = 'sahed-lang'

/** Langue par défaut de l'application (exigence produit : le français). */
export const LANGUE_DEFAUT: Langue = 'fr'

/**
 * Langue ACTIVE du rendu.
 *
 * Le fournisseur client (`FournisseurLangue`) la met à jour à chaque choix du
 * médecin ; les appels à `t()` SANS argument explicite lisent cette langue.
 * C'est ce qui permet à TOUTE l'interface de basculer sans modifier les
 * centaines d'appels existants : le texte change, jamais les données.
 */
let langueActive: Langue = LANGUE_DEFAUT

/** Définit la langue active pour les prochains appels à `t`/`tf`. */
export function definirLangueActive(langue: Langue): void {
  langueActive = langue
}

/** Langue actuellement active pour les appels sans argument explicite. */
export function langueActiveActuelle(): Langue {
  return langueActive
}

/** Vrai si la langue s'écrit de droite à gauche. */
export function estRtl(langue: Langue): boolean {
  return langue === 'ar'
}

/** Résout un chemin pointé dans l'arbre de contenu. */
function lireChemin(source: unknown, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, source)
}

/**
 * Retourne le texte correspondant au chemin.
 * Si le chemin est introuvable dans la langue choisie, on retombe sur le
 * français ; si la clé n'existe nulle part, la clé elle-même est renvoyée :
 * une clé visible est un signal clair de développement, plutôt qu'un blanc.
 */
export function t(chemin: string, langue: Langue = langueActive): string {
  const valeur = lireChemin(DICTIONNAIRES[langue], chemin)
  if (typeof valeur === 'string') return valeur
  const repli = lireChemin(fr, chemin)
  if (typeof repli === 'string') return repli
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[contenu] Clé introuvable : ${chemin}`)
  }
  return chemin
}

/**
 * Comme `t`, avec interpolation de variables.
 * Exemple : tf('paiements.creerReussieReste', { reste: '10 000 DA' })
 */
export function tf(
  chemin: string,
  variables: Record<string, string | number>,
  langue: Langue = langueActive,
): string {
  const modele = t(chemin, langue)
  return modele.replace(/\{\{(\w+)\}\}/g, (_correspondance, cle: string) => {
    const valeur = variables[cle]
    return valeur === undefined ? `{{${cle}}}` : String(valeur)
  })
}

/** Acces direct a l'arbre FRANCAIS complet, pour les listes (menus, statuts...). */
export const contenu = fr

/** Arbre de contenu d'une langue donnee (fr ou ar). */
export function arbreLangue(langue: Langue = LANGUE_DEFAUT): typeof fr {
  return DICTIONNAIRES[langue] as typeof fr
}

/** Arbre français brut, pour les métadonnées de la racine. */
export const contenuDefaut = fr

/** Verrouille le typage : chaque langue doit couvrir exactement le français. */
export type Contenu = typeof fr

export default fr
