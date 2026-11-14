import { NextResponse, type NextRequest } from 'next/server'

import { erreurs } from '@backend/errors/app-error'
import { responseErreur } from '@backend/http/route-handler'
import { resolveSession } from '@backend/auth/session'
import { pousserOperations } from '@backend/services/sync.service'
import { idempotentLotSchema } from '@backend/validation/sync-schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * =============================================================================
 *  POST /api/sync/push — le bureau pousse un lot d'operations hors ligne
 * =============================================================================
 *
 *  AUTHENTIFICATION DOUBLE :
 *    1. une session web valide (secrétaire OU medecin) via le cookie ;
 *    2. un jeton d'appareil valide et NON revoke (table device_sessions).
 *
 *  La revocation est verifiee DANS la transaction d'application (SELECT FOR
 *  SHARE) : une revocation concurrente pendant le push est atomiquement
 *  decisive — jamais d'ecriture partielle.
 *
 *  IDEMPOTENCE : chaque operationId ne produit d'effet qu'une seule fois.
 *  Une operation en echec N'AFFECTE PAS les suivantes du lot.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await resolveSession(request.cookies.get('sahed_session')?.value)
    if (!session) throw erreurs.nonAuthentifie()

    const corps = await lireCorpsJson(request)
    const lot = valider(idempotentLotSchema, corps)

    const { resultats } = await pousserOperations(
      lot.deviceId,
      lot.jetonAppareil,
      lot.operations,
    )

    const revocations = resultats.filter((r) => r.detail === 'DEVICE_REVOKED')
    if (revocations.length === resultats.length && resultats.length > 0) {
      // Tous les rejets sont des revocations : reponse 403 explicite.
      return NextResponse.json(
        { code: 'DEVICE_REVOKED', message: 'Appareil revoke — synchronisation refusee.' },
        { status: 403 },
      )
    }

    return NextResponse.json({ resultats })
  } catch (error) {
    return responseErreur(error)
  }
}

/** GET /api/sync/push — non supporté (la liste des tables est fournie par /pull). */
export function GET(): NextResponse {
  return NextResponse.json({
    tables: [
      'patients',
      'appointments',
      'treatments',
      'payments',
      'documents',
      'prescriptions',
      'odontogramEntries',
      'medicalRecords',
    ],
  })
}
