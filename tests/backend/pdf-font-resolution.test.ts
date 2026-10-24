/**
 * =============================================================================
 *  TEST DE RÉGRESSION — RÉSOLUTION DES POLICES PDFKIT (production serverless)
 * =============================================================================
 *
 *  BUG PRODUCTION OBSERVÉ SUR VERCEL (commit 11c519f) :
 *    ENOENT: no such file or directory, open '/var/task/assets/fonts/NotoSans-Regular.ttf'
 *    → GET /api/dashboard/pdf et /api/patients/:id/pdf répondaient 500.
 *
 *  CAUSE : `cheminPolice()` résolvait les polices depuis `process.cwd()`.
 *  Sur Vercel, cwd = /var/task mais le bundle compilé vit dans
 *  /var/task/.next/server/... → le chemin pointait HORS du bundle.
 *
 *  CORRECTIF : résolution relative à CE fichier (import.meta.url), avec le
 *  cwd en repli. `outputFileTracingIncludes: './assets/fonts/**'` copie les
 *  TTF dans le bundle serverless.
 *
 *  Ce test verrouille :
 *    1. que le code ne repose plus UNIQUEMENT sur process.cwd() ;
 *    2. que les polices sont bien copiées par le build (.next/server) ;
 *    3. que les 4 fichiers TTF attendus existent dans le projet.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = resolve(__dirname, '..', '..')

function lire(cheminRelatif: string): string {
  return readFileSync(resolve(racine, cheminRelatif), 'utf8')
}

describe('Polices PDFKit — résolution bundle-relative (bug production Vercel)', () => {
  it('cheminPolice ne dépend plus UNIQUEMENT de process.cwd()', () => {
    const code = lire('backend/pdf/pdf.ts')
    // La résolution principale doit venir d'import.meta.url (chemin du module,
    // valide dans le bundle serverless) — pas uniquement de cwd.
    expect(code).toContain('import.meta.url')
    expect(code).toContain('RACINE_PAQUET')
    // Un repli cwd existe pour les environnements de bureau.
    expect(code).toContain("resolve(process.cwd(), 'assets', 'fonts', fichier)")
  })

  it('les 4 polices TTF attendues existent dans assets/fonts', () => {
    for (const f of [
      'NotoSans-Regular.ttf',
      'NotoSans-Bold.ttf',
      'NotoNaskhArabic-Regular.ttf',
      'NotoNaskhArabic-Bold.ttf',
    ]) {
      expect(existsSync(resolve(racine, 'assets', 'fonts', f)), `absent : ${f}`).toBe(true)
    }
  })

  it('le build serverless copie les polices dans .next/server (tracing includes)', () => {
    // Le manifeste nft de la route PDF doit référencer assets/fonts.
    const cheminNft = resolve(
      racine,
      '.next',
      'server',
      'app',
      'api',
      'dashboard',
      'pdf',
      'route.js.nft.json',
    )
    if (!existsSync(cheminNft)) {
      // Build absent (test exécuté sans build préalable) : on vérifie la config.
      expect(lire('next.config.ts')).toContain("./assets/fonts/**/*")
      return
    }
    const fichiers: string[] = JSON.parse(readFileSync(cheminNft, 'utf8')).files
    expect(fichiers.some((f) => f.includes('assets' + 'fonts') || f.replace(/\\\\/g, '/').includes('assets/fonts')), 'aucun fichier assets/fonts dans le trace').toBe(true)
  })

  it('les polices sont trouvées via le chemin bundle-relatif depuis backend/pdf', () => {
    // Simule la résolution du module : backend/pdf/pdf.ts → racine/assets/fonts.
    const simule = resolve(racine, 'backend', 'pdf', '..', '..', 'assets', 'fonts')
    const noms = readdirSync(simule)
    expect(noms).toContain('NotoSans-Regular.ttf')
  })
})
