import { type NextRequest, NextResponse } from 'next/server'

import { erreurs } from '@backend/errors/app-error'
import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  listerPaiementsRecus,
  listerDettesPatients,
  periodeAnnee,
  periodeAujourdhui,
  periodeDerniersJours,
  periodeMois,
} from '@backend/services/finances.service'
import type { Periode } from '@backend/services/finances.service'

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
  const maintenant = new Date()

  let periode: Periode
  switch (params.get('periode') ?? 'mois') {
    case 'aujourdhui':
      periode = periodeAujourdhui(maintenant)
      break
    case '7-jours':
      periode = periodeDerniersJours(7, maintenant)
      break
    case '30-jours':
      periode = periodeDerniersJours(30, maintenant)
      break
    case 'mois':
      periode = periodeMois(maintenant)
      break
    case 'annee':
      periode = periodeAnnee(maintenant.getFullYear())
      break
    case 'annee-precedente':
      periode = periodeAnnee(maintenant.getFullYear() - 1)
      break
    case 'personnalisee': {
      const du = params.get('du')
      const au = params.get('au')
      if (!du || !au) {
        throw erreurs.validation('Une période personnalisée exige les dates de début et de fin.')
      }
      const debut = new Date(`${du}T00:00:00`)
      const fin = new Date(`${au}T23:59:59.999`)
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin.getTime() < debut.getTime()) {
        throw erreurs.validation('Les dates de la période sont invalides.')
      }
      periode = { debut, fin }
      break
    }
    default:
      throw erreurs.validation('Période non reconnue.')
  }

  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1
  const taille = Number.parseInt(params.get('taille') ?? '50', 10) || 50

  if (boite === 'paiements') {
    const reponse = await listerPaiementsRecus({ debut: periode.debut, fin: periode.fin, page, taille })
    return ok({ periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() }, ...reponse })
  }

  if (boite === 'dettes') {
    const reponse = await listerDettesPatients({ page, taille })
    return ok({ periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() }, ...reponse })
  }

  throw erreurs.validation('Boîte de détail inconnue (paiements ou dettes).')
})
