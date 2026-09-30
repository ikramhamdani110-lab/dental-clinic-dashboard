import fr from './fr.json'

/**
 * =============================================================================
 *  TEXTES DE L'INTERFACE — CENTRALISATION (§31)
 * =============================================================================
 *
 *  L'application est FRANCAISE UNIQUEMENT : aucun selecteur de langue n'existe
 *  et n'existe jamais.
 *
 *  Les libelles sont neanmoins centralises ici, et non disperses dans les
 *  composants : c'est une exigence de MAINTENABILITE, pas d'internationalisation.
 *  Corriger une formulation ou harmoniser un terme medical se fait a un seul
 *  endroit, sans risque d'oublier un ecran.
 *
 *  `t` resout un chemin pointe (« patients.nom ») et `tf` interpole des
 *  variables (« {{reste}} »).
 */

export type ContenuFr = typeof fr

/** Resout un chemin pointe dans l'arbre de contenu. */
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
 * Si le chemin est introuvable, la cle elle-meme est renvoyee : une cle visible
 * est un signal clair de developpement, plutot qu'un blanc silencieux.
 */
export function t(chemin: string): string {
  const valeur = lireChemin(fr, chemin)
  if (typeof valeur !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[contenu] Cle introuvable : ${chemin}`)
    }
    return chemin
  }
  return valeur
}

/**
 * Comme `t`, avec interpolation de variables.
 * Exemple : tf('paiements.creerReussieReste', { reste: '10 000 DA' })
 */
export function tf(chemin: string, variables: Record<string, string | number>): string {
  const modele = t(chemin)
  return modele.replace(/\{\{(\w+)\}\}/g, (_correspondance, cle: string) => {
    const valeur = variables[cle]
    return valeur === undefined ? `{{${cle}}}` : String(valeur)
  })
}

/** Acces direct a l'arbre complet, pour les listes (menus, statuts...). */
export const contenu = fr

export default fr
