/**
 * =============================================================================
 *  POLITIQUE DE SECURITE DU CONTENU (CSP) (§38)
 * =============================================================================
 *
 *  La CSP est construite par requete avec un NONCE : les scripts inline sont
 *  autorises uniquement s'ils portent ce nonce, genere aleatoirement. Cela
 *  bloque l'execution d'un script injecte (XSS), meme s'il parvenait a etre
 *  insere dans la page.
 *
 *  `'unsafe-inline'` n'est utilise que la ou Next.js l'impose en developpement
 *  (rechargement a chaud). En production, la politique est stricte.
 */

export interface CspOptions {
  nonce: string
  isDevelopment: boolean
  /** Origines additionnelles autorisees pour les images (ex. stockage de dev). */
  extraImageOrigins?: string[]
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment, extraImageOrigins = [] } = options

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    // Le nonce autorise le script de theme inline et les scripts Next.js.
    // En developpement, `'unsafe-eval'` est indispensable au bundler.
    'script-src': ["'self'", `'nonce-${nonce}'`, ...(isDevelopment ? ["'unsafe-eval'"] : [])],

    // Les feuilles de style Next.js sont injectees en ligne : `'unsafe-inline'`
    // est requis pour `style-src`. Le risque residuel est limite : une feuille
    // de style injectee ne permet pas d'exfiltrer des donnees.
    'style-src': ["'self'", "'unsafe-inline'"],

    'img-src': ["'self'", 'data:', 'blob:', ...extraImageOrigins],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  }

  // `upgrade-insecure-requests` n'a de sens qu'en HTTPS : l'activer en
  // developpement sur http://localhost casserait le chargement des ressources.
  if (!isDevelopment) {
    directives['upgrade-insecure-requests'] = []
  }

  return Object.entries(directives)
    .map(([directive, valeurs]) =>
      valeurs.length === 0 ? directive : `${directive} ${valeurs.join(' ')}`,
    )
    .join('; ')
}

/** Genere un nonce aleatoire, encode en base64. */
export function generateNonce(): string {
  const octets = new Uint8Array(16)
  crypto.getRandomValues(octets)
  return btoa(String.fromCharCode(...octets))
}
