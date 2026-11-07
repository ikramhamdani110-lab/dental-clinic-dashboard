import { type NextRequest, NextResponse } from 'next/server'

import { erreurs } from '@backend/errors/app-error'
import { resoudrePeriode } from '@backend/http/periode-financiere'
import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import { listerDettesDetaillees, listerPaiementsRecus } from '@backend/services/finances.service'

/**
 * GET /api/finances/details?boite=paiements|dettes
 *
 * Listes détaillées des DEUX boîtes cliquables du tableau de bord simplifié :
 *   - `paiements` : paiements clinique VALIDE de la période, ligne par ligne
 *     (les paiements partiels apparaissent individuellement) ;
 *   - `dettes` : patients qui doivent encore de l'argent — le solde est
 *     GLOBAL (calcul « facturé − payé » du cabinet) : la dette ne dépend pas
 *     de la fenêtre regardée, ce qui est explicité à l'écran.
 *
 * Les dépenses cliquables utilisent déjà /api/finances/expenses (même période,
 * mêmes catégories) : cette route ne les duplique pas.
 */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const params = request.nextUrl.searchParams
  const boite = params.get('boite') ?? 'paiements'
  const periode = resoudrePeriode(params)

  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1
  const taille = Number.parseInt(params.get('taille') ?? '50', 10) || 50

  if (boite === 'paiements') {
    const reponse = await listerPaiementsRecus({ debut: periode.debut, fin: periode.fin, page, taille })
    return ok({ periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() }, ...reponse })
  }

  if (boite === 'dettes') {
    const reponse = await listerDettesDetaillees({ page, taille })
    return ok({ periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() }, ...reponse })
  }

  throw erreurs.validation('Boîte de détail inconnue (paiements ou dettes).')
})
