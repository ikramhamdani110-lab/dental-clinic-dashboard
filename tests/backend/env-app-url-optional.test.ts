/**
 * =============================================================================
 *  TEST DE RÉGRESSION — APP_URL OPTIONNELLE (bug production Vercel preview)
 * =============================================================================
 *
 *  BUG PRODUCTION OBSÉRVÉ (preview Vercel, commit e4e5241) :
 *    Toute requête authentifiée (login, /api/dashboard/pdf,
 *    /api/patients/:id/pdf) échouait avec :
 *
 *      Error: Configuration d'environnement invalide. Verification interrompue:
 *        - APP_URL : Required
 *
 *    Le déploiement preview n'hérite pas de la variable APP_URL que la
 *    production possède. Le schéma la déclarait REQUIRED, donc le premier
 *    appel à getEnv() levait et tuerait TOUTE la fonction serverless —
 *    indépendamment du reste du code (les polices PDFKit étaient déjà
 *    corrigées ; c'est la validation d'env qui bloquait avant).
 *
 *  CORRECTIF : APP_URL devient optionnelle. Elle n'est lue par AUCUN autre
 *  module que le schéma lui-même (détection d'hôte local pour assouplir
 *  COOKIE_SECRET… enfin, COOKIE_SECURE, réservée au bureau). Les règles de
 *  production restent intactes :
 *    - COOKIE_SECURE=true requis en production SAUF si APP_URL pointe sur
 *      localhost/127.0.0.1 (bureau) ;
 *    - SESSION_SECRET requis en production.
 *  Sans APP_URL, l'hôte est considéré NON local → règles de prod normales.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = resolve(__dirname, '..', '..')
const schemaSrc = () => readFileSync(resolve(racine, 'backend/config/env.ts'), 'utf8')

describe('Schéma env — APP_URL optionnelle (bug preview Vercel)', () => {
  it('APP_URL n\'est plus required dans le schéma', () => {
    const code = schemaSrc()
    // L'ancienne déclaration exigeait la variable : z.string().url(...) directe.
    expect(code).not.toMatch(/APP_URL:\s*z\.string\(\)\.url\(/)
    // La nouvelle déclaration est optionnelle et documentée.
    expect(code).toMatch(/APP_URL:\s*z\s*\n?\s*\.string\(\)/)
    expect(code).toContain('.optional()')
  })

  it('sans APP_URL, l\'hôte n\'est PAS considéré local (règles prod intactes)', () => {
    const code = schemaSrc()
    // Garde-fou explicite : absence → non-local.
    expect(code).toContain('if (!value.APP_URL) return false')
    // Les deux règles de production restent appliquées.
    expect(code).toContain('COOKIE_SECURE doit valoir')
    expect(code).toContain('SESSION_SECRET est obligatoire en production')
  })

  it('le correctif est documenté avec la cause racine (preview sans héritage)', () => {
    const code = schemaSrc()
    expect(code).toContain('preview')
    expect(code).toContain('APP_URL : Required')
  })
})
