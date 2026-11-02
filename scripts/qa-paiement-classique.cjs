/* Paiement CLASSIQUE — patient avec traitement existant (régression du flux original). */
const http = require('http')
const { execFileSync } = require('child_process')

function req(port, o) {
  return new Promise((res) => {
    const h = { 'Content-Type': 'application/json' }
    if (o.cookie) h.Cookie = o.cookie
    if (o.csrf) h['x-csrf-token'] = o.csrf
    const q = http.request({ host: '127.0.0.1', port, path: o.path, method: o.method || 'GET', headers: h }, (r) => {
      let b = ''
      r.on('data', (c) => (b += c))
      r.on('end', () => res({ s: r.statusCode, sc: r.headers['set-cookie'], body: b }))
    })
    q.on('error', (e) => res({ err: e.message }))
    if (o.corps) q.write(JSON.stringify(o.corps))
    q.end()
  })
}

function q(sql) {
  return execFileSync(
    'C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-h', '127.0.0.1', '-p', '5433', '-U', 'demo', '-d', 'sahed_demo_clinic', '-A', '-t', '-c', sql],
    { env: { ...process.env, PGPASSWORD: 'ROeZuJJ8XHkqxLvuieIM5fMh8xraQyPt' }, encoding: 'utf8' },
  ).trim()
}

;(async () => {
  const login = await req(3100, {
    path: '/api/auth/login', method: 'POST',
    corps: { email: 'demo@cabinet.local', password: 'MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA' },
  })
  console.log('0. login :', login.s, (login.body || '').slice(0, 100), 'cookies:', login.sc && login.sc.length)
  const ck = (login.sc || []).map((l) => l.split(';')[0]).join('; ')
  const csrf = (login.sc || []).find((l) => l.startsWith('sahed_csrf='))?.split(';')[0].split('=')[1] ?? ''

  // 1. Patient + traitement existant (12 000 DA) — flux ORIGINAL
  const patient = await req(3100, {
    path: '/api/patients', method: 'POST', cookie: ck, csrf,
    corps: { nom: 'TestClassique', prenom: 'Regression', age: 40, telephone: '0559000222' },
  })
  console.log('1. patient :', patient.s, patient.body.slice(0, 160), patient.err || '')
  const pid = JSON.parse(patient.body).patient?.id

  const traitement = await req(3100, {
    path: '/api/treatments', method: 'POST', cookie: ck, csrf,
    corps: { patientId: pid, typeTraitement: 'Extraction dentaire', prixTotalCentimes: 1200000, statut: 'PLANIFIE' },
  })
  const tid = JSON.parse(traitement.body).traitement?.id
  console.log('2. traitement 12 000 DA :', traitement.status, tid)

  // 3. Paiement ordinaire 7 000 DA affecté DIRECTEMENT au traitement
  const cle = `qa-classique-${Date.now()}`
  const pay = await req(3100, {
    path: '/api/payments', method: 'POST', cookie: ck, csrf,
    corps: {
      patientId: pid, treatmentId: tid, montantCentimes: 700000,
      datePaiement: new Date().toISOString(), idempotencyKey: cle,
    },
  })
  console.log('3. paiement 7 000 DA sur traitement :', pay.status, pay.body.slice(0, 120))

  // 4. Solde : payé 7 000, reste 5 000
  console.log('4. solde traitement :',
    q(`SELECT count(*) || ' paiement(s), paye=' || COALESCE(SUM("montantCentimes"),0) || ' centimes (attendu 700000)'
      FROM payments WHERE "treatmentId"='${tid}' AND statut='VALIDE';`))
  console.log('   total traitement :', q(`SELECT "prixTotalCentimes" FROM treatments WHERE id='${tid}';`))

  // 5. Paiement EXCEDANT : 9 000 DA sur traitement de 12 000 avec 7 000 déjà payé (reste 5 000)
  const trop = await req(3100, {
    path: '/api/payments', method: 'POST', cookie: ck, csrf,
    corps: { patientId: pid, treatmentId: tid, montantCentimes: 900000, datePaiement: new Date().toISOString(), idempotencyKey: `qa-trop-${Date.now()}` },
  })
  console.log('5. paiement excedant (doit refuser) :', trop.status, trop.body.slice(0, 160))

  // 6. Idempotence classique
  await req(3100, {
    path: '/api/payments', method: 'POST', cookie: ck, csrf,
    corps: { patientId: pid, treatmentId: tid, montantCentimes: 700000, datePaiement: new Date().toISOString(), idempotencyKey: cle },
  })
  console.log('6. après rejeu (doublon ?) :', q(`SELECT count(*) FROM payments WHERE "patientId"='${pid}';`), '(attendu 1)')
})()
