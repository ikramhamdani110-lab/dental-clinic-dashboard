/**
 * Verifie que la configuration REFUSE de demarrer en production avec des
 * reglages non securises (COOKIE_SECURE=false, SESSION_SECRET absent).
 * Ce test ne touche aucune base : il valide le garde-fou de configuration.
 */
import { describe, expect, it } from 'vitest'

import { getEnv, resetEnvCache } from '@backend/config/env'

function avecEnv(valeurs: Record<string, string | undefined>, fn: () => void): void {
  const sauvegarde: Record<string, string | undefined> = {}
  for (const cle of Object.keys(valeurs)) {
    sauvegarde[cle] = process.env[cle]
    if (valeurs[cle] === undefined) delete process.env[cle]
    else process.env[cle] = valeurs[cle]
  }
  resetEnvCache()
  try {
    fn()
  } finally {
    for (const cle of Object.keys(sauvegarde)) {
      if (sauvegarde[cle] === undefined) delete process.env[cle]
      else process.env[cle] = sauvegarde[cle]
    }
    resetEnvCache()
  }
}

const BASE = {
  DATABASE_PROVIDER: 'postgresql',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  APP_URL: 'https://cabinet.example.tld',
  SESSION_SECRET: 'secret-de-test-au-moins-32-caracteres-ok',
  PASSWORD_PEPPER: 'pepper-de-test-16-plus-caracteres',
}

describe('Configuration de production — cookies securises (§38)', () => {
  it('REFUSE COOKIE_SECURE=false en production', () => {
    avecEnv({ ...BASE, NODE_ENV: 'production', COOKIE_SECURE: 'false' }, () => {
      expect(() => getEnv()).toThrow()
    })
  })

  it('REFUSE un SESSION_SECRET absent en production', () => {
    avecEnv({ ...BASE, NODE_ENV: 'production', COOKIE_SECURE: 'true', SESSION_SECRET: undefined }, () => {
      expect(() => getEnv()).toThrow()
    })
  })

  it('ACCEPTE une configuration de production sure', () => {
    avecEnv({ ...BASE, NODE_ENV: 'production', COOKIE_SECURE: 'true' }, () => {
      const env = getEnv()
      expect(env.COOKIE_SECURE).toBe(true)
      expect(env.NODE_ENV).toBe('production')
    })
  })
})