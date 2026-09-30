/**
 * =============================================================================
 *  CLIENT API (NAVIGATEUR)
 * =============================================================================
 *
 *  Toutes les requetes vers l'API privee passent par ici. Il :
 *    - ajoute le jeton CSRF (lu dans le cookie non HttpOnly) sur les requetes
 *      mutantes ;
 *    - envoie les cookies de session (`credentials: 'same-origin'`) ;
 *    - normalise les erreurs en un objet exploitable par l'interface, avec des
 *      messages FRANCAIS, sans jamais exposer de details techniques.
 */

export interface ErreurApi {
  code: string
  message: string
  champs?: Array<{ champ: string; message: string }>
}

/** Erreur levee par le client, porteuse du message francais et du statut. */
export class ApiError extends Error {
  readonly code: string
  readonly statut: number
  readonly champs?: Array<{ champ: string; message: string }>

  constructor(erreur: ErreurApi, statut: number) {
    super(erreur.message)
    this.name = 'ApiError'
    this.code = erreur.code
    this.statut = statut
    this.champs = erreur.champs
  }
}

const NOM_COOKIE_CSRF = 'sahed_csrf'

/** Lit un cookie cote navigateur (le cookie CSRF n'est pas HttpOnly). */
function lireCookie(nom: string): string | null {
  if (typeof document === 'undefined') return null
  const motif = document.cookie.match(new RegExp(`(?:^|; )${nom}=([^;]*)`))
  return motif?.[1] ? decodeURIComponent(motif[1]) : null
}

const MESSAGE_SERVICE_INDISPONIBLE =
  'Le service est temporairement indisponible. Veuillez reessayer dans quelques instants.'

export interface OptionsRequete {
  methode?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  corps?: unknown
  /** Corps multipart (televersement de document). */
  formData?: FormData
  signal?: AbortSignal
}

/**
 * Execute une requete vers l'API privee.
 * Leve une `ApiError` sur reponse d'erreur, avec un message toujours lisible.
 */
export async function requeteApi<T>(chemin: string, options: OptionsRequete = {}): Promise<T> {
  const methode = options.methode ?? 'GET'
  const entetes: Record<string, string> = { Accept: 'application/json' }

  let corps: BodyInit | undefined

  if (options.formData) {
    // Ne PAS definir Content-Type : le navigateur ajoute la frontiere multipart.
    corps = options.formData
  } else if (options.corps !== undefined) {
    entetes['Content-Type'] = 'application/json'
    corps = JSON.stringify(options.corps)
  }

  if (methode !== 'GET') {
    const jeton = lireCookie(NOM_COOKIE_CSRF)
    if (jeton) entetes['x-csrf-token'] = jeton
  }

  let reponse: Response
  try {
    reponse = await fetch(chemin, {
      method: methode,
      headers: entetes,
      body: corps,
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch {
    // Panne reseau : le serveur n'a pas repondu.
    throw new ApiError({ code: 'SERVICE_INDISPONIBLE', message: MESSAGE_SERVICE_INDISPONIBLE }, 0)
  }

  // 204 : aucune contenu a analyser.
  if (reponse.status === 204) return undefined as T

  const typeContenu = reponse.headers.get('content-type') ?? ''
  const estJson = typeContenu.includes('application/json')

  if (!reponse.ok) {
    if (estJson) {
      try {
        const donnees = (await reponse.json()) as Partial<ErreurApi>
        throw new ApiError(
          {
            code: donnees.code ?? 'ERREUR_INTERNE',
            message: donnees.message ?? MESSAGE_SERVICE_INDISPONIBLE,
            ...(donnees.champs ? { champs: donnees.champs } : {}),
          },
          reponse.status,
        )
      } catch (erreur) {
        if (erreur instanceof ApiError) throw erreur
        // Reponse d'erreur illisible : message generique.
      }
    }
    throw new ApiError(
      { code: 'ERREUR_INTERNE', message: MESSAGE_SERVICE_INDISPONIBLE },
      reponse.status,
    )
  }

  if (!estJson) {
    throw new ApiError(
      { code: 'ERREUR_INTERNE', message: 'Reponse du serveur inattendue.' },
      reponse.status,
    )
  }

  return (await reponse.json()) as T
}

/** Extrait un message affichable d'une erreur quelconque. */
export function messageErreur(erreur: unknown): string {
  if (erreur instanceof ApiError) return erreur.message
  if (erreur instanceof Error && erreur.message) return erreur.message
  return MESSAGE_SERVICE_INDISPONIBLE
}

/**
 * Genere une cle d'idempotence pour une soumission de paiement.
 * Le navigateur en cree une par soumission ; reutiliser la meme cle pour la
 * meme soumission empeche la creation d'un doublon cote serveur (§17).
 */
export function genererCleIdempotence(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Repli pour les environnements sans `randomUUID` (tres anciens navigateurs).
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
