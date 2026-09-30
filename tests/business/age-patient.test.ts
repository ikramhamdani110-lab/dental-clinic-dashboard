import { describe, expect, it } from 'vitest'

import { calculerAge, formaterAge } from '@/lib/age'

/**
 * =============================================================================
 *  REGRESSION — AGE DU PATIENT
 * =============================================================================
 *
 *  L'age affiche est CALCULE depuis la date de naissance, jamais stocke.
 *
 *  Ce qui est verrouille ici :
 *    - le singulier « 1 an » et le pluriel « N ans » (jamais « 1 ans ») ;
 *    - l'anniversaire : l'age ne change QU'AU jour de l'anniversaire, pas au
 *      1er janvier. C'est le point qui casse le plus souvent dans ce genre de
 *      calcul, et une erreur d'un an sur un dossier dentaire n'est pas anodine ;
 *    - les cas limites : date absente, date invalide, date future.
 *
 *  Les dates sont construites RELATIVEMENT a aujourd'hui : le test reste donc
 *  juste quelle que soit la date d'execution.
 */

/** Date de naissance decalee de `annees` ans, en conservant mois et jour. */
function neEn(annees: number, decalageJours = 0): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() - annees)
  date.setDate(date.getDate() + decalageJours)
  return date.toISOString()
}

describe('calculerAge', () => {
  it('renvoie l’age en annees revolues', () => {
    expect(calculerAge(neEn(24))).toBe(24)
    expect(calculerAge(neEn(7))).toBe(7)
    expect(calculerAge(neEn(1))).toBe(1)
  })

  it('un anniversaire non encore atteint retire une annee', () => {
    // Ne il y a 24 ans, mais 1 jour APRES la date d'anniversaire de cette
    // annee : il n'a donc pas encore 24 ans revolues.
    const pasEncore = new Date()
    pasEncore.setFullYear(pasEncore.getFullYear() - 24)
    pasEncore.setDate(pasEncore.getDate() + 1)
    expect(calculerAge(pasEncore.toISOString())).toBe(23)
  })

  it('un anniversaire atteint aujourd’hui donne l’age plein', () => {
    expect(calculerAge(neEn(30, 0))).toBe(30)
  })

  it('un patient ne de l’an dernier a bien 1 an, pas 0', () => {
    expect(calculerAge(neEn(1))).toBe(1)
  })

  it('renvoie null pour une date absente', () => {
    expect(calculerAge(null)).toBeNull()
    expect(calculerAge(undefined)).toBeNull()
    expect(calculerAge('')).toBeNull()
  })

  it('renvoie null pour une date invalide', () => {
    expect(calculerAge('pas-une-date')).toBeNull()
  })

  it('renvoie null pour une date de naissance FUTURE', () => {
    const futur = new Date()
    futur.setFullYear(futur.getFullYear() + 1)
    expect(calculerAge(futur.toISOString())).toBeNull()
  })
})

describe('formaterAge', () => {
  it('CAS « 1 an » — singulier, jamais « 1 ans »', () => {
    expect(formaterAge(neEn(1))).toBe('1 an')
  })

  it('CAS « 7 ans » — pluriel', () => {
    expect(formaterAge(neEn(7))).toBe('7 ans')
  })

  it('CAS « 24 ans » — pluriel', () => {
    expect(formaterAge(neEn(24))).toBe('24 ans')
  })

  it('age inconnu : tiret, jamais « 0 an » ni « null »', () => {
    expect(formaterAge(null)).toBe('—')
    expect(formaterAge('pas-une-date')).toBe('—')
  })
})