/**
 * Audit DEFINITIF : 6 pages + une modale, sur les 7 tailles demandees.
 * Attend reellement les donnees avant de mesurer.
 */
const TAILLES = [
  ['375x812', 375, 812],
  ['390x844', 390, 844],
  ['430x932', 430, 932],
  ['768x1024', 768, 1024],
  ['1024x768', 1024, 768],
  ['1366x768', 1366, 768],
  ['1440x900', 1440, 900],
]

const FICHE = '/patients/26401879-6a4d-4116-ac34-994e30da1753'

const MESURE = () => {
  const vw = window.innerWidth
  const d = (el) =>
    (el.tagName.toLowerCase() +
      (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).slice(0, 3).join('.') : '')
    ).slice(0, 64)
  const r = { vw, scrollW: document.documentElement.scrollWidth, problemes: [], mesures: {} }

  const hasScrollAncestor = (el) => {
    let a = el.parentElement
    while (a && a !== document.body) {
      const cs = getComputedStyle(a)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll')
        return a
      a = a.parentElement
    }
    return null
  }

  // 1. debordement horizontal (en ignorant les conteneurs de tableau voulus)
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (b.right > vw + 1 && !hasScrollAncestor(el))
      r.problemes.push(`DEBORDE ${d(el)} right=${Math.round(b.right)} w=${Math.round(b.width)}`)
    // texte tronque sans ellipsis ni ascenseur
    if (
      b.width > 4 &&
      el.scrollWidth > el.clientWidth + 2 &&
      cs.overflowX === 'hidden' &&
      cs.textOverflow !== 'ellipsis' &&
      !el.classList.contains('visuellement-cache') &&
      !hasScrollAncestor(el)
    )
      r.problemes.push(`TEXTE TRONQUE ${d(el)} ${el.scrollWidth}>${el.clientWidth}`)
  }
  if (r.scrollW > vw + 1) r.problemes.push(`SCROLL H PAGE ${r.scrollW}>${vw}`)

  // 2. grille des indicateurs : colonnes, lignes, trous
  const gs = document.querySelector('.grille-statistiques')
  if (gs) {
    const cartes = Array.from(gs.children)
    const rects = cartes.map((c) => c.getBoundingClientRect())
    const gr = gs.getBoundingClientRect()
    const lignes = []
    for (const x of rects) if (!lignes.some((t) => Math.abs(t - x.top) < 4)) lignes.push(x.top)
    const parLigne = new Map()
    rects.forEach((x) => {
      const k = Math.round(x.top / 10)
      if (!parLigne.has(k)) parLigne.set(k, [])
      parLigne.get(k).push(x)
    })
    const trous = [...parLigne.values()].map((rs) => Math.round(gr.right - Math.max(...rs.map((x) => x.right))))
    r.mesures.grille = {
      cartes: cartes.length,
      colonnes: getComputedStyle(gs).gridTemplateColumns,
      nbLignes: lignes.length,
      largeurCarte: Math.round(rects[0].width),
      trousParLigne: trous,
    }
    // une ligne dont la derniere carte laisse un trou = carte orpheline
    if (trous.some((t) => t > 30))
      r.problemes.push(`GRILLE : carte orpheline, trou de ${Math.max(...trous)}px sur une ligne`)
  }

  // 3. tableau
  const tab = document.querySelector('table.tableau')
  if (tab) {
    const ct = tab.closest('.tableau-conteneur')
    const mode = getComputedStyle(tab.querySelector('thead')).display === 'none' ? 'CARTES' : 'TABLEAU'
    r.mesures.tableau = {
      mode,
      largeurTable: Math.round(tab.getBoundingClientRect().width),
      largeurConteneur: ct ? Math.round(ct.getBoundingClientRect().width) : null,
      debordInterne: ct ? ct.scrollWidth > ct.clientWidth + 1 : false,
    }
    if (mode === 'CARTES' && ct && ct.scrollWidth > ct.clientWidth + 1)
      r.problemes.push('MODE CARTES : le bloc defile encore horizontalement')
  }

  // 4. champs et boutons
  for (const c of document.querySelectorAll('.champ-controle')) {
    const b = c.getBoundingClientRect()
    if (b.width > 0 && b.width < 100) r.problemes.push(`CHAMP ETROIT ${Math.round(b.width)}px`)
  }
  for (const b of document.querySelectorAll('.bouton:not(.bouton-lien)')) {
    const x = b.getBoundingClientRect()
    if (x.width > 0 && x.right > vw + 1) r.problemes.push(`BOUTON HORS ECRAN right=${Math.round(x.right)}`)
  }

  // 5. rail
  const rail = document.querySelector('.rail')
  if (rail) {
    const rr = rail.getBoundingClientRect()
    const cs = getComputedStyle(rail)
    r.mesures.rail = {
      position: cs.position,
      w: Math.round(rr.width),
      h: Math.round(rr.height),
      basHorsEcran: rr.bottom > window.innerHeight + 1,
      scrollH: rail.scrollWidth > rail.clientWidth + 1,
    }
    if (rr.bottom > window.innerHeight + 1 && cs.position !== 'sticky')
      r.problemes.push(`RAIL TROP HAUT (bas=${Math.round(rr.bottom)} > ${window.innerHeight})`)
    const cont = document.querySelector('.contenu-principal')
    if (cont && cs.position === 'fixed') {
      const cr = cont.getBoundingClientRect()
      if (rr.right > cr.left + 1) r.problemes.push('RAIL RECOUVRE LE CONTENU')
    }
    // icones
    const ic = Array.from(rail.querySelectorAll('.rail-icone'))
    if (ic.length && !ic.every((i) => { const x = i.getBoundingClientRect(); return x.width > 4 && x.left >= rr.left - 1 && x.right <= rr.right + 1 }))
      r.problemes.push('ICONES DU RAIL : une icone invisible ou hors du rail')
  }

  // 6. modale
  const mod = document.querySelector('.modale')
  if (mod) {
    const m = mod.getBoundingClientRect()
    r.mesures.modale = {
      w: Math.round(m.width), h: Math.round(m.height),
      top: Math.round(m.top), left: Math.round(m.left),
      debordH: mod.scrollWidth > mod.clientWidth + 1,
      horsVue: m.left < -1 || m.right > vw + 1 || m.top < -1,
    }
    if (r.mesures.modale.horsVue) r.problemes.push('MODALE HORS VIEWPORT')
    if (r.mesures.modale.debordH) r.problemes.push('MODALE : debordement horizontal interne')
  }

  // 7. grands espaces verticaux
  const blocs = Array.from(document.querySelectorAll('.contenu-principal > *'))
  for (let i = 0; i < blocs.length - 1; i++) {
    const gap = blocs[i + 1].getBoundingClientRect().top - blocs[i].getBoundingClientRect().bottom
    if (gap > 150) r.problemes.push(`ESPACE VERTICAL ${Math.round(gap)}px apres ${d(blocs[i])}`)
  }

  // 8. contenu reellement rendu
  r.mesures.contenu = {
    texte: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    stats: document.querySelectorAll('.statistique').length,
    lignes: document.querySelectorAll('tbody tr').length,
    chargement: document.querySelectorAll('.rotation, .bandeau-chargement').length,
  }
  return r
}

export default async function run(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill('ikram@cabinet.dz')
  await page.locator('input[type="password"]').first().fill('ikram123-dentaire')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(3000)

  const PAGES = [
    ['Tableau de bord', '/tableau-de-bord'],
    ['Patients', '/patients'],
    ['Patient profile', FICHE],
    ['Rendez-vous', '/rendez-vous'],
    ['Rapports', '/rapports'],
  ]
  const out = []
  for (const [nom, chemin] of PAGES) {
    for (const [tn, w, h] of TAILLES) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('http://localhost:3000' + chemin, { waitUntil: 'domcontentloaded' })
      await page
        .waitForFunction(() => !document.querySelector('.bandeau-chargement') && !document.querySelector('.rotation'), {
          timeout: 25000,
        })
        .catch(() => { })
      await page.waitForTimeout(1500)
      out.push({ page: nom, taille: tn, ...(await page.evaluate(MESURE)) })
    }
  }
  return out
}
