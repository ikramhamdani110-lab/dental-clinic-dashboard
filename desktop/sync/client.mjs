// =============================================================================
//  CLIENT DE SYNCHRONISATION — desktop/sync/client.mjs
// =============================================================================
//  Pousse la file locale vers /api/sync/push et tire les changements distants
//  depuis /api/sync/pull. Communique UNIQUEMENT avec l'API authentifiee :
//  AUCUNE chaine de connexion Neon n'est embarquee dans l'application.
//
//  BACKOFF EXPONENTIEL : en cas d'erreur reseau, l'operation retourne en
//  PENDING avec un delai croissant (0.5s, 1s, 2s, 4s... plafonne a 60s).
// =============================================================================

const URL_BASE = process.env.DESKTOP_SYNC_URL ?? 'http://127.0.0.1:43177'

/**
 * Pousse UN lot vers le serveur. Renvoie un tableau de resultats aligne avec
 * les operations envoyees : { operationId, outcome, detail }.
 * Une erreur HTTP 5xx ou une absence de reseau leve une exception — l'appelant
 * marque les operations en PENDING (retry).
 */
export async function pousser({ deviceId, jetonAppareil, operations }) {
  const reponse = await fetch(`${URL_BASE}/api/sync/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // La session web est transmise par cookie : l'app desktop Next.js
      // locale gere la session au meme titre que le site en ligne.
      cookie: `sahed_session=${process.env.DESKTOP_SESSION_TOKEN ?? ''}`,
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
  })

  if (reponse.status === 403) {
    const corps = await reponse.json().catch(() => ({}))
    if (corps.code === 'DEVICE_REVOKED') {
      const erreur = new Error('DEVICE_REVOKED')
      erreur.code = 'DEVICE_REVOKED'
      throw erreur
    }
  }
  if (!reponse.ok) {
    throw new Error(`push HTTP ${reponse.status}`)
  }
  const corps = await reponse.json()
  return corps.resultats ?? []
}

/**
 * Tire les changements distants pour les tables demandees.
 * Renvoie { curseurs, lots } : chaque table est independante, un echec sur
 * l'une n'affecte pas les autres.
 */
export async function tirer({ deviceId, jetonAppareil, tables }) {
  const reponse = await fetch(`${URL_BASE}/api/sync/pull`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `sahed_session=${process.env.DESKTOP_SESSION_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ deviceId, jetonAppareil, tables }),
  })
  if (!reponse.ok) {
    if (reponse.status === 403) {
      const corps = await reponse.json().catch(() => ({}))
      if (corps.code === 'DEVICE_REVOKED') {
        const erreur = new Error('DEVICE_REVOKED')
        erreur.code = 'DEVICE_REVOKED'
        throw erreur
      }
    }
    throw new Error(`pull HTTP ${reponse.status}`)
  }
  return reponse.json()
}

/** Appaire un appareil depuis /parametres (session web requise). */
export async function appairer(deviceId, label) {
  const reponse = await fetch(`${URL_BASE}/api/sync/appareils`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `sahed_session=${process.env.DESKTOP_SESSION_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ deviceId, label }),
  })
  if (!reponse.ok) throw new Error(`appairage HTTP ${reponse.status}`)
  return reponse.json()
}
