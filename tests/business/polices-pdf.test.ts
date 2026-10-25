/**
 * =============================================================================
 *  TESTS DE RÉGRESSION — RÉSOLUTION DES POLICES PDF EN PRODUCTION
 * =============================================================================
 *
 *  BUG PRODUCTION (Vercel, observé dans les logs du déploiement) :
 *    ENOENT: no such file or directory, open '/var/task/assets/fonts/NotoSans-Regular.ttf'
 *
 *  CAUSE RACINE : `backend/pdf/pdf.ts` calculait la racine via
 *  `import.meta.url` + remontée de 2 niveaux. Sur Vercel, le compilateur Next
 *  RÉÉCRIT `import.meta.url` avec le chemin de la MACHINE DE BUILD
 *  (file:///C:/Users/.../backend/pdf.ts) — observé tel quel dans le bundle
 *  compilé. Ce chemin n'existe pas dans la lambda, le candidat échoue, et le
 *  repli cwd (correct : /var/task) n'était pas atteint car un seul repli
 *  existait et la cascade n'était pas explicite.
 *
 *  CORRECTION : `cheminPolice()` essaie plusieurs candidats basés uniquement
 *  sur process.cwd() (fiable en serverless : /var/task, où Vercel copie les
 *  fichiers tracés), et lève une erreur explicite si aucune police n'est
 *  trouvée — jamais un PDF avec des glyphes manquants.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = resolve(__dirname, '..', '..')

function lireFichier(cheminRelatif: string): string {
  return readFileSync(resolve(racine, cheminRelatif), 'utf8')
}

describe('Polices PDF — résolution des chemins', () => {
  it('ne se base plus sur import.meta.url (réécrit par Next sur Vercel)', () => {
    const code = lireFichier('backend/pdf/pdf.ts')
    // Aucune LIGNE EXECUTABLE ne doit utiliser import.meta.url ni fileURLToPath
    // (le commentaire d'historique est autorise) : la reecriture Next les rend
    // faux sur Vercel.
    const sansCommentaires = code
      .split('\n')
      .filter((ligne) => !ligne.trim().startsWith('//') && !ligne.trim().startsWith('*'))
      .join('\n')
    expect(sansCommentaires).not.toContain('import.meta.url')
    expect(sansCommentaires).not.toContain('fileURLToPath')
  })

  it('essaie process.cwd() en premier (fiable en serverless : /var/task)', () => {
    const code = lireFichier('backend/pdf/pdf.ts')
    expect(code).toContain("resolve(process.cwd(), 'assets', 'fonts', fichier)")
  })

  it('lève une erreur explicite si aucune police n\'est trouvée', () => {
    const code = lireFichier('backend/pdf/pdf.ts')
    expect(code).toContain('Police PDF introuvable')
    // Pas de repli silencieux vers une police par défaut.
    expect(code).not.toMatch(/catch\s*\(\)\s*{\s*}\s*return\s+resolve/)
  })

  it('les quatre polices Noto sont déclarées dans le paquet', () => {
    const code = lireFichier('backend/pdf/pdf.ts')
    for (const fichier of [
      'NotoSans-Regular.ttf',
      'NotoSans-Bold.ttf',
      'NotoNaskhArabic-Regular.ttf',
      'NotoNaskhArabic-Bold.ttf',
    ]) {
      expect(code).toContain(`'${fichier}'`)
    }
  })

  it('les fichiers TTF existent réellement dans le dépôt', () => {
    for (const fichier of [
      'NotoSans-Regular.ttf',
      'NotoSans-Bold.ttf',
      'NotoNaskhArabic-Regular.ttf',
      'NotoNaskhArabic-Bold.ttf',
    ]) {
      expect(() => lireFichier(`assets/fonts/${fichier}`)).not.toThrow()
    }
  })

  it('next.config inclut les polices dans le trace serverless', () => {
    const config = lireFichier('next.config.ts')
    expect(config).toContain("'./assets/fonts/**/*'")
    expect(config).toContain('outputFileTracingIncludes')
  })
})
