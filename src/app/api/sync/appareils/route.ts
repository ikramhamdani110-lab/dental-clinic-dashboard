import { randomUUID } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { erreurs } from '@backend/errors/app-error'
import { responseErreur } from '@backend/http/route-handler'
import { resolveSession } from '@backend/auth/session'
import { appairerAppareil, listerAppareils } from '@backend/services/sync.service'
import { appairageSchema } from '@backend/validation/sync-schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * =============================================================================
 *  APPAIRAGE ET GESTION DES APPAREILS (desktop)
 * =============================================================================
 *  GET  : liste des appareils de l'utilisateur courant (pour /parametres).
 *  POST : appaire un NOUVEL appareil. La phrase de recuperation est renvoyee
 *         UNE SEULE FOIS dans la reponse — jamais journalisee, jamais stockee
 *         en clair. L'utilisateur doit la conserver hors du poste.
 */

export const GET = (async (request: NextRequest): Promise<NextResponse> => {
  try {
    const session = await resolveSession(request.cookies.get('sahed_session')?.value)
    if (!session) throw erreurs.nonAuthentifie()

    const appareils = await listerAppareils(session.user.id)
    return NextResponse.json({ appareils })
  } catch (error) {
    return responseErreur(error)
  }
}) satisfies (request: NextRequest) => Promise<NextResponse>

export const POST = (async (request: NextRequest): Promise<NextResponse> => {
  try {
    const session = await resolveSession(request.cookies.get('sahed_session')?.value)
    if (!session) throw erreurs.nonAuthentifie()

    const corps = await lireCorpsJson(request)
    const { deviceId, label } = valider(appairageSchema, corps)

    const { jeton, phraseRecuperation } = await appairerAppareil({
      userId: session.user.id,
      deviceId: deviceId || randomUUID(),
      label,
    })

    // La phrase de recuperation n'est JAMAIS journalisee ni re-obtenable :
    // c'est le seul et unique moment ou elle est transmise.
    return NextResponse.json({ jeton, phraseRecuperation, avertissement: 'Conservez cette phrase hors du poste. Elle ne sera plus jamais affichee.' })
  } catch (error) {
    return responseErreur(error)
  }
}) satisfies (request: NextRequest) => Promise<NextResponse>
