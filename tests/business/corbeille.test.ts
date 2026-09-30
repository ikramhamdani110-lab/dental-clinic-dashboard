import { describe, expect, it } from 'vitest'

import { TRASH_WINDOW_MS } from '@backend/domain/constants'
import { calculerExpiration, estRestaurable } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  CORBEILLE — EXACTEMENT 24 HEURES (§23)
 * =============================================================================
 *
 *  Ces tests verrouillent la regle la plus sensible de la specification :
 *  la fenetre de restauration vaut 24 heures, ni 30 ni 90 jours, et elle n'est
 *  pas configurable. Ils s'executent sans base : les fonctions testees sont
 *  pures.
 */

describe('Fenetre de restauration — EXACTEMENT 24 heures', () => {
  it('la constante du domaine vaut exactement 24 heures', () => {
    expect(TRASH_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(TRASH_WINDOW_MS).toBe(86_400_000)
  })

  it('ce n’est pas 30 jours', () => {
    expect(TRASH_WINDOW_MS).not.toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('ce n’est pas 90 jours', () => {
    expect(TRASH_WINDOW_MS).not.toBe(90 * 24 * 60 * 60 * 1000)
  })

  it('l’expiration vaut exactement la date de suppression + 24 h', () => {
    const supprimeLe = new Date('2025-03-10T14:30:00.000Z')
    const expireLe = calculerExpiration(supprimeLe)
    expect(expireLe.getTime() - supprimeLe.getTime()).toBe(86_400_000)
    expect(expireLe.toISOString()).toBe('2025-03-11T14:30:00.000Z')
  })
})

describe('Restaurabilite (§23)', () => {
  const supprimeLe = new Date('2025-03-10T14:30:00.000Z')
  const expireLe = calculerExpiration(supprimeLe)

  it('un element supprime il y a une heure est restaurable', () => {
    const maintenant = new Date('2025-03-10T15:30:00.000Z')
    expect(estRestaurable(expireLe, maintenant)).toBe(true)
  })

  it('un element supprime il y a 23 h 59 est encore restaurable', () => {
    const maintenant = new Date('2025-03-11T14:29:00.000Z')
    expect(estRestaurable(expireLe, maintenant)).toBe(true)
  })

  it('un element supprime depuis exactement 24 h n’est PLUS restaurable', () => {
    // A l'instant exact d'expiration, la restauration est refusee : la fenetre
    // est close. C'est le comportement attendu d'une borne stricte.
    expect(estRestaurable(expireLe, expireLe)).toBe(false)
  })

  it('un element supprime depuis 24 h 01 n’est PLUS restaurable', () => {
    const maintenant = new Date('2025-03-11T14:31:00.000Z')
    expect(estRestaurable(expireLe, maintenant)).toBe(false)
  })

  it('un element supprime depuis 3 jours n’est PLUS restaurable', () => {
    const maintenant = new Date('2025-03-13T14:30:00.000Z')
    expect(estRestaurable(expireLe, maintenant)).toBe(false)
  })
})
