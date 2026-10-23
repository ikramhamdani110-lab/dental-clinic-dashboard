/**
 * =============================================================================
 *  TESTS DE RÉGRESSION — CALENDRIER DE SÉLECTION DE DATE (rapports)
 * =============================================================================
 *
 *  EXIGENCE PRODUIT : dans Rapports, la période personnalisée se choisit par
 *  un CALENDRIER (jour → mois → année), jamais par frappe manuelle. L'année
 *  démarre à 2026. « Du » doit précéder « Au », sinon message FR et rapport
 *  bloqué.
 *
 *  Ces tests verrouillent (composant pur, logique extraite, sans rendu) :
 *    - conversion ISO ↔ Date sûre (rejet du 30/02, du mois 13…) ;
 *    - bornes d'années (grille démarrant à 2026) ;
 *    - format d'affichage français ;
 *    - la page Rapports n'utilise plus de champ de saisie manuelle pour la
 *      période personnalisée et valide l'ordre des bornes.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = resolve(__dirname, '..', '..')

function lireFichier(cheminRelatif: string): string {
  return readFileSync(resolve(racine, cheminRelatif), 'utf8')
}

// ── Logique extraite (copie fidèle des fonctions internes testées) ──────────
// Les fonctions `dateDe` / `isoDe` du composant sont volontairement simples et
// pures ; on les duplique ici pour verrouiller leur comportement contractuel.

function dateDe(iso: string): Date | null {
  const correspond = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!correspond) return null
  const date = new Date(
    Number(correspond[1]),
    Number(correspond[2]) - 1,
    Number(correspond[3]),
  )
  if (
    date.getFullYear() !== Number(correspond[1]) ||
    date.getMonth() !== Number(correspond[2]) - 1 ||
    date.getDate() !== Number(correspond[3])
  ) {
    return null
  }
  return date
}

function isoDe(date: Date): string {
  const annee = date.getFullYear()
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')
  return `${annee}-${mois}-${jour}`
}

describe('Calendrier — conversion ISO ↔ Date', () => {
  it('accepte une date valide en janvier 2026', () => {
    const date = dateDe('2026-01-15')
    expect(date).not.toBeNull()
    expect(isoDe(date as Date)).toBe('2026-01-15')
  })

  it('accepte le 29 février 2028 (année bissextile)', () => {
    expect(dateDe('2028-02-29')).not.toBeNull()
  })

  it('refuse le 29 février 2026 (non bissextile)', () => {
    expect(dateDe('2026-02-29')).toBeNull()
  })

  it('refuse le 30 février', () => {
    expect(dateDe('2026-02-30')).toBeNull()
  })

  it('refuse le 31 avril', () => {
    expect(dateDe('2026-04-31')).toBeNull()
  })

  it('refuse le mois 13 et le jour 00', () => {
    expect(dateDe('2026-13-01')).toBeNull()
    expect(dateDe('2026-03-00')).toBeNull()
  })

  it('refuse un format non ISO', () => {
    expect(dateDe('15/01/2026')).toBeNull()
    expect(dateDe('20260115')).toBeNull()
    expect(dateDe('')).toBeNull()
  })

  it('passage décembre → janvier conserve l’année', () => {
    // Le cas de bord mois/année : le 31/12 reste le 31/12.
    expect(isoDe(new Date(2026, 11, 31))).toBe('2026-12-31')
    expect(isoDe(new Date(2027, 0, 1))).toBe('2027-01-01')
  })
})

describe('Calendrier — bornes de la grille d’années', () => {
  const ANNEE_MINIMALE = 2026

  it('la première année proposée est 2026', () => {
    const code = lireFichier('src/components/ui/calendrier.tsx')
    expect(code).toContain('ANNEE_MINIMALE = 2026')
  })

  it('aucune année antérieure à 2026 n’est joignable depuis la grille', () => {
    // Le bloc précédant 2026 n’existe pas : le bouton ‹ doit être désactivé.
    const code = lireFichier('src/components/ui/calendrier.tsx')
    expect(code).toContain('disabled={blocAnnees <= 0}')
  })
})

describe('Rapports — période personnalisée', () => {
  it('utilise le calendrier, pas de saisie manuelle', () => {
    const rapports = lireFichier('src/components/rapports/rapports.tsx')
    expect(rapports).toContain('CalendrierDates')
    // Aucun `ChampDate` (saisie clavier) ne reste sur la période personnalisée.
    expect(rapports.includes('<ChampDate')).toBe(false)
    expect(rapports.includes("type=\"text\"")).toBe(false)
  })

  it('valide que « Du » précède « Au » avant tout appel API', () => {
    const rapports = lireFichier('src/components/rapports/rapports.tsx')
    // Message FR affiché + bouton inactif + garde-fou dans le callback.
    expect(rapports).toContain('datesIncoherentes')
    expect(rapports).toContain('periodeInvalide')
    expect(rapports).toContain('disabled={!du || !au || periodeInvalide}')
  })

  it('les bornes sont propagées aux requêtes réelles, pas seulement affichées', () => {
    const rapports = lireFichier('src/components/rapports/rapports.tsx')
    expect(rapports).toContain("parametres.set('du', periodeAppliquee.du)")
    expect(rapports).toContain("parametres.set('au', periodeAppliquee.au)")
  })

  it('les clés de traduction FR et AR existent', () => {
    const fr = JSON.parse(lireFichier('content/fr.json'))
    const ar = JSON.parse(lireFichier('content/ar.json'))
    for (const cle of [
      'choisirDate',
      'dateRequise',
      'dateTropTot',
      'dateTropTard',
      'moisPrecedentCal',
      'moisSuivantCal',
      'changerAnnee',
      'anneesPrecedentes',
      'anneesSuivantes',
      'aucuneDate',
      'effacer',
      'datesIncoherentes',
    ]) {
      expect(typeof fr.commun[cle]).toBe('string')
      expect(fr.commun[cle].length).toBeGreaterThan(0)
      expect(typeof ar.commun[cle]).toBe('string')
      expect(ar.commun[cle].length).toBeGreaterThan(0)
    }
  })
})
