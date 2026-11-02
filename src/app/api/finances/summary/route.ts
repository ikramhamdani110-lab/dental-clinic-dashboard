import { type NextRequest, NextResponse } from 'next/server'

import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  periodeAnnee,
  periodeAujourdhui,
  periodeDerniersJours,
  periodeMois,
  syntheseFinanciere,
} from '@backend/services/finances.service'
import { erreurs } from '@backend/errors/app-error'

/**
 * GET /api/finances/summary — synthese financiere privee du medecin.
 *
 * Parametres `periode` :
 *   - `aujourdhui`, `7-jours`, `30-jours`, `mois`, `annee`, `annee-precedente`
 *   - `personnalisee` avec `du` et `au` (ISO yyyy-mm-dd)
 *
 * DEUX LIGNES DE REVENU, JAMAIS FONDUES :
 *   - `revenusPaiementsCentimes` : paiements clinique VALIDE (source `payments`)
 *   - `revenusManuelsCentimes`   : revenus manuels (source `manual_incomes`)
 *
 * SOLDE NET = revenusPaiements + revenusManuels - depenses.
 * Les montants restant dus (`restantDuCentimes`) sont AFFICHES separement et
 * n'entrent JAMAIS dans le solde net.
 */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const params = request.nextUrl.searchParams
  const choix = params.get('periode') ?? 'mois'
  const maintenant = new Date()

  let debut: Date
  let fin: Date

  switch (choix) {
    case 'aujourdhui': {
      const p = periodeAujourdhui(maintenant)
      debut = p.debut
      fin = p.fin
      break
    }
    case '7-jours': {
      const p = periodeDerniersJours(7, maintenant)
      debut = p.debut
      fin = p.fin
      break
    }
    case '30-jours': {
      const p = periodeDerniersJours(30, maintenant)
      debut = p.debut
      fin = p.fin
      break
    }
    case 'mois': {
      const p = periodeMois(maintenant)
      debut = p.debut
      fin = p.fin
      break
    }
    case 'annee': {
      const p = periodeAnnee(maintenant.getFullYear())
      debut = p.debut
      fin = p.fin
      break
    }
    case 'annee-precedente': {
      const p = periodeAnnee(maintenant.getFullYear() - 1)
      debut = p.debut
      fin = p.fin
      break
    }
    case 'personnalisee': {
      const du = params.get('du')
      const au = params.get('au')
      if (!du || !au) {
        throw erreurs.validation('Une période personnalisée exige les dates de début et de fin.')
      }
      debut = new Date(`${du}T00:00:00`)
      fin = new Date(`${au}T23:59:59.999`)
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
        throw erreurs.validation('Les dates de la période sont invalides.')
      }
      if (fin.getTime() < debut.getTime()) {
        throw erreurs.validation('La date de fin doit être postérieure à la date de début.')
      }
      break
    }
    default:
      throw erreurs.validation('Période non reconnue.')
  }

  const synthese = await syntheseFinanciere({ debut, fin })

  /*
   * Le dashboard simplifié n'utilise plus la tendance mensuelle (aucun
   * graphique demandé). La route renvoie néanmoins une liste vide : les
   * clients qui connaissent déjà ce champ ne cassent pas.
   */
  const tendance = [] as never[]

  return ok({ ...synthese, tendance })
})
