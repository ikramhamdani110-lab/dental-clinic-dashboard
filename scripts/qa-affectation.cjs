/* Affectation de l'acompte à un traitement créé plus tard. */
const http = require('http')
const { execFileSync } = require('child_process')

function q(sql) {
  return execFileSync(
    'C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-h', '127.0.0.1', '-p', '5433', '-U', 'demo', '-d', 'sahed_demo_clinic', '-A', '-t', '-c', sql],
    { env: { ...process.env, PGPASSWORD: 'ROeZuJJ8XHkqxLvuieIM5fMh8xraQyPt' }, encoding: 'utf8' },
  ).trim()
}

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

;(async () => {
  const login = await req(3100, {
    path: '/api/auth/login', method: 'POST',
    corps: { email: 'demo@cabinet.local', password: 'MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA' },
  })
  const ck = (login.sc || []).map((l) => l.split(';')[0]).join('; ')
  const csrf = (login.sc || []).find((l) => l.startsWith('sahed_csrf='))?.split(';')[0].split('=')[1] ?? ''

  const pid = '604b2bb6-504a-47ff-adb1-4588d99f1226'
  const acompteId = 'a820fd6c-0af7-41b9-8de1-6b32ee090ddb'

  // ── 6. Traitement créé PLUS TARD (12 000 DA) — end-point /api/treatments ──
  const traitement = await req(3100, {
    path: '/api/treatments', method: 'POST', cookie: ck, csrf,
    corps: {
      patientId: pid,
      typeTraitement: 'Couronne dentaire', prixTotalCentimes: 1200000,
      statut: 'PLANIFIE',
    },
  })
  console.log('6. traitement créé plus tard :', traitement.status, traitement.body.slice(0, 110))
  const corps = JSON.parse(traitement.body)
  const tid = corps.traitement?.id ?? corps.id ?? corps.data?.id

  // ── 7. AFFECTATION de l'acompte ──
  const affect = await req(3100, {
    path: `/api/payments/${acompteId}/affecter`, method: 'POST', cookie: ck, csrf,
    corps: { treatmentId: tid },
  })
  console.log('7. affectation :', affect.status, affect.body.slice(0, 140))

  // ── 8. Re-affecter : refusé (déjà affecté) ──
  const reaffect = await req(3100, {
    path: `/api/payments/${acompteId}/affecter`, method: 'POST', cookie: ck, csrf,
    corps: { treatmentId: tid },
  })
  console.log('8. re-affectation (doit refuser) :', reaffect.status, reaffect.body.slice(0, 130))

  // ── 9. Vérifications financières finales ──
  console.log('\n── 9a. solde du traitement : UN paiement, payé 5 000 ──')
  console.log(q(`SELECT count(*) AS nb_paiements, COALESCE(SUM("montantCentimes"),0) AS paye
    FROM payments WHERE "treatmentId"='${tid}' AND statut='VALIDE';`))
  console.log('── 9b. JAMAIS deux paiements pour le patient ──')
  console.log(q(`SELECT count(*) AS nb_paiements_patient FROM payments WHERE "patientId"='${pid}';`))
  console.log('── 9c. montant et date originale préservés après affectation ──')
  console.log(q(`SELECT "montantCentimes" AS montant, "datePaiement"::date AS date_originale,
       "treatmentId" = '${tid}' AS affecte_au_traitement
  FROM payments WHERE id='${acompteId}';`))
  console.log('── 9d. total cabinet (pas de double comptage) ──')
  console.log(q(`SELECT COALESCE(SUM("montantCentimes"),0) AS total FROM payments WHERE statut='VALIDE';`))
})()
