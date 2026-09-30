import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { donneesTableauBord } from '@backend/services/reports.service'

/**
 * GET /api/dashboard — indicateurs du tableau de bord (§25).
 *
 * Repond a « Qu'est-ce qui est important aujourd'hui ? » : rendez-vous du jour,
 * patients attendus, traitements en cours, revenus du jour, montants restants,
 * prochains rendez-vous et revenus mensuels.
 *
 * Toutes les valeurs sont calculees par la base.
 */
export const GET = routePrivee(async (_request: NextRequest): Promise<NextResponse> => {
  try {
    const donnees = await donneesTableauBord()
    return ok(donnees)
  } catch (error) {
    return responseErreur(error)
  }
})
