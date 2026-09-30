/**
 * =============================================================================
 *  ISOLATION DES ERREURS DU TABLEAU DE BORD (§33, §36)
 * =============================================================================
 *
 *  Verifie que les barrieres d'erreur existent et que les messages presentes a
 *  l'utilisateur restent GENERIQUES et en FRANCAIS : jamais de SQL, de pile
 *  d'appel, de chemin de fichier, ni de secret.
 *
 *  Ces tests n'ouvrent pas de navigateur : ils verifient les fichiers sources et
 *  la politique de messages. La verification en navigateur (rendu reel, absence
 *  d'erreur React, absence de chargement infini) est faite par le script
 *  `database/scripts/regression-base-vide.mjs`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const racine = fileURLToPath(new URL('../../', import.meta.url))
const lire = (chemin: string): string => readFileSync(`${racine}${chemin}`, 'utf8')

describe('Isolation des erreurs — barrieres de rendu', () => {
  it('une barriere d’erreur couvre le segment du tableau de bord', () => {
    const source = lire('src/app/(dashboard)/error.tsx')
    expect(source).toContain('reset')
    // Client component obligatoire : les barrieres d'erreur s'executent dans le
    // navigateur pour capturer les erreurs de rendu.
    expect(source).toContain("'use client'")
  })

  it('une barriere globale existe pour les erreurs hors mise en page racine', () => {
    const source = lire('src/app/global-error.tsx')
    expect(source).toContain('<html')
    expect(source).toContain('<body')
    expect(source).toContain("'use client'")
  })

  it('la barriere du tableau de bord propose un reessai', () => {
    const source = lire('src/app/(dashboard)/error.tsx')
    expect(source).toContain('reessayer')
  })
})

describe('Isolation des erreurs — messages surs', () => {
  const barrieres = [
    'src/app/(dashboard)/error.tsx',
    'src/app/global-error.tsx',
  ]

  it('n’expose jamais d’internals techniques dans le texte affiche', () => {
    const interdits = [
      /error\.message/, // message technique brut
      /error\.stack/,
      /Prisma/i,
      /SELECT |INSERT |UPDATE |DELETE /,
      /[A-Z]:\\/, // chemin Windows
      /node_modules/,
    ]
    for (const chemin of barrieres) {
      const source = lire(chemin)
      for (const motif of interdits) {
        expect(source, `${chemin} ne doit pas contenir ${motif}`).not.toMatch(motif)
      }
    }
  })

  it('les messages des barrieres sont en francais', () => {
    const source = lire('src/app/(dashboard)/error.tsx')
    expect(source).toMatch(/erreurs\.(titre|sectionIndisponible)/)
  })
})