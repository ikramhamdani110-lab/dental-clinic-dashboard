/**
 * Verification des PERIODES de rapport, avec les VRAIS noms de parametres
 * (`7-jours`, `30-jours`, `annee`, `annee-precedente`, `personnalisee`).
 *
 * On passe par l'INTERFACE : on choisit la periode dans le menu, on clique
 * « Afficher » si besoin, puis on lit ce qui est reellement affiche.
 */
const EMAIL = 'dr.sahed@demo.cabinet'
const MDP = 'DemoSahed2026!'

export default async function run(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(MDP)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await page.waitForTimeout(2000)

  await page.goto('http://localhost:3000/rapports/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // Requetes reellement emises par l'interface, pour chaque periode
  const requetes = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/reports/revenue')) requetes.push(u.replace('http://localhost:3000', ''))
  })

  const lire = () =>
    page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('.grille-statistiques .statistique')).map(
        (c) => ({
          e: c.querySelector('.statistique-etiquette')?.textContent?.trim(),
          v: c.querySelector('.statistique-valeur')?.textContent?.trim(),
        }),
      )
      const points = document.querySelectorAll('.recharts-surface').length
      // bornee de periode affichee
      const borne = document.body.innerText.match(/\d{4}-\d{2}-\d{2}\s*[→-]\s*\d{4}-\d{2}-\d{2}/)?.[0]
      return { cartes, points, borne: borne ?? null }
    })

  const resultats = []

  const menu = page.locator('select#periode-rapport, select[name="periode-rapport"]').first()
  const options = await menu.locator('option').evaluateAll((els) =>
    els.map((e) => ({ valeur: e.value, libelle: e.textContent.trim() })),
  )

  for (const opt of options) {
    if (opt.valeur === 'personnalisee') continue
    await menu.selectOption(opt.valeur)
    await page.waitForTimeout(2200)
    await page
      .waitForFunction(() => !document.querySelector('.rotation, .bandeau-chargement'), {
        timeout: 30000,
      })
      .catch(() => { })
    await page.waitForTimeout(1200)
    const avant = await lire()
    resultats.push({ periode: opt.valeur, libelle: opt.libelle, ...avant })
  }

  // Periode personnalisee : bornes precises, puis « Afficher »
  await menu.selectOption('personnalisee')
  await page.waitForTimeout(800)
  const champDu = page.locator('input[name="periode-du"]').first()
  const champAu = page.locator('input[name="periode-au"]').first()
  const aujourdhui = new Date()
  const ilYA40 = new Date(aujourdhui.getTime() - 40 * 86400000)
  const iso = (d) => d.toISOString().slice(0, 10)
  await champDu.fill(iso(ilYA40))
  await champAu.fill(iso(aujourdhui))
  await page.waitForTimeout(500)
  const bouton = page.getByRole('button', { name: /Afficher/i }).first()
  await bouton.click()
  await page.waitForTimeout(2500)
  resultats.push({ periode: 'personnalisee (40j)', libelle: 'Personnalisee', ...(await lire()) })

  return { options, resultats, requetes: [...new Set(requetes)] }
}
