import { NextResponse, type NextRequest } from 'next/server'

import { erreurs } from '@backend/errors/app-error'
import { resolveSession } from '@backend/auth/session'
import { responseErreur } from '@backend/http/route-handler'
import { TABLES_SYNC, tirerChangements } from '@backend/services/sync.service'
import { pullSchema } from '@backend/validation/sync-schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * =============================================================================
 *  POST /api/sync/pull — le bureau tire les changements distants
 * =============================================================================
 *
 *  Chaque table demandee est lue independamment : un echec sur l'une ne
 *  bloque pas les autres. Le curseur (`lastPulledAt`) est persiste : apres
 *  un crash ou une coupure, la reprise reprend EXACTEMENT ou elle s'etait
 *  arretee, sans doublon ni trou.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await resolveSession(request.cookies.get('sahed_session')?.value)
    if (!session) throw erreurs.nonAuthentifie()

    const corps = await lireCorpsJson(request)
    const { deviceId, jetonAppareil, tables } = valider(pullSchema, corps)

    const { curseurs, lots } = await tirerChangements(
      deviceId,
      jetonAppareil,
      tables as readonly (typeof TABLES_SYNC)[number][],
    )

    return NextResponse.json({ curseurs, lots, tables: TABLES_SYNC })
  } catch (error) {
    return responseErreur(error)
  }
}
