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
 *  CORRECTIF v1 (commit e4e5241) : résolution relative à CE fichier
 *  (import.meta.url), cwd en repli.
 *
 *  BUG RÉSIDUEL OBSERVÉ EN PRODUCTION (déploiement eb8243b3, logs Vercel) :
 *    la même ENOENT persiste — car Next.js RÉÉCRIT import.meta.url avec le
 *    chemin de la MACHINE DE BUILD (file:///C:/Users/.../backend/pdf.ts), tel
 *    quel dans le bundle compilé. Ce chemin n'existe pas dans la lambda, et le
 *    repli cwd n'était pas atteint (cascade à un seul candidat).
 *
 *  CORRECTIF v2 : `cheminPolice()` essaie une CASCADE de candidats basés sur
 *  process.cwd() uniquement (fiable en serverless : /var/task, où Vercel copie
 *  les fichiers tracés via outputFileTracingIncludes) et lève une erreur
 *  EXPLICITE si aucune police n'est trouvée — jamais un PDF muet.
 *
 *  Ce test verrouille :
 *    1. que la cascade de candidats cwd est en place (aucun import.meta.url
 *       exécutable) ;
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

describe('Polices PDFKit — résolution des polices en serverless (Vercel)', () => {
  it('cheminPolice utilise une cascade de candidats basés sur cwd', () => {
    const code = lire('backend/pdf/pdf.ts')
    // Sur Vercel, Next réécrit import.meta.url avec le chemin de BUILD (hors
    // lambda) : la résolution ne doit JAMAIS s'en servir (hors commentaires).
    const sansCommentaires = code
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(sansCommentaires).not.toContain('import.meta.url')
    expect(sansCommentaires).not.toContain('fileURLToPath')
    // Cascade cwd : /var/task (Vercel), racine (dev, next start, bureau).
    expect(code).toContain("resolve(process.cwd(), 'assets', 'fonts', fichier)")
    // Erreur explicite si rien n'est trouvé — pas de repli silencieux.
    expect(code).toContain('Police PDF introuvable')
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
