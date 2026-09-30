/**
 * =============================================================================
 *  REGRESSION — PLANNING DES RENDEZ-VOUS : DEPENDANCES STABLES (§35)
 * =============================================================================
 *
 *  Defaut corrige (crash constate en preview) :
 *
 *    `bornesPeriode(vue, reference)` fabrique de NOUVEAUX objets `Date` a chaque
 *    rendu. Ils etaient passes tels quels comme dependances de `useCallback`,
 *    puis de `useEffect`. Leur identite changeant a chaque rendu, l'effet se
 *    relancait sans fin : `setChargement(true)` provoquait un rendu, qui
 *    recreait les `Date`, qui relancait l'effet... -> BOUCLE DE REQUETES infinie
 *    sur `/api/appointments`, page qui ne finit jamais de charger.
 *
 *  La correction derive des CHAINES ISO (valeurs primitives, comparees par
 *  contenu) : la periode affichee ne change pas -> les dependances ne changent
 *  pas -> l'effet ne se relance pas.
 *
 *  Ce test verifie la PROPRIETE qui rend la correction valable : la derivation
 *  des bornes d'une meme periode produit des chaines STRICTEMENT EGALES.
 */

import { describe, expect, it } from 'vitest'

import { bornesPeriode } from '@/components/rendez-vous/planning-rendez-vous'

const REFERENCE = new Date('2026-09-15T10:30:00.000Z')

describe('Planning des rendez-vous — bornes de periode stables', () => {
  it('derive des chaines ISO identiques pour une meme periode (vue jour)', () => {
    const a = bornesPeriode('jour', REFERENCE)
    const b = bornesPeriode('jour', REFERENCE)
    // Ce sont des OBJETS DIFFERENTS (identite changeante : cause du bug)...
    expect(a.debut).not.toBe(b.debut)
    // ...mais leur representation ISO est STRICTEMENT EGALE (la correction).
    expect(a.debut.toISOString()).toBe(b.debut.toISOString())
    expect(a.fin.toISOString()).toBe(b.fin.toISOString())
  })

  it('derive des chaines ISO identiques pour une meme periode (vue semaine)', () => {
    const a = bornesPeriode('semaine', REFERENCE)
    const b = bornesPeriode('semaine', REFERENCE)
    expect(a.debut.toISOString()).toBe(b.debut.toISOString())
    expect(a.fin.toISOString()).toBe(b.fin.toISOString())
  })

  it('derive des chaines ISO identiques pour une meme periode (vue mois)', () => {
    const a = bornesPeriode('mois', REFERENCE)
    const b = bornesPeriode('mois', REFERENCE)
    expect(a.debut.toISOString()).toBe(b.debut.toISOString())
    expect(a.fin.toISOString()).toBe(b.fin.toISOString())
  })

  it('la vue jour couvre bien une journee complete', () => {
    const { debut, fin } = bornesPeriode('jour', REFERENCE)
    expect(fin.getTime() - debut.getTime()).toBeGreaterThan(23 * 60 * 60 * 1000)
  })

  it('des periodes differentes produisent des chaines differentes', () => {
    const septembre = bornesPeriode('mois', new Date('2026-09-15T10:00:00Z'))
    const octobre = bornesPeriode('mois', new Date('2026-10-15T10:00:00Z'))
    expect(septembre.debut.toISOString()).not.toBe(octobre.debut.toISOString())
  })
})