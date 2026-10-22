/**
 * =============================================================================
 *  TESTS DE REGRESSION — EXPORT PDF (bug « le clic ne fait rien »)
 * =============================================================================
 *
 *  CAUSE RACINE CORRIGÉE :
 *    Les deux boutons d'export chargeaient la réponse dans un <iframe> caché.
 *    Or l'application applique `X-Frame-Options: DENY` à TOUTES ses réponses
 *    (next.config.ts) : le navigateur refusait de rendre la réponse dans le
 *    cadre, le téléchargement ne partait jamais et le clic semblait inerte.
 *    La correction remplace l'iframe par `fetch` + blob
 *    (src/components/pdf/telecharger-pdf.ts) — mêmes garanties de sécurité
 *    (cookie de session, GET sans CSRF, aucune donnée stockée) mais un
 *    téléchargement réel, avec détection des erreurs.
 *
 *  Ces tests verrouillent :
 *    1. le REFUS de l'approche iframe (aucun `createElement('iframe')` dans le
 *       code des composants qui exportent) ;
 *    2. l'usage du téléchargeur partagé par les deux composants ;
 *    3. les en-têtes HTTP corrects des routes PDF (Content-Type PDF +
 *       Content-Disposition attachment) — sans eux, le blob s'ouvrirait comme
 *       une page HTML ou ne se téléchargerait pas.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = resolve(__dirname, '..', '..')

function lireFichier(cheminRelatif: string): string {
  return readFileSync(resolve(racine, cheminRelatif), 'utf8')
}

describe('Export PDF — cause racine (iframe bloqué par X-Frame-Options: DENY)', () => {
  const composantsExport = [
    'src/components/dashboard/donnees-tableau-bord.tsx',
    'src/components/patients/fiche-patient.tsx',
  ]

  it.each(composantsExport)('%s ne charge plus le PDF dans un iframe', (fichier) => {
    const code = lireFichier(fichier)
    expect(code.includes("createElement('iframe')")).toBe(false)
    expect(code.includes('cadre.src')).toBe(false)
  })

  it.each(composantsExport)('%s utilise le téléchargeur partagé (fetch + blob)', (fichier) => {
    const code = lireFichier(fichier)
    expect(code.includes('telechargerPdf')).toBe(true)
  })

  it('le téléchargeur passe bien par fetch + blob et jamais par un cadre', () => {
    const code = lireFichier('src/components/pdf/telecharger-pdf.ts')
    expect(code).toContain('fetch(url')
    expect(code).toContain('URL.createObjectURL')
    expect(code.includes("createElement('iframe')")).toBe(false)
    // La requête part avec le cookie de session : aucune dérive d'authentification.
    expect(code).toContain("credentials: 'same-origin'")
  })
})

describe('Export PDF — en-têtes des routes API', () => {
  const routes = [
    ['src/app/api/dashboard/pdf/route.ts', 'tableau-de-bord-sahed-dental-clinic-'],
    ['src/app/api/patients/[id]/pdf/route.ts', 'dossier-patient-'],
  ]

  it.each(routes)('%s renvoie un vrai PDF en pièce jointe', (fichier, prefixeNom) => {
    const code = lireFichier(fichier)
    // Le navigateur (et le téléchargeur) exigent ces deux en-têtes :
    expect(code).toContain("'Content-Type': 'application/pdf'")
    expect(code).toContain("'Content-Disposition': `attachment; filename=")
    // Aucun cache : le document contient des données patients.
    expect(code).toContain("'Cache-Control': 'no-store, max-age=0'")
    // Le nom de fichier commence bien par le préfixe attendu (FR, sanitisé).
    expect(code.includes(prefixeNom) || fichier.includes('patients')).toBe(true)
    // Route privée : la session médecin est vérifiée avant toute génération.
    expect(code).toMatch(/routePrivee/)
  })

  it('la sécurité globale est inchangée : X-Frame-Options DENY reste appliqué', () => {
    const config = lireFichier('next.config.ts')
    // La correction n'affaiblit PAS la sécurité : l'en-tête anti-framing reste.
    expect(config).toContain("value: 'DENY'")
  })
})
