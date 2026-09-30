#!/usr/bin/env node
/**
 * =============================================================================
 *  TEST DE CHARGE — MESURES REELLES CONTRE UNE APPLICATION EN EXECUTION
 * =============================================================================
 *
 *  Ce script interroge une instance `next start` reelle (base JETABLE peuplee
 *  par seed-charge-test.mjs) et mesure, pour chaque endpoint :
 *    - requete « froide » (premier appel) et « chaude » (appel suivant) ;
 *    - temps de reponse (ms) ;
 *    - taille de reponse (octets) ;
 *    - statut HTTP ;
 *    - pourcentage de lignes de la table sous-jacente effectivement parcouru.
 *
 *  Il ne fabrique AUCUN chiffre : chaque valeur provient d'une reponse HTTP
 *  reellement mesuree. Les compteurs de lignes proviennent de la base reelle.
 *
 *  Usage :
 *    LOAD_BASE_URL=http://localhost:3100 node database/scripts/load-test.mjs
 */

import { writeFileSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:3100'
const DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/sahed_load_test?schema=public'
const EMAIL = process.env.LOAD_EMAIL ?? 'medecin.charge@test.dz'
const PASSWORD = process.env.LOAD_PASSWORD ?? 'ChargeTest-2026!'

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } })

/** Enveloppe de cookies minimale : on gere nous-memes l'attache des cookies. */
const cookies = new Map()

function capterCookies(reponse) {
  const brut = reponse.headers.getSetCookie?.() ?? []
  for (const c of brut) {
    const [paire] = c.split(';')
    const eq = paire.indexOf('=')
    if (eq > 0) cookies.set(paire.slice(0, eq).trim(), paire.slice(eq + 1).trim())
  }
}

function enTeteCookie() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

let csrfToken = ''

async function mesure(nom, chemin, { methode = 'GET', corps, sauterAuth = false } = {}) {
  const entetes = { 'user-agent': 'load-test-sonde/1.0' }
  if (!sauterAuth && cookies.size > 0) entetes.cookie = enTeteCookie()
  if (corps !== undefined) entetes['content-type'] = 'application/json'
  // Le jeton CSRF est exige sur les methodes mutantes ; nos mesures sont des GET,
  // mais on le pose tout de suite pour rester generique.
  if (csrfToken) entetes['x-csrf-token'] = csrfToken

  const debut = performance.now()
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
    redirect: 'manual',
  })
  const texte = await reponse.text()
  const ms = performance.now() - debut
  capterCookies(reponse)
  return { nom, chemin, methode, statut: reponse.status, ms, octets: Buffer.byteLength(texte), corps: texte }
}

function afficher(r) {
  const taille = r.octets >= 1024 ? `${(r.octets / 1024).toFixed(1)} Ko` : `${r.octets} o`
  process.stdout.write(
    `  ${r.nom.padEnd(46)} ${String(r.statut).padEnd(4)} ${r.ms.toFixed(1).padStart(8)} ms  ${taille.padStart(10)}\n`,
  )
}

async function connexion() {
  // La connexion est une route publique : on l'appelle et on capture les cookies.
  const reponse = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'load-test-sonde/1.0' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  capterCookies(reponse)
  const texte = await reponse.text()
  if (reponse.status !== 200) {
    throw new Error(`Connexion echouee (${reponse.status}) : ${texte}`)
  }
  csrfToken = cookies.get('sahed_csrf') ?? ''
  return { statut: reponse.status, corps: texte }
}

async function compterLignes() {
  const [patients, appointments, treatments, payments, activityLogs, trash] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.treatment.count(),
    prisma.payment.count(),
    prisma.activityLog.count(),
    prisma.trashEntry.count(),
  ])
  return { patients, appointments, treatments, payments, activityLogs, trash }
}

/** Compte les lignes effectivement renvoyees dans une liste JSON (tableau `.length`). */
function compterElements(corps, cle) {
  try {
    const obj = JSON.parse(corps)
    const valeur = obj[cle]
    if (Array.isArray(valeur)) return valeur.length
    if (valeur && typeof valeur === 'object' && Array.isArray(valeur.elements)) return valeur.elements.length
    return null
  } catch {
    return null
  }
}

