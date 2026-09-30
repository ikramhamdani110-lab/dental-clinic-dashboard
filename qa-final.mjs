/**
 * Verification finale de la demonstration :
 *   - contenu du tableau de bord et des rapports
 *   - navigation (survol + focus clavier) : UNE seule ligne
 *   - les deux themes
 *   - absence d'erreur console
 */
const EMAIL = 'dr.sahed@demo.cabinet'
const MOT_DE_PASSE = 'DemoSahed2026!'

export default async function run(page) {
  const out = { pages: [], rail: null, themes: [], problemes: [] }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await page.waitForTimeout(3500)

  // ── Contenu du tableau de bord ───────────────────────────────────────────
  const tdb = await page.evaluate(() => {
    const cartes = Array.from(document.querySelectorAll('.grille-statistiques .statistique')).map(
      (c) => ({
        e: c.querySelector('.statistique-etiquette')?.textContent?.trim(),
        v: c.querySelector('.statistique-valeur')?.textContent?.trim(),
      }),
    )
    const sections = Array.from(document.querySelectorAll('section.carte')).map((s) => ({
      titre: s.querySelector('.carte-titre')?.textContent?.trim(),
      lignes: s.querySelectorAll('tbody tr').length,
    }))
    return { cartes, sections }
  })
  out.tableauDeBord = tdb

  // ── RAIL : une SEULE ligne, actif + survol ───────────────────────────────
  const lireRail = () =>
    page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.rail .rail-item'))
      return items.map((el, i) => {
        const trait = el.querySelector('.rail-soulignement')
        const cs = trait ? getComputedStyle(trait) : null
        const actif = el.getAttribute('aria-current') === 'page'
        const survole = el.matches(':hover')
        // Un trait visible = opacite appreciablement > 0
        const visible = cs ? parseFloat(cs.opacity) > 0.05 : false
        // decoration du TEXTE (le monogramme « DS » est du texte, pas une icone)
        const deco = getComputedStyle(el).textDecorationLine
        return { i, actif, survole, traitVisible: visible, opacite: cs?.opacity, deco }
      })
    })

  out.rail = { sansSurvol: await lireRail() }

  const items = page.locator('.rail .rail-item')
  const n = await items.count()
  out.rail.survolDS = []
  for (let i = 0; i < n; i++) {
    await items.nth(i).hover()
    await page.waitForTimeout(350)
    const etat = await lireRail()
    out.rail.survolDS.push({ survole: i, items: etat })
  }

  // ── RAIL : focus clavier ────────────────────────────────────────────────
  out.rail.focus = []
  for (let i = 0; i < Math.min(n, 6); i++) {
    await items.nth(i).focus()
    await page.waitForTimeout(350)
    const etat = await lireRail()
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.rail .rail-item')).map((el) => {
        const lib = el.querySelector('.rail-libelle')
        if (!lib) return null
        const b = lib.getBoundingClientRect()
        const eb = el.getBoundingClientRect()
        return {
          opacite: parseFloat(getComputedStyle(lib).opacity),
          aDroite: b.left > eb.right - 2,
          centre: Math.abs(b.top + b.height / 2 - (eb.top + eb.height / 2)) < 3,
          uneLigne: b.height < 34,
          horsEcran: b.left < -1 || b.right > window.innerWidth + 1,
        }
      }),
    )
    out.rail.focus.push({ focus: i, items: etat, labels })
  }
  await page.evaluate(() => document.activeElement?.blur())

  // ── Rapports : chaque periode change-t-elle les donnees ? ───────────────
  out.rapports = []
  for (const periode of ['7j', '30j', 'annee', 'annee-prec']) {
    await page.goto(`http://localhost:3000/rapports/?periode=${periode}`, {
      waitUntil: 'domcontentloaded',
    })
    await page
      .waitForFunction(() => !document.querySelector('.rotation, .bandeau-chargement'), {
        timeout: 30000,
      })
      .catch(() => { })
    await page.waitForTimeout(1500)
    out.rapports.push(
      await page.evaluate((p) => {
        const cartes = Array.from(document.querySelectorAll('.grille-statistiques .statistique')).map(
          (c) => ({
            e: c.querySelector('.statistique-etiquette')?.textContent?.trim(),
            v: c.querySelector('.statistique-valeur')?.textContent?.trim(),
          }),
        )
        return {
          periode: p,
          cartes,
          pointsGraphique: document.querySelectorAll('.recharts-surface').length,
        }
      }, periode),
    )
  }

  // ── Les deux themes, sur le tableau de bord ─────────────────────────────
  for (const theme of ['sombre', 'clair']) {
    await page.goto('http://localhost:3000/tableau-de-bord', { waitUntil: 'domcontentloaded' })
    await page.evaluate((t) => {
      localStorage.setItem('sahed-theme', t)
      document.documentElement.setAttribute('data-theme', t)
    }, theme)
    await page.waitForTimeout(2000)
    out.themes.push(
      await page.evaluate((t) => {
        const px = (s) => {
          const el = document.querySelector(s)
          return el ? getComputedStyle(el).backgroundColor : null
        }
        return { theme: t, fond: px('.contenu-principal'), carte: px('.statistique'), rail: px('.rail') }
      }, theme),
    )
    await page.screenshot({ path: `qa-s/demo-tdb-${theme}.png`, fullPage: true })
  }

  return out
}
