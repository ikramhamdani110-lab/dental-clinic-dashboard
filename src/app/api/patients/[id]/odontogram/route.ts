import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { enregistrerChangement, getOdontogrammePatient } from '@backend/services/odontogram.service'
import { identifiant, odontogrammeEntreeSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/odontogram — odontogramme FDI du patient (§20).
 *
 * Renvoie l'etat COURANT de chaque dent ET l'historique complet par dent.
 * L'etat precedent n'est jamais perdu : une dent peut avoir plusieurs
 * traitements au fil du temps.
 */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const odontogramme = await getOdontogrammePatient(patientId)
    return ok(odontogramme)
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * POST /api/patients/:id/odontogram — nouvel etat de dent.
 * AJOUTE une entree : aucun ecrasement de l'etat precedent (§20).
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(odontogrammeEntreeSchema, { ...(corps as object), patientId })

    const entree = await enregistrerChangement(
      { ...donnees, treatmentId: donnees.treatmentId ?? null },
      contexte.journal,
    )
    return ok({ entree }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
