/* ACOMPTE — scénario complet end-to-end via l'API secrétaire (session clinique). */
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
  const ck = (login.sc || []).map((l) => l.split(';')[0]).join('; ')
  const csrf = (login.sc || []).find((l) => l.startsWith('sahed_csrf='))?.split(';')[0].split('=')[1] ?? ''

  // ── 1. Créer un patient SANS traitement ──
  const patient = await req(3100, {
    path: '/api/patients', method: 'POST', cookie: ck, csrf,
    corps: {
      nom: 'TestAcompte' + (Date.now() % 10000), prenom: 'Nouveau', telephone: '0559' + String(Date.now()).slice(-6),
      dateNaissance: '1990-01-01',
    },
  })
  console.log('1. patient créé :', patient.status, patient.body.slice(0, 100))
  const corpsPatient = JSON.parse(patient.body)
  const pid = corpsPatient.id ?? corpsPatient.patient?.id ?? corpsPatient.data?.id

  // ── 2. ACOMPTE 5 000 DA — sans treatmentId ──
  const cle = `qa-acompte-${Date.now()}`
  const acompte = await req(3100, {
    path: '/api/payments', method: 'POST', cookie: ck, csrf,
    corps: {
      patientId: pid,
      montantCentimes: 500000,
      datePaiement: new Date().toISOString(),
      notes: 'Avance avant traitement',
      idempotencyKey: cle,
    },
  })
  console.log('2. acompte 5 000 DA :', acompte.status, acompte.body.slice(0, 120))
  const acompteId = JSON.parse(acompte.body).paiement?.id

  // ── 3. UN SEUL paiement, lié au bon patient, sans traitement ──
  console.log('3. en base :',
    q(`SELECT count(*) || ' paiement(s), treatmentId=' || COALESCE(MIN("treatmentId"::text),'NULL=acompte') || ', montant=' || MIN("montantCentimes")
      FROM payments WHERE "patientId"='${pid}' AND statut='VALIDE';`))

  // ── 4. Idempotence : rejouer la même clé ne crée RIEN ──
  await req(3100, {
    path: '/api/payments', method: 'POST', cookie: ck, csrf,
    corps: {
      patientId: pid, montantCentimes: 500000,
      datePaiement: new Date().toISOString(), idempotencyKey: cle,
    },
  })
  console.log('4. après rejeu (doublon ?) :', q(`SELECT count(*) FROM payments WHERE "patientId"='${pid}';`), '(attendu 1)')

  // ── 5. Visible côté médecin (VALIDE, aujourd'hui) ──
  console.log('5. paiements VALIDE du jour :',
    q(`SELECT count(*) || ' paiement(s), total ' || COALESCE(SUM("montantCentimes"),0) || ' centimes'
       FROM payments WHERE statut='VALIDE' AND "datePaiement"::date = CURRENT_DATE;`))

  // ── 6. Traitement créé PLUS TARD (12 000 DA) ──
  const traitement = await req(3100, {
    path: '/api/treatments', method: 'POST', cookie: ck, csrf,
    corps: {
      patientId: pid,
      typeTraitement: 'Couronne dentaire', prixTotalCentimes: 1200000,
      statut: 'PLANIFIE',
    },
  })
  console.log('6. traitement créé plus tard :', traitement.status, traitement.body.slice(0, 90))
  const corpsTraitement = JSON.parse(traitement.body)
  const tid = corpsTraitement.id ?? corpsTraitement.traitement?.id ?? corpsTraitement.data?.id

  // ── 7. AFFECTATION de l'acompte à ce traitement ──
  const affect = await req(3100, {
    path: `/api/payments/${acompteId}/affecter`, method: 'POST', cookie: ck, csrf,
    corps: { treatmentId: tid },
  })
  console.log('7. affectation acompte :', affect.status, affect.body.slice(0, 120))

  // ── 8. SOLDE CORRECT + PAS DE DOUBLON ──
  console.log('8. solde traitement :',
    q(`SELECT count(*) || ' paiement(s), paye=' || COALESCE(SUM(p."montantCentimes"),0)
      FROM payments p WHERE p."treatmentId"='${tid}' AND p.statut='VALIDE';`))
  console.log('   paiements totaux du patient :',
    q(`SELECT count(*) FROM payments WHERE "patientId"='${pid}';`), '(attendu 1)')
  console.log('   date originale préservée :', q(`SELECT "datePaiement"::date FROM payments WHERE id='${acompteId}';`))
})()
