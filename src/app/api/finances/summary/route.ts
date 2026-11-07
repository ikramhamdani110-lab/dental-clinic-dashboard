import { type NextRequest, NextResponse } from 'next/server'

import { resoudrePeriode } from '@backend/http/periode-financiere'
import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import { syntheseFinanciere } from '@backend/services/finances.service'

/**
 * GET /api/finances/summary — les TROIS BOÎTES du site financier.
 *
 * Paramètres `periode` : `7-jours`, `30-jours`, `annee`, `annee-precedente`,
 * ou `personnalisee` avec `du` et `au` (ISO yyyy-mm-dd).
 *
 * CE QUE LA ROUTE RENVOIE, ET CE QU'ELLE NE CONFOND PAS
 *
 *   `revenusCentimes`     argent RÉELLEMENT reçu : paiements VALIDE du
 *                         secrétariat, sur la période. Jamais saisi à la main.
 *   `restantDuCentimes`   dette GLOBALE des patients (facturé − payé). Elle ne
 *                         dépend pas de la période et n'est pas un revenu.
 *   `depensesCentimes`    dépenses saisies par le médecin, sur la période.
 *   `soldeNetCentimes`    revenus − dépenses. La dette n'y entre JAMAIS.
 *
 * AGRÉGATION EN BASE : aucun paiement n'est téléchargé pour être additionné.
 */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const periode = resoudrePeriode(request.nextUrl.searchParams)

  const synthese = await syntheseFinanciere({ debut: periode.debut, fin: periode.fin })

  return ok({ ...synthese, tendance: [] })
})
