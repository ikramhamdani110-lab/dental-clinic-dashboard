#!/usr/bin/env node
/**
 * =============================================================================
 *  REGRESSION « BASE VIDE » — ETAT DE PRODUCTION VALIDE
 * =============================================================================
 *
 *  Une base vide (0 patient, 0 rendez-vous, 0 traitement, 0 paiement, 0 dossier,
 *  0 document) est un ETAT DE PRODUCTION VALIDE : c'est celui d'un cabinet qui
 *  vient d'installer le logiciel. Rien ne doit y produire d'erreur 500, de
 *  plantage React, de fuite d'exception base, ni de chargement infini.
 *
 *  Ce script interroge l'application REELLE (next start) pointee vers une base
 *  REELLE vide et verifie, pour chaque endpoint :
 *    - statut HTTP 200,
 *    - absence de fuite technique (SQL, chemin, stack, « Prisma ») dans la reponse,
 *    - presence d'une structure « vide » exploitable (total = 0, tableaux vides).
 */

const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:3100'
const EMAIL = process.env.LOAD_EMAIL ?? 'medecin.charge@test.dz'
const PASSWORD = process.env.LOAD_PASSWORD ?? 'ChargeTest-2026!'

const cookies = new Map()
function capter(reponse) {
  for (const c of reponse.headers.getSetCookie?.() ?? []) {
    const [paire] = c.split(';')
    const eq = paire.indexOf('=')
    if (eq > 0) cookies.set(paire.slice(0, eq).trim(), paire.slice(eq + 1).trim())
  }
}
function enteteCookie() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** Motifs qui ne doivent JAMAIS apparaitre dans une reponse d'erreur (§33, §36). */
const FUITE_INTERDITE = [
  /SELECT |INSERT |UPDATE |DELETE FROM/i,
  /PrismaClient|prisma\./i,
  /at Object\.|at async |\.ts:\d+|\.js:\d+/, // stack traces
  /C:\\|\/home\/|node_modules/i,
  /ECONNREFUSED|ETIMEDOUT|P1001|P2002/,
  /passwordHash|SESSION_SECRET|PASSWORD_PEPPER/i,
]

function verifierPasDeFuite(corps) {
  const trouvees = FUITE_INTERDITE.filter((m) => m.test(corps))
  return trouvees.map((m) => m.source)
}

const resultats = []
let echecs = 0

async function appeler(nom, chemin) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    headers: { cookie: enteteCookie(), 'user-agent': 'regression-vide/1.0' },
    redirect: 'manual',
  })
  const texte = await reponse.text()
  capter(reponse)
  const fuites = verifierPasDeFuite(texte)
  const ok = reponse.status === 200 && fuites.length === 0
  if (!ok) echecs += 1
  process.stdout.write(
    `  ${ok ? 'OK ' : 'ECHEC'} ${nom.padEnd(52)} statut=${reponse.status}` +
    (fuites.length ? `  FUITE=${fuites.join(',')}` : '') +
    '\n',
  )
  resultats.push({ nom, chemin, statut: reponse.status, ok, fuites, corps: texte })
  return { statut: reponse.status, texte }
}

async function main() {
  process.stdout.write(`Regression base vide contre ${BASE}\n\n`)

  process.stdout.write('Authentification :\n')
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  capter(login)
  const loginTexte = await login.text()
  process.stdout.write(`  ${login.status === 200 ? 'OK ' : 'ECHEC'} /login statut=${login.status}\n`)
  if (login.status !== 200) {
    process.stdout.write(`  Reponse : ${loginTexte}\n`)
    process.exit(1)
  }

  process.stdout.write('\nEndpoints prives sur base vide :\n')
  const endpoints = [
    ['/api/dashboard', '/api/dashboard'],
    ['/api/patients', '/api/patients?page=1&taille=25'],
    ['/api/payments', '/api/payments?page=1&taille=25'],
    ['/api/treatments', '/api/treatments?page=1&taille=25'],
    ['/api/appointments', '/api/appointments?page=1&taille=25'],
    ['/api/activity-log', '/api/activity-log?page=1&taille=25'],
    ['/api/trash', '/api/trash?page=1&taille=25'],
    ['/api/reports/revenue?rapport=soldes-patients', '/api/reports/revenue?rapport=soldes-patients&page=1&taille=25'],
    ['/api/reports/revenue?rapport=revenus', '/api/reports/revenue?rapport=revenus&periode=mois'],
    ['/api/reports/revenue?rapport=traitements', '/api/reports/revenue?rapport=traitements&periode=mois'],
    ['/api/reports/revenue?rapport=rendez-vous', '/api/reports/revenue?rapport=rendez-vous&periode=mois'],
  ]
  for (const [nom, chemin] of endpoints) await appeler(nom, chemin)

  // --- Verification des etats vides structurels ------------------------------
  process.stdout.write('\nVerification des etats vides structurels :\n')
  const dashboard = resultats.find((r) => r.nom === '/api/dashboard')
  if (dashboard && dashboard.statut === 200) {
    const d = JSON.parse(dashboard.corps)
    const controles = [
      ['rendezVousDuJour vide', Array.isArray(d.rendezVousDuJour) && d.rendezVousDuJour.length === 0],
      ['prochainsRendezVous vide', Array.isArray(d.prochainsRendezVous) && d.prochainsRendezVous.length === 0],
      ['revenus mensuels = 12 points', Array.isArray(d.revenusMensuels) && d.revenusMensuels.length === 12],
      ['tous les revenus mensuels a 0', d.revenusMensuels.every((p) => p.totalCentimes === 0)],
      ['revenusJour = 0', d.revenusJourCentimes === 0],
      ['revenusMois = 0', d.revenusMoisCentimes === 0],
      ['totalRestant = 0', d.totalRestantCentimes === 0],
      ['traitementsEnCours = 0', d.traitementsEnCours === 0],
    ]
    for (const [label, ok] of controles) {
      if (!ok) echecs += 1
      process.stdout.write(`  ${ok ? 'OK ' : 'ECHEC'} ${label}\n`)
    }
  }

  const soldes = resultats.find((r) => r.nom.includes('soldes-patients'))
  if (soldes) {
    const s = JSON.parse(soldes.corps)
    const ok = s.total === 0 && Array.isArray(s.elements) && s.elements.length === 0
    if (!ok) echecs += 1
    process.stdout.write(`  ${ok ? 'OK ' : 'ECHEC'} soldes patients : total=0, liste vide\n`)
  }

  process.stdout.write('\nPage /tableau-de-bord (rendu serveur) :\n')
  const page = await fetch(`${BASE}/tableau-de-bord`, {
    headers: { cookie: enteteCookie(), 'user-agent': 'regression-vide/1.0' },
    redirect: 'manual',
  })
  const pageTexte = await page.text()
  const fuitesPage = verifierPasDeFuite(pageTexte)
  const pageOk = page.status === 200 && fuitesPage.length === 0
  if (!pageOk) echecs += 1
  process.stdout.write(
    `  ${pageOk ? 'OK ' : 'ECHEC'} GET /tableau-de-bord statut=${page.status}` +
    (fuitesPage.length ? ` FUITE=${fuitesPage.join(',')}` : '') +
    '\n',
  )

  process.stdout.write(
    `\n${echecs === 0 ? 'SUCCES' : 'ECHEC'} : ${echecs} probleme(s) detecte(s) sur base vide.\n`,
  )
  process.exit(echecs === 0 ? 0 : 1)
}

main().catch((e) => {
  process.stderr.write('Echec regression base vide : ' + (e instanceof Error ? e.message : String(e)) + '\n')
  process.exit(1)
})