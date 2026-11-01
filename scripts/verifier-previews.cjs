/* Verification de bout en bout des deux previews (jetable, base de démo). */
const http = require('http')

function appel({ port, path, methode = 'GET', corps, cookie, csrf }) {
  return new Promise((resolve) => {
    const entetes = { 'Content-Type': 'application/json' }
    if (cookie) entetes.Cookie = cookie
    if (csrf) entetes['x-finance-csrf-token'] = csrf
    const req = http.request(
      { host: '127.0.0.1', port, path, method: methode, headers: entetes },
      (r) => {
        let body = ''
        r.on('data', (c) => (body += c))
        r.on('end', () =>
          resolve({ status: r.statusCode, loc: r.headers.location, setCookie: r.headers['set-cookie'], body }),
        )
      },
    )
    req.on('error', (e) => resolve({ err: e.message }))
    if (corps) req.write(JSON.stringify(corps))
    req.end()
  })
}

function cookiesVersCarte(setCookies = []) {
  const carte = {}
  for (const ligne of setCookies) {
    const paire = ligne.split(';')[0]
    const i = paire.indexOf('=')
    carte[paire.slice(0, i)] = paire.slice(i + 1)
  }
  return carte
}

async function principal() {
  const pageSecr = await appel({ port: 3100, path: '/connexion' })
  console.log('[1] connexion secretaire 3100 :', pageSecr.status)

  const pageFin = await appel({ port: 3200, path: '/finances/connexion' })
  console.log('[2] connexion finances 3200  :', pageFin.status, '| banner demo:', pageFin.body.includes('démonstration'))

  const tdb = await appel({ port: 3100, path: '/tableau-de-bord' })
  console.log('[3] tableau-de-bord sans session :', tdb.status, '->', tdb.loc)

  const finSans = await appel({ port: 3200, path: '/finances' })
  console.log('[4] finances sans session        :', finSans.status, '->', finSans.loc)

  const apiSans = await appel({ port: 3100, path: '/api/dashboard' })
  console.log('[5] /api/dashboard sans session  :', apiSans.status)

  const essai = await appel({
    port: 3100,
    path: '/api/auth/login',
    methode: 'POST',
    corps: { email: 'demo@cabinet.local', password: 'MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA' },
  })
  console.log('[6] login clinique               :', essai.status)
  const cookiesClinique = cookiesVersCarte(essai.setCookie)
  const enteteClinique = Object.entries(cookiesClinique).map(([k, v]) => `${k}=${v}`).join('; ')

  if (essai.status === 200) {
    const tdb2 = await appel({ port: 3100, path: '/api/dashboard', cookie: enteteClinique })
    const donnees = JSON.parse(tdb2.body).data ?? {}
    const clesFinancieres = Object.keys(donnees).filter((k) => /revenu|montant|totalPaye|restantDu/i.test(k))
    console.log('[7] dashboard avec session       :', tdb2.status, '| champs financiers exposés:', clesFinancieres.length ? clesFinancieres : 'AUCUN')

    const accueil = await appel({ port: 3100, path: '/tableau-de-bord', cookie: enteteClinique })
    console.log('[8] page tableau-de-bord         :', accueil.status, '| mot « revenus » présent:', accueil.body.includes('evenus'))
  }

  const essaiFin = await appel({
    port: 3200,
    path: '/api/finances/auth',
    methode: 'POST',
    corps: { email: 'demo@cabinet.local', password: 'MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA' },
  })
  console.log('[9] login finances               :', essaiFin.status)
  const cookiesFin = cookiesVersCarte(essaiFin.setCookie)
  const enteteFin = Object.entries(cookiesFin).map(([k, v]) => `${k}=${v}`).join('; ')

  if (essaiFin.status === 200) {
    const syn = await appel({ port: 3200, path: '/api/finances/summary?periode=annee', cookie: enteteFin })
    const s = JSON.parse(syn.body) ?? {}
    console.log('[10] synthèse année              :', syn.status,
      '| reçus:', s.revenusPaiementsCentimes, '| dettes:', s.restantDuCentimes, '| dépenses:', s.depensesCentimes)

    for (const boite of ['paiements', 'dettes']) {
      const det = await appel({ port: 3200, path: `/api/finances/details?boite=${boite}&page=1&taille=5`, cookie: enteteFin })
      const d = JSON.parse(det.body) ?? {}
      console.log(`[11] détails ${boite.padEnd(9)}        :`, det.status,
        '| lignes:', d.elements?.length, '| total lignes:', d.total, '| somme boîte:', d.totalCentimes)
    }

    const pers = await appel({ port: 3200, path: '/api/finances/personal-transactions?page=1', cookie: enteteFin })
    const p = JSON.parse(pers.body) ?? {}
    console.log('[12] écritures personnelles      :', pers.status, '| total:', p.total)

    const pagePers = await appel({ port: 3200, path: '/finances/personnel', cookie: enteteFin })
    console.log('[13] page personnel              :', pagePers.status, '| titre présent:', pagePers.body.includes('critures personnelles'))
  }

  if (enteteClinique) {
    const tentative = await appel({ port: 3200, path: '/api/finances/summary?periode=mois', cookie: enteteClinique })
    console.log('[14] API finances avec cookie clinique:', tentative.status, '(attendu 401/403)')
  }
}

principal()
