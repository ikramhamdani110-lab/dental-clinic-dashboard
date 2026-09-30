/** Inspecte les libelles exacts des boutons du formulaire patient et de la fiche. */
const EMAIL = 'dr.sahed@demo.cabinet'
const MDP = 'DemoSahed2026!'

export default async function run(page) {
  const attendre = (ms) => page.waitForTimeout(ms)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(MDP)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await attendre(2500)

  const out = {}

  // Formulaire de creation de patient
  await page.goto('http://localhost:3000/patients/nouveau', { waitUntil: 'networkidle' })
  await attendre(2000)
  out.formPatient = await page.locator('button, input[type="submit"]').evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      type: e.getAttribute('type'),
      texte: (e.textContent || '').trim().slice(0, 40),
      aria: e.getAttribute('aria-label'),
      disabled: e.disabled,
    })),
  )

  // Fiche d'un patient existant
  await page.goto('http://localhost:3000/patients/', { waitUntil: 'networkidle' })
  await attendre(2500)
  const lien = page.locator('a[href^="/patients/"]').first()
  if ((await lien.count()) > 0) {
    await lien.click()
    await page.waitForURL(/\/patients\/[0-9a-f-]{20,}/, { timeout: 30000 }).catch(() => { })
    await attendre(3000)
    out.urlFiche = page.url()
    out.tabs = await page.getByRole('tab').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()))
    out.boutonsFiche = await page.locator('button').evaluateAll((els) =>
      els.map((e) => (e.textContent || '').trim().slice(0, 40)).filter(Boolean),
    )
  }

  return out
}
