import { NextResponse, type NextRequest } from 'next/server'

import {
  buildContentSecurityPolicy,
  generateNonce,
} from '@backend/security/content-security-policy'

/**
 * =============================================================================
 *  INTERGICIEL (MIDDLEWARE) — SECURITE ET PROTECTION DES ROUTES (§38, §39)
 * =============================================================================
 *
 *  Trois responsabilites, dans cet ordre :
 *
 *   1. CSP par nonce : la politique de securite du contenu est construite pour
 *      chaque reponse. Le nonce est transmis aux composants via un en-tete, pour
 *      que les scripts legitimes puissent l'utiliser.
 *
 *   2. Protection des routes du tableau de bord : un utilisateur non
 *      authentifie est redirige vers la page de connexion. ATTENTION — ce
 *      filtre est un CONFORT d'experience, PAS une protection : il se contente
 *      de verifier la PRESENCE du cookie. La verification reelle (validite,
 *      expiration, revocation, role) est faite COTE SERVEUR dans chaque route
 *      API et dans les pages privees. Un appel direct a l'API sans cookie valide
 *      est refuse par `routePrivee`, independamment de ce middleware.
 *
 *   3. Verification d'origine sur les requetes mutantes : une requete POST/PUT/
 *      PATCH/DELETE portant une origine differente de l'application est rejetee
 *      (premiere barriere contre le CSRF ; la seconde est le jeton CSRF).
 *
 *  Le middleware ne touche JAMAIS a la base : il s'execute sur le bord et doit
 *  rester rapide. Aucune requete Prisma ici (incompatible avec l'execution Edge
 *  et couteuse).
 */

/** Routes privees : acces reserve au medecin authentifie. */
const PREFIXES_PRIVES = [
  '/tableau-de-bord',
  '/patients',
  '/rendez-vous',
  '/traitements',
  '/paiements',
  '/dossiers-medicaux',
  '/ordonnances',
  '/odontogramme',
  '/documents',
  '/rapports',
  '/journal-activite',
  '/parametres',
]

const COOKIE_SESSION = 'sahed_session'

function estRoutePrivee(chemin: string): boolean {
  return PREFIXES_PRIVES.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`))
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, origin } = request.nextUrl
  const isDevelopment = process.env.NODE_ENV !== 'production'
  const nonce = generateNonce()

  // ── 1. Verification d'origine sur les requetes mutantes (anti-CSRF amont) ──
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origine = request.headers.get('origin')
    // Une requete same-origin peut omettre `origin` (formulaires classiques) :
    // l'absence n'est donc pas rejetee ici, le jeton CSRF prend le relais.
    if (origine && origine !== origin) {
      return NextResponse.json(
        {
          code: 'ACCES_REFUSE',
          message: 'Requete refusee : origine non autorisee.',
        },
        { status: 403 },
      )
    }
  }

  // ── 2. Protection des routes privees (confort — la vraie garde est cote API) ─
  if (estRoutePrivee(pathname)) {
    const aUnCookie = request.cookies.has(COOKIE_SESSION)
    if (!aUnCookie) {
      const url = request.nextUrl.clone()
      url.pathname = '/connexion'
      url.search = ''
      // `redirect` conserve la methode GET : la destination ne divulgue rien.
      const reponse = NextResponse.redirect(url)
      appliquerEnTetesSecurite(reponse, nonce, isDevelopment)
      return reponse
    }
  }

  // ── 3. Construction de la reponse avec la CSP ───────────────────────────────
  const reponse = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  })
  replySetNonce(reponse, nonce, isDevelopment)
  appliquerEnTetesSecurite(reponse, nonce, isDevelopment)
  return reponse
}

/**
 * Transmet le nonce "vers l'interieur" : le rendu de la page courante en a besoin.
 *
 * DEUX en-tetes sont necessaires, et ils ne servent pas a la meme chose :
 *
 *  1. `Content-Security-Policy` (en-tete de REQUETE) — c'est celui que Next.js
 *     analyse pendant le rendu serveur pour recuperer le nonce et l'appliquer
 *     AUTOMATIQUEMENT a ses propres scripts inline (amorcage `self.__next_f`, lots
 *     de donnees de vol, bundles de page). Sans lui, ces scripts partent sans
 *     attribut `nonce`, la CSP les bloque et React ne s'hydrate jamais.
 *
 *  2. `x-nonce` — en-tete de commodite, pour que nos propres composants serveur
 *     puissent lire la valeur (`headers().get('x-nonce')`).
 *
 * Les en-tetes de requete doivent etre poses via `NextResponse.next({request})`,
 * d'ou l'ecriture DIRECTE dans `reponse` ici : `reponse.headers` est fusionne a la
 * requete transmise au rendu par Next.js.
 */
function replySetNonce(reponse: NextResponse, nonce: string, isDevelopment: boolean): void {
  const csp = buildContentSecurityPolicy({ nonce, isDevelopment })

  // Indispensable : Next.js lit le nonce dans CET en-tete de requete.
  reponse.headers.set('Content-Security-Policy', csp)

  // Commodite : lecture par nos composants serveur (layout racine).
  reponse.headers.set('x-nonce', nonce)
  reponse.headers.set('x-csp-nonce', nonce)
}

/** Applique la CSP et les en-tetes de securite additionnels. */
function appliquerEnTetesSecurite(
  reponse: NextResponse,
  nonce: string,
  isDevelopment: boolean,
): void {
  const csp = buildContentSecurityPolicy({ nonce, isDevelopment })

  reponse.headers.set('Content-Security-Policy', csp)

  // HSTS : uniquement en production (en developpement, http://localhost).
  if (!isDevelopment) {
    reponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
}

/**
 * Configuration du matcher : le middleware s'execute sur toutes les routes SAUF
 * les fichiers statiques et les routes API.
 *
 * Les routes API appliquent leurs propres garanties (`routePrivee`) : y ajouter
 * la redirection de navigation ferait echouer les appels `fetch` legitimes en
 * renvoyant une redirection HTML au lieu d'une erreur JSON 401.
 */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
  ],
}
