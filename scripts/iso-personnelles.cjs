/* Prouve que les écritures personnelles ne touchent JAMAIS les totaux du cabinet. */
const http = require('http')

function appel({ port, path, methode = 'GET', corps, cookie, csrf }) {
  return new Promise((resolve) => {
    const entetes = { 'Content-Type': 'application/json' }
    if (cookie) entetes.Cookie = cookie
    if (csrf) entetes['x-finance-csrf-token'] = csrf
    const req = http.request({ host: '127.0.0.1', port, path, method: methode, headers: entetes }, (r) => {
      let body = ''
      r.on('data', (c) => (body += c))
      r.on('end', () => resolve({ status: r.statusCode, setCookie: r.headers['set-cookie'], body }))
    })
    req.on('error', (e) => resolve({ err: e.message }))
    if (corps) req.write(JSON.stringify(corps))
    req.end()
  })
}

function cookies(setCookies = []) {
  const carte = {}
  for (const ligne of setCookies) {
    const p = ligne.split(';')[0]
    const i = p.indexOf('=')
    carte[p.slice(0, i)] = p.slice(i + 1)
  }
  return Object.entries(carte).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function principal() {
  const login = await appel({
    port: 3200, path: '/api/finances/auth', methode: 'POST',
    corps: { email: 'demo@cabinet.local', password: 'MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA' },
  })
  const ck = cookies(login.setCookie)
  // Jeton CSRF financier : cookie lisible posé à la connexion.
  const csrf = (login.setCookie ?? []).find((l) => l.startsWith('sahed_finance_csrf='))?.split(';')[0].split('=')[1] ?? ''

  const avant = JSON.parse((await appel({ port: 3200, path: '/api/finances/summary?periode=mois', cookie: ck })).body)

  // Créer trois écritures personnelles : revenu, dépense, dette.
  const cle = () => `qa-iso-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const revenue = await appel({
    port: 3200, path: '/api/finances/personal-transactions', methode: 'POST', cookie: ck, csrf,
    corps: { montantCentimes: 99900, nature: 'REVENUE', titre: 'Iso-test revenu', date: new Date().toISOString().slice(0, 10), idempotencyKey: cle() },
  })
  const depense = await appel({
    port: 3200, path: '/api/finances/personal-transactions', methode: 'POST', cookie: ck, csrf,
    corps: { montantCentimes: 50000, nature: 'DEPENSE', titre: 'Iso-test dépense', date: new Date().toISOString().slice(0, 10), idempotencyKey: cle() },
  })
  const dette = await appel({
    port: 3200, path: '/api/finances/personal-transactions', methode: 'POST', cookie: ck, csrf,
    corps: { montantCentimes: 12345, nature: 'DETTE_PERSONNELLE', direction: 'DO', titre: 'Iso-test dette', date: new Date().toISOString().slice(0, 10), idempotencyKey: cle() },
  })
  console.log('créations personnelles :', revenue.status, depense.status, dette.status)

  const apres = JSON.parse((await appel({ port: 3200, path: '/api/finances/summary?periode=mois', cookie: ck })).body)

  const inchanges =
    avant.revenusPaiementsCentimes === apres.revenusPaiementsCentimes &&
    avant.revenusManuelsCentimes === apres.revenusManuelsCentimes &&
    avant.depensesCentimes === apres.depensesCentimes &&
    avant.restantDuCentimes === apres.restantDuCentimes

  console.log('AVANT  :', JSON.stringify({ recus: avant.revenusPaiementsCentimes, manuels: avant.revenusManuelsCentimes, dep: avant.depensesCentimes, dettes: avant.restantDuCentimes }))
  console.log('APRES  :', JSON.stringify({ recus: apres.revenusPaiementsCentimes, manuels: apres.revenusManuelsCentimes, dep: apres.depensesCentimes, dettes: apres.restantDuCentimes }))
  console.log('RESULTAT :', inchanges ? 'TOTAUX CLINIQUE INCHANGÉS ✓' : '*** DIVERGENCE ***')

  // Nettoyage : supprimer les trois écritures de test.
  const liste = JSON.parse((await appel({ port: 3200, path: '/api/finances/personal-transactions?page=1&taille=10', cookie: ck })).body)
  for (const ligne of liste.elements.filter((l) => l.titre.startsWith('Iso-test'))) {
    await appel({ port: 3200, path: `/api/finances/personal-transactions/${ligne.id}`, methode: 'DELETE', cookie: ck })
  }
  console.log('nettoyage : écritures Iso-test supprimées')
}

principal()