async function main() {
  process.stdout.write(`Test de charge contre ${BASE}\n`)
  const compteurs = await compterLignes()
  process.stdout.write('Volume en base : ' + JSON.stringify(compteurs) + '\n\n')

  process.stdout.write('Connexion du medecin...\n')
  const connexion_cold = await (async () => {
    const d = performance.now()
    const res = await connexion()
    return { ms: performance.now() - d, statut: res.statut }
  })()
  process.stdout.write(`  /login (froid)  statut=${connexion_cold.statut}  ${connexion_cold.ms.toFixed(1)} ms\n\n`)

  const resultats = []

  // --- /login (chaud) : nouvelle connexion, meme utilisateur ----------------
  {
    const d = performance.now()
    const res = await connexion()
    resultats.push({
      nom: '/login (chaud)',
      chemin: '/api/auth/login',
      methode: 'POST',
      statut: res.statut,
      ms: performance.now() - d,
      octets: Buffer.byteLength(res.corps),
    })
  }

  const endpoints = [
    ['/api/dashboard', '/api/dashboard', null],
    ['/api/patients (page 1, taille 25)', '/api/patients?page=1&taille=25', 'elements'],
    ['/api/patients (page 1, taille 100 max)', '/api/patients?page=1&taille=100', 'elements'],
    ['/api/payments (page 1, taille 25)', '/api/payments?page=1&taille=25', 'elements'],
    ['/api/activity-log (page 1, taille 25)', '/api/activity-log?page=1&taille=25', 'entrees'],
    ['/api/reports/revenue?rapport=soldes-patients', '/api/reports/revenue?rapport=soldes-patients&page=1&taille=25', 'elements'],
    ['/api/reports/revenue?rapport=revenus', '/api/reports/revenue?rapport=revenus&periode=mois', null],
    ['/api/trash', '/api/trash?page=1&taille=25', 'elements'],
    ['/api/treatments (page 1)', '/api/treatments?page=1&taille=25', 'elements'],
    ['/api/appointments (page 1)', '/api/appointments?page=1&taille=25', 'elements'],
  ]

  process.stdout.write('Mesures par endpoint (froid puis chaud) :\n')
  for (const [nom, chemin, cle] of endpoints) {
    const froid = await mesure(nom + ' [froid]', chemin)
    afficher(froid)
    const chaud = await mesure(nom + ' [chaud]', chemin)
    afficher(chaud)
    resultats.push(froid, chaud)
    if (cle) {
      const n = compterElements(chaud.corps, cle)
      if (n !== null) {
        process.stdout.write(`      -> ${n} element(s) renvoye(s) dans la reponse\n`)
      }
    }
  }

  // --- Endpoints de detail patient ------------------------------------------
  const patient = await prisma.patient.findFirst({ select: { id: true } })
  if (patient) {
    process.stdout.write('\nEndpoints de detail patient (représentatifs) :\n')
    const details = [
      [`/api/patients/:id/treatments`, `/api/patients/${patient.id}/treatments?page=1&taille=25`, 'traitements'],
      [`/api/patients/:id/payments`, `/api/patients/${patient.id}/payments?page=1&taille=25`, 'paiements'],
      [`/api/patients/:id/appointments`, `/api/patients/${patient.id}/appointments?page=1&taille=25`, 'rendezVous'],
      [`/api/patients/:id/medical-records`, `/api/patients/${patient.id}/medical-records?page=1&taille=25`, 'dossiers'],
      [`/api/patients/:id/documents`, `/api/patients/${patient.id}/documents?page=1&taille=25`, 'documents'],
      [`/api/patients/:id/prescriptions`, `/api/patients/${patient.id}/prescriptions?page=1&taille=25`, 'ordonnances'],
      [`/api/patients/:id/odontogram`, `/api/patients/${patient.id}/odontogram`, null],
    ]
    for (const [nom, chemin, cle] of details) {
      const froid = await mesure(nom + ' [froid]', chemin)
      afficher(froid)
      const chaud = await mesure(nom + ' [chaud]', chemin)
      afficher(chaud)
      resultats.push(froid, chaud)
      if (cle) {
        const n = compterElements(chaud.corps, cle)
        if (n !== null) process.stdout.write(`      -> ${n} element(s) renvoye(s) dans la reponse\n`)
      }
    }
  }

  // --- Determination des lignes chargees ------------------------------------
  process.stdout.write('\nEcart lignes en base vs lignes renvoyees :\n')
  const p = resultats.find((r) => r.nom === '/api/payments (page 1, taille 25) [chaud]')
  if (p) {
    const n = compterElements(p.corps, 'elements')
    process.stdout.write(
      `  payments : ${compteurs.payments} en base, ${n} renvoyes sur la page (${(((n ?? 0) / compteurs.payments) * 100).toFixed(2)} %)\n`,
    )
  }
  const a = resultats.find((r) => r.nom === '/api/activity-log (page 1, taille 25) [chaud]')
  if (a) {
    const n = compterElements(a.corps, 'entrees')
    process.stdout.write(
      `  activity_logs : ${compteurs.activityLogs} en base, ${n} renvoyes sur la page (${(((n ?? 0) / compteurs.activityLogs) * 100).toFixed(2)} %)\n`,
    )
  }
  const pa = resultats.find((r) => r.nom === '/api/patients (page 1, taille 25) [chaud]')
  if (pa) {
    const n = compterElements(pa.corps, 'elements')
    process.stdout.write(
      `  patients : ${compteurs.patients} en base, ${n} renvoyes sur la page (${(((n ?? 0) / compteurs.patients) * 100).toFixed(2)} %)\n`,
    )
  }

  writeFileSync('.tmp/load-results.json', JSON.stringify({ compteurs, resultats }, null, 2))
  process.stdout.write('\nResultats detailles ecrits dans .tmp/load-results.json\n')
}

main()
  .catch((e) => {
    process.stderr.write('Echec du test de charge : ' + (e instanceof Error ? e.message : String(e)) + '\n')
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })