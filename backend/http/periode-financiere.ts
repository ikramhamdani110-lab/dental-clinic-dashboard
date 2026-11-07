import { erreurs } from '@backend/errors/app-error'
import {
  lireAnnee,
  periodeAnnee,
  periodeAujourdhui,
  periodeDerniersJours,
  periodeMois,
  periodeTrimestre,
  type Periode,
} from '@backend/services/finances.service'

/**
 * =============================================================================
 *  PÉRIODE DEMANDÉE PAR LE SITE FINANCIER — LECTURE UNIQUE
 * =============================================================================
 *
 *  Les fenêtres (`7-jours`, `30-jours`, `mois`, `trimestre`, `annee`,
 *  `annee-precedente`, `personnalisee`) étaient recopiées dans trois routes : la
 *  moindre correction d'une borne n'aurait été faite que dans l'une d'elles, et
 *  les listes auraient cessé de correspondre aux totaux.
 *
 *  Une seule implémentation, donc une seule définition de « la période » pour
 *  la synthèse, la série et l'historique.
 */
export function resoudrePeriode(params: URLSearchParams, maintenant: Date = new Date()): Periode {
  switch (params.get('periode') ?? '30-jours') {
    case 'aujourdhui':
      return periodeAujourdhui(maintenant)
    case '7-jours':
      return periodeDerniersJours(7, maintenant)
    case '30-jours':
      return periodeDerniersJours(30, maintenant)
    case 'mois':
      return periodeMois(maintenant)
    case 'trimestre':
      return periodeTrimestre(maintenant)
    case 'annee':
      return periodeAnnee(lireAnnee(params.get('annee'), maintenant.getFullYear()))
    case 'annee-precedente':
      return periodeAnnee(maintenant.getFullYear() - 1)
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
      return { debut, fin }
    }
    default:
      throw erreurs.validation('Période non reconnue.')
  }
}
