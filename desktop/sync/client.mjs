// =============================================================================
//  CLIENT DE SYNCHRONISATION — desktop/sync/client.mjs  (réécrit, audit G3/G4)
// =============================================================================
//  Pousse la file locale vers /api/sync/push et tire les changements distants
//  depuis /api/sync/pull DU SERVEUR EN LIGNE (HTTPS) — plus jamais le serveur
//  local (audit G3). La session web de production est obtenue par l'appairage
//  (voir appairage.mjs) et transmise via cookie.
//
//  ÉTATS DE CONNECTIVITÉ DISTINCTS (audit G4) :
//    - PAS_DE_SERVEUR       : aucune connectivité Internet (test HTTPS réel)
//    - SERVEUR_JOIGNABLE    : l'API répond (prête pour la sync)
//    - SESSION_EXPIREE      : HTTP 401 — réappairage requis
//    - APPAREIL_REVOQUE     : HTTP 403 code DEVICE_REVOKED
// =============================================================================

import { obtenirUrlServeur, obtenirAppareil } from './config.mjs'

/** Erreur typée de synchronisation — code lisible par le watcher et l'UI. */
export class ErreurSync extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ErreurSync'
    this.code = code
  }
}

async function urlEtIdentite() {
  const serveur = await obtenirUrlServeur()
  const appareil = await obtenirAppareil()
  if (!serveur) throw new ErreurSync('NON_APPAIRE', 'Aucune URL de serveur configurée.')
  if (!appareil) throw new ErreurSync('NON_APPAIRE', 'Aucun appareil appairé.')
  return { serveur, ...appareil }
}

/**
 * Vérifie la connectivité RÉELLE vers le serveur en ligne (audit G4).
 * Un simple ping ICMP ne suffit pas : seul un aller-retour HTTPS authentifié
 * prouve que l'API est utilisable. Renvoie un des codes ci-dessus.
 */
export async function verifierConnectivite() {
  let serveur
  try {
    ;({ serveur } = await urlEtIdentite())
  } catch (e) {
    return { etat: e.code ?? 'NON_APPAIRE', detail: e.message }
  }
  try {
    const reponse = await fetch(new URL('/api/health', serveur), {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json' },
    })
    if (reponse.ok) return { etat: 'SERVEUR_JOIGNABLE' }
    if (reponse.status === 401 || reponse.status === 403) return { etat: 'SERVEUR_JOIGNABLE' } // l'API répond
    return { etat: 'SERVEUR_INDISPONIBLE', detail: `HTTP ${reponse.status}` }
  } catch (e) {
    const cause = e?.cause?.code ?? e?.name ?? ''
    if (
      cause === 'ENOTFOUND' ||
      cause === 'EAI_AGAIN' ||
      cause === 'ECONNREFUSED' ||
      e.name === 'TimeoutError' ||
      cause === 'UND_ERR_CONNECT_TIMEOUT'
    ) {
      return { etat: 'PAS_DE_SERVEUR', detail: String(cause || e.name) }
    }
    return { etat: 'SERVEUR_INDISPONIBLE', detail: String(cause || e.message) }
  }
}

/**
 * Pousse UN lot vers le serveur EN LIGNE. Renvoie un tableau de resultats
 * aligné avec les opérations envoyées : { operationId, outcome, detail }.
 * Une erreur HTTP 5xx ou une absence de réseau lève une ErreurSync typée —
 * l'appelant marque les opérations en PENDING (retry avec backoff).
 */
export async function pousser({ deviceId, jetonAppareil, operations, jetonSession }) {
  const serveur = (await obtenirUrlServeur()) ?? ''
  if (!serveur) throw new ErreurSync('NON_APPAIRE', 'Aucune URL de serveur configurée.')

  const reponse = await fetch(new URL('/api/sync/push', serveur), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `sahed_session=${jetonSession}`,
    },
    body: JSON.stringify({
      deviceId,
      jetonAppareil,
      operations: operations.map((op) => ({
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        payload: JSON.parse(op.payload),
      })),
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (reponse.status === 401) throw new ErreurSync('SESSION_EXPIREE', 'Session en ligne expirée — reconnexion requise.')
  if (reponse.status === 403) {
    const corps = await reponse.json().catch(() => ({}))
    if (corps.code === 'DEVICE_REVOKED') {
      throw new ErreurSync('APPAREIL_REVOQUE', 'Appareil révoqué côté serveur.')
    }
  }
  if (!reponse.ok) throw new ErreurSync('SERVEUR_ERREUR', `push HTTP ${reponse.status}`)
  const corps = await reponse.json()
  return corps.resultats ?? []
}

/**
 * Tire les changements distants pour les tables demandées.
 * Renvoie { curseurs, lots, tombstones } : chaque table est indépendante.
 */
export async function tirer({ deviceId, jetonAppareil, tables, jetonSession }) {
  const serveur = (await obtenirUrlServeur()) ?? ''
  if (!serveur) throw new ErreurSync('NON_APPAIRE', 'Aucune URL de serveur configurée.')

  const reponse = await fetch(new URL('/api/sync/pull', serveur), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `sahed_session=${jetonSession}`,
    },
    body: JSON.stringify({ deviceId, jetonAppareil, tables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (reponse.status === 401) throw new ErreurSync('SESSION_EXPIREE', 'Session en ligne expirée — reconnexion requise.')
  if (reponse.status === 403) {
    const corps = await reponse.json().catch(() => ({}))
    if (corps.code === 'DEVICE_REVOKED') {
      throw new ErreurSync('APPAREIL_REVOQUE', 'Appareil révoqué côté serveur.')
    }
  }
  if (!reponse.ok) throw new ErreurSync('SERVEUR_ERREUR', `pull HTTP ${reponse.status}`)
  return reponse.json()
}

/**
 * Appaire l'appareil : l'utilisateur se connecte UNE fois avec son compte web
 * en ligne (procédure interactive, voir appairage.mjs) et le poste reçoit un
 * jeton d'appareil à long terme. Le jeton de session lui-même n'est PAS
 * conservé : seul le jeton d'appareil l'est (chiffré DPAPI).
 */
export async function appairer(serveur, jetonSession, deviceId, label) {
  const reponse = await fetch(new URL('/api/sync/appareils', serveur), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `sahed_session=${jetonSession}`,
    },
    body: JSON.stringify({ deviceId, label }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!reponse.ok) {
    if (reponse.status === 401) throw new ErreurSync('SESSION_EXPIREE', 'Connexion en ligne invalide ou expirée.')
    throw new ErreurSync('APPARIAGE_ECHEC', `Appairage refusé (HTTP ${reponse.status}).`)
  }
  const corps = await reponse.json()
  return { jeton: corps.jeton, phraseRecuperation: corps.phraseRecuperation }
}
