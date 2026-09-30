/** Responsive + themes sur le build de demonstration. */
const EMAIL = 'dr.sahed@demo.cabinet'
const MDP = 'DemoSahed2026!'

const TAILLES = [
  ['375x812', 375, 812, 'phone'],
  ['768x1024', 768, 1024, 'tablette'],
  ['1366x768', 1366, 768, 'portable'],
  ['1440x900', 1440, 900, 'bureau'],
]
const PAGES = ['/tableau-de-bord', '/patients', '/rendez-vous', '/rapports']

const MESURE = () => {
  const vw = window.innerWidth
  const res = {
    scrollW: document.documentElement.scrollWidth,
    deborde: document.documentElement.scrollWidth > vw + 1,
    tronques: [],
    // le rail reste-t-il utilisable (visible, non couvert) ?
    rail: null,
  }
  const describe = (e) =>
    (e.tagName.toLowerCase() +
      (e.getAttribute('class') ? '.' + e.getAttribute('class').trim().split(/\s+/)[0] : '')).slice(0, 50)

  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 || b.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (cs.overflowX !== 'hidden' || cs.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      res.tronques.push(describe(el))
    }
  }
  res.tronques = [...new Set(res.tronques)].slice(0, 6)

  const rail = document.querySelector('.rail')
  if (rail) {
    const rr = rail.getBoundingClientRect()
    const cont = document.querySelector('.contenu-principal')
    const cr = cont?.getBoundingClientRect()
    res.rail = {
      position: getComputedStyle(rail).position,
      w: Math.round(rr.width),
      visible: rr.width > 0 && rr.height > 0,
      horsEcran: rr.right > vw + 1 || rr.left < -1,
      // le rail fixe ne doit PAS recouvrir le contenu
      recouvrement: cs2(rail) && cr ? rr.right > cr.left + 1 && cs2(rail) === 'fixed' : false,
    }
  }
  function cs2(e) {
    return getComputedStyle(e).position
  }
  return res
}

export default async function run(page) {
  const resultats = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(MDP)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await page.waitForTimeout(3000)

  for (const theme of ['sombre', 'clair']) {
    for (const [nom, w, h, genre] of TAILLES) {
      await page.setViewportSize({ width: w, height: h })
      for (const chemin of PAGES) {
        await page.goto('http://localhost:3000' + chemin, { waitUntil: 'domcontentloaded' })
        await page.evaluate((t) => {
          localStorage.setItem('sahed-theme', t)
          document.documentElement.setAttribute('data-theme', t)
        }, theme)
        await page
          .waitForFunction(() => !document.querySelector('.rotation, .bandeau-chargement'), { timeout: 25000 })
          .catch(() => { })
        await page.waitForTimeout(1200)
        const m = await page.evaluate(MESURE)
        resultats.push({ theme, genre, taille: nom, page: chemin, ...m })
      }
    }
  }
  return {
    total: resultats.length,
    debordements: resultats.filter((r) => r.deborde).map((r) => `${r.page} ${r.taille} ${r.theme}`),
    tronques: resultats.filter((r) => r.tronques.length).map((r) => `${r.page} ${r.taille}: ${r.tronques.join(', ')}`),
    railProblemes: resultats.filter((r) => r.rail && (!r.rail.visible || r.rail.horsEcran || r.rail.recouvrement)).map((r) => `${r.page} ${r.taille}: ${JSON.stringify(r.rail)}`),
    echantillon: resultats.slice(0, 6),
  }
}
