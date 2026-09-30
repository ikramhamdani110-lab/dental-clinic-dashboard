/** Suggestions : nom seul, et liste presente. */
export default async function run(page) {
  const attendre = (ms) => page.waitForTimeout(ms)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill('dr.sahed@demo.cabinet')
  await page.locator('input[type="password"]').first().fill('DemoSahed2026!')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await attendre(2500)

  await page.goto('http://localhost:3000/rendez-vous/nouveau', { waitUntil: 'networkidle' })
  await attendre(3000)

  const champ = page.locator('#nom-patient-rendez-vous').first()
  await champ.click()
  await champ.type('a', { delay: 60 })
  // on attend l'apparition REELLE d'une option
  await page
    .waitForSelector('#suggestions-patients-rendez-vous [role="option"]', { timeout: 20000 })
    .catch(() => { })
  await attendre(1200)

  const brut = await page.evaluate(() => {
    const zone = document.querySelector('#suggestions-patients-rendez-vous')
    return {
      zoneExiste: !!zone,
      texte: zone ? zone.innerText.replace(/\s+/g, ' ').slice(0, 200) : null,
      options: zone
        ? Array.from(zone.querySelectorAll('[role="option"]')).map((o) => ({
          texte: o.textContent.trim(),
          enfants: o.children.length,
          aPhone: /\d{2}\s?\d{2}/.test(o.textContent),
          aAge: /\b\d{2}\s?ans\b/.test(o.textContent),
        }))
        : [],
    }
  })
  return brut
}
