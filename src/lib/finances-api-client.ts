/**
 * =============================================================================
 *  CLIENT API — SITE FINANCIER PRIVE
 * =============================================================================
 *
 *  Copie conforme du client clinique (`src/lib/api-client.ts`), mais ciblee a
 *  la session DEDIEE du site financier : le cookie CSRF lu/posé est
 *  `sahed_finance_csrf`, et l'en-tete transmis est `x-finance-csrf-token`.
 *
 *  Les deux clients n'echangent AUCUN cookie : la session clinique ne peut
 *  jamais authentifier une requete financiere, et reciproquement.
 */

export interface ErreurApi {
  code: string
  message: string
  champs?: Array<{ champ: string; message: string }>
}

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

const NOM_COOKIE_CSRF = 'sahed_finance_csrf'
const EN_TETE_CSRF = 'x-finance-csrf-token'

function lireCookie(nom: string): string | null {
  if (typeof document === 'undefined') return null
  const motif = document.cookie.match(new RegExp(`(?:^|; )${nom}=([^;]*)`))
  return motif?.[1] ? decodeURIComponent(motif[1]) : null
}

const MESSAGE_SERVICE_INDISPONIBLE =
  'Le service est temporairement indisponible. Veuillez réessayer dans quelques instants.'

export interface OptionsRequete {
  methode?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  corps?: unknown
}

export async function requeteFinanciere<T>(chemin: string, options: OptionsRequete = {}): Promise<T> {
  const methode = options.methode ?? 'GET'
  const entetes: Record<string, string> = { Accept: 'application/json' }

  let corps: BodyInit | undefined
  if (options.corps !== undefined) {
    entetes['Content-Type'] = 'application/json'
    corps = JSON.stringify(options.corps)
  }

  if (methode !== 'GET') {
    const jeton = lireCookie(NOM_COOKIE_CSRF)
    if (jeton) entetes[EN_TETE_CSRF] = jeton
  }

  let reponse: Response
  try {
    reponse = await fetch(chemin, {
      method: methode,
      headers: entetes,
      body: corps,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError({ code: 'SERVICE_INDISPONIBLE', message: MESSAGE_SERVICE_INDISPONIBLE }, 0)
  }

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

export function messageErreur(erreur: unknown): string {
  if (erreur instanceof ApiError) return erreur.message
  if (erreur instanceof Error && erreur.message) return erreur.message
  return MESSAGE_SERVICE_INDISPONIBLE
}

/** Cle d'anti-doublon : une par soumission de formulaire. */
export function genererCleAntiDoublon(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
