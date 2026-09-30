#!/usr/bin/env node
/**
 * =============================================================================
 *  REGRESSION DE SECURITE — AUTHENTIFICATION ET CSP (§38, §39)
 * =============================================================================
 *
 *  Contre l'application REELLE (`next start`) :
 *    - ACCES NON AUTHENTIFIE : toutes les routes privees doivent renvoyer 401
 *      en JSON (jamais de donnees, jamais de redirection HTML) ;
 *    - CSRF : une requete mutante sans jeton doit etre refusee ;
 *    - CSP : l'en-tete `Content-Security-Policy` doit etre present, avec un
 *      nonce par requete, sans `unsafe-eval`, et avec `frame-ancestors 'none'` ;
 *    - en-tetes de securite : nosniff, X-Frame-Options, HSTS en production.
 */

const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:3100'

const ROUTES_PRIVEES = [
  '/api/dashboard',
  '/api/patients',
  '/api/payments',
  '/api/treatments',
  '/api/appointments',
  '/api/activity-log',
  '/api/trash',
  '/api/reports/revenue?rapport=revenus',
]

let echecs = 0
function verifier(label, ok, detail = '') {
  if (!ok) echecs += 1
  process.stdout.write(`  ${ok ? 'OK ' : 'ECHEC'} ${label}${detail ? '  ' + detail : ''}\n`)
}

async function main() {
  process.stdout.write(`Regression authentification + CSP contre ${BASE}\n\n`)

  process.stdout.write('Acces prive SANS session (attendu : 401 JSON) :\n')
  for (const route of ROUTES_PRIVEES) {
    const r = await fetch(`${BASE}${route}`, { redirect: 'manual' })
    const texte = await r.text()
    let json = null
    try {
      json = JSON.parse(texte)
    } catch {
      /* pas du JSON */
    }
    const ok = r.status === 401 && json?.code === 'NON_AUTHENTIFIE'
    verifier(`${route} -> 401 NON_AUTHENTIFIE`, ok, `statut=${r.status}`)
  }

  process.stdout.write('\nCSRF : requete mutante sans jeton (attendu : refus) :\n')
  {
    // Sans session, on obtient deja 401. On teste surtout qu'aucune mutation
    // anonyme ne cree de donnee : la reponse ne doit jamais etre 200/201.
    const r = await fetch(`${BASE}/api/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nom: 'X', prenom: 'Y', telephone: '0000000000' }),
    })
    verifier('POST /api/patients anonyme refuse', r.status === 401, `statut=${r.status}`)
  }

  process.stdout.write('\nEn-tetes de securite (page racine) :\n')
  {
    const r = await fetch(`${BASE}/`, { redirect: 'manual' })
    const csp = r.headers.get('content-security-policy') ?? ''
    verifier('CSP present', csp.length > 0)
    verifier('CSP contient un nonce', /'nonce-[A-Za-z0-9+/=]+'/.test(csp))
    verifier('CSP interdit frame-ancestors', /frame-ancestors 'none'/.test(csp))
    verifier('CSP sans unsafe-eval', !/unsafe-eval/.test(csp))
    verifier('CSP restreint script-src a self+nonce', /script-src[^;]*'self'/.test(csp))
    verifier('X-Content-Type-Options: nosniff', r.headers.get('x-content-type-options') === 'nosniff')
    verifier('X-Frame-Options: DENY', r.headers.get('x-frame-options') === 'DENY')
    verifier(
      'Strict-Transport-Security present (production)',
      (r.headers.get('strict-transport-security') ?? '').includes('max-age=63072000'),
    )
    verifier('Referrer-Policy defini', (r.headers.get('referrer-policy') ?? '').length > 0)

    // Le nonce doit changer d'une requete a l'autre.
    const r2 = await fetch(`${BASE}/`, { redirect: 'manual' })
    const csp2 = r2.headers.get('content-security-policy') ?? ''
    const nonce1 = csp.match(/'nonce-([^']+)'/)?.[1]
    const nonce2 = csp2.match(/'nonce-([^']+)'/)?.[1]
    verifier('nonce different a chaque requete', Boolean(nonce1) && nonce1 !== nonce2)
  }

  process.stdout.write(
    `\n${echecs === 0 ? 'SUCCES' : 'ECHEC'} : ${echecs} probleme(s) de securite detecte(s).\n`,
  )
  process.exit(echecs === 0 ? 0 : 1)
}

main().catch((e) => {
  process.stderr.write('Echec regression securite : ' + (e instanceof Error ? e.message : String(e)) + '\n')
  process.exit(1)
})