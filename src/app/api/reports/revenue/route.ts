import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { erreurs } from '@backend/errors/app-error'
import {
  anneesAvecRevenus,
  periodeAnnee,
  periodeAujourdhui,
  periodeDerniersJours,
  periodeMois,
  periodeSemaine,
  rapportEvolutionRevenus,
  rapportRevenus,
  rapportRendezVous,
  rapportSoldesPatients,
  rapportSyntheseFinanciere,
  rapportTraitements,
  type Periode,
} from '@backend/services/reports.service'

/**
 * GET /api/reports/revenue — rapports de la clinique (§27).
 *
 * Types disponibles via `rapport` :
 *   - `synthese`        : indicateurs financiers (revenus de la periode, nombre
 *                         de paiements, montant restant, revenus du mois et
 *                         comparaison avec le mois precedent) ;
 *   - `evolution`       : revenus mois par mois d'une annee (`annee=AAAA`) ;
 *   - `annees`          : annees possedant des paiements (menu Annee) ;
 *   - `revenus`         : total encaisse sur la periode ;
 *   - `traitements`     : volumes et montants des traitements ;
 *   - `rendez-vous`     : volumes de rendez-vous ;
 *   - `soldes-patients` : patients presentant un solde a recevoir (pagine).
 *
 * `periode` accepte `7-jours`, `30-jours`, `aujourdhui`, `semaine`, `mois`,
 * `annee`, `annee-precedente` ou `personnalisee` (avec `du` et `au`).
 *
 * Toutes les valeurs sont produites par des AGREGATIONS EN BASE (§18, §27) :
 * aucune liste de paiements n'est transmise au navigateur.
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const params = request.nextUrl.searchParams
    const rapport = params.get('rapport') ?? 'synthese'

    switch (rapport) {
      case 'synthese': {
        return ok(await rapportSyntheseFinanciere(resoudrePeriode(params)))
      }
      case 'evolution': {
        /*
         * DEUX MODES, ET UN SEUL DECLENCHEUR : la presence du parametre
         * `periode`.
         *
         *   - `periode` fourni -> la courbe suit EXACTEMENT la fenetre choisie
         *     par le filtre de periode (7 jours, 30 jours, cette annee, annee
         *     precedente, personnalisee).
         *
         *   - `periode` absent -> la courbe decrit les 12 mois de l'annee
         *     demandee (`annee`), comportement historique du menu « Annee ».
         *
         * C'est ce qui permet au filtre de periode de commander REELLEMENT le
         * graphique, au lieu de laisser celui-ci figE sur l'annee du menu.
         */
        const periodeBrute = params.get('periode')
        return ok(
          periodeBrute
            ? await rapportEvolutionRevenus({ periode: resoudrePeriode(params) })
            : await rapportEvolutionRevenus({ annee: resoudreAnnee(params) }),
        )
      }
      case 'annees': {
        return ok({ annees: await anneesAvecRevenus() })
      }
      case 'revenus': {
        return ok(await rapportRevenus(resoudrePeriode(params)))
      }
      case 'traitements': {
        return ok(await rapportTraitements(resoudrePeriode(params)))
      }
      case 'rendez-vous': {
        return ok(await rapportRendezVous(resoudrePeriode(params)))
      }
      case 'soldes-patients': {
        return ok(await rapportSoldesPatients(lirePagination(params)))
      }
      default:
        throw erreurs.validation('Type de rapport inconnu.', [
          { champ: 'rapport', message: 'Type de rapport non reconnu.' },
        ])
    }
  } catch (error) {
    return responseErreur(error)
  }
})

/** Annee demandee pour le graphique d'evolution. */
function resoudreAnnee(params: URLSearchParams): number {
  const brut = params.get('annee')
  const annee = brut ? Number.parseInt(brut, 10) : new Date().getFullYear()

  if (!Number.isInteger(annee) || annee < 1900 || annee > 2200) {
    throw erreurs.validation('Annee invalide.', [
      { champ: 'annee', message: "L'annee doit etre comprise entre 1900 et 2200." },
    ])
  }
  return annee
}

/** Traduit les parametres de requete en periode de dates. */
function resoudrePeriode(params: URLSearchParams): Periode {
  const choix = params.get('periode') ?? 'mois'
  const maintenant = new Date()

  switch (choix) {
    case 'aujourdhui':
      return periodeAujourdhui(maintenant)
    case '7-jours':
      return periodeDerniersJours(7, maintenant)
    case '30-jours':
      return periodeDerniersJours(30, maintenant)
    case 'semaine':
      return periodeSemaine(maintenant)
    case 'mois':
      return periodeMois(maintenant)
    case 'annee':
      return periodeAnnee(maintenant.getFullYear())
    case 'annee-precedente':
      return periodeAnnee(maintenant.getFullYear() - 1)
    case 'personnalisee': {
      const du = params.get('du')
      const au = params.get('au')
      if (!du || !au) {
        throw erreurs.validation('Une periode personnalisee exige les dates de debut et de fin.', [
          { champ: 'du', message: 'Date de debut manquante.' },
          { champ: 'au', message: 'Date de fin manquante.' },
        ])
      }
      const debut = new Date(du)
      const fin = new Date(au)
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
        throw erreurs.validation('Les dates de la periode sont invalides.')
      }
      if (fin.getTime() < debut.getTime()) {
        throw erreurs.validation('La date de fin doit etre posterieure a la date de debut.')
      }
      fin.setHours(23, 59, 59, 999)
      debut.setHours(0, 0, 0, 0)
      return { debut, fin }
    }
    default:
      throw erreurs.validation('Periode non reconnue.', [
        { champ: 'periode', message: 'Periode inconnue.' },
      ])
  }
}
