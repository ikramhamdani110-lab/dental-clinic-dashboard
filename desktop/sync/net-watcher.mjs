// =============================================================================
//  SURVEILLANT RÉSEAU + BOUCLE DE SYNCHRONISATION — desktop/sync/net-watcher.mjs
// =============================================================================
//  Réécrit (audit G1, G3, G4, G5, G6) :
//    - DÉMARRÉ par desktop/main.mjs après le serveur local (G1) ;
//    - cible le SERVEUR EN LIGNE via config (HTTPS) — plus jamais 127.0.0.1 (G3) ;
//    - la détection distingue PAS_DE_SERVEUR / SERVEUR_INDISPONIBLE /
//      SESSION_EXPIREE / APPAREIL_REVOQUE / SERVEUR_JOIGNABLE (G4) ;
//    - le pull est appliqué par appliquer.mjs : politiques par entité, jamais
//      de last-write-wins sur les données médicales/financières (G5) ;
//    - les tombstones du pull sont appliqués (G6).
//
//  RÈGLE ABSOLUE : la sync n'est JAMAIS bloquante pour l'usage local — une
//  coupure réseau suspend la sync, jamais l'application.
// =============================================================================

import { pousser, tirer, verifierConnectivite, ErreurSync } from './client.mjs'
import { obtenirAppareil, marquerDerniereSynchro } from './config.mjs'
import { appliquerLotsLocalement, fermerAppliquer } from './appliquer.mjs'
import { journalSync } from './log.mjs'

const INTERVALLE_OK_MS = 60_000
const INTERVALLE_ERREUR_MS = 15_000
const ATTENTE_STABILITE_MS = 5_000

const TABLES = [
  'patients',
  'appointments',
  'treatments',
  'payments',
  'documents',
  'prescriptions',
  'odontogramEntries',
  'medicalRecords',
]

/**
 * Démarre la boucle de synchronisation.
 * `surEtat(etat)` est appelé à chaque changement d'état visible :
 *   { mode: 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'ERREUR' | 'SESSION_EXPIREE'
 *          | 'APPAREIL_REVOQUE' | 'NON_APPAIRE', detail?, compteurs?, bilan? }
 */
export function demarrerWatcher({ queue, log, surEtat }) {
  let arrete = false
  let enCours = false
  // Jeton de session web en ligne, obtenu par l'appairage interactif via IPC.
  let jetonSession = process.env.DESKTOP_SESSION_TOKEN ?? ''

  function changerEtat(etat) {
    journalSync(etat.mode, etat.detail ?? '')
    log(`sync: ${etat.mode}${etat.detail ? ' — ' + etat.detail : ''}`)
    surEtat?.(etat)
  }

  /** Permet à main.mjs (IPC d'appairage) de fournir/renouveler la session. */
  function definirSession(jeton) {
    jetonSession = jeton ?? ''
  }

  async function cycle() {
    if (arrete || enCours) return
    enCours = true
    try {
      const appareil = await obtenirAppareil()
      if (!appareil || !jetonSession) {
        changerEtat({ mode: 'NON_APPAIRE', detail: 'Appairage requis pour synchroniser.' })
        return
      }

      changerEtat({ mode: 'SYNCING' })

      // 1. PULL d'abord : les changements distants sont appliqués AVANT tout
      //    push, pour que les conflits soient détectés avec l'état le plus récent.
      const { lots, tombstones } = await tirer({
        deviceId: appareil.deviceId,
        jetonAppareil: appareil.jeton,
        tables: TABLES,
        jetonSession,
      })
      const bilan = await appliquerLotsLocalement(lots, tombstones, (m) => log(m))

      // 2. PUSH ensuite : la file locale est jouée dans l'ordre chronologique.
      let lot = await queue.prochainLot(100)
      let echecs = 0
      while (lot.length > 0 && !arrete) {
        for (const operation of lot) {
          await queue.marquerSyncing(operation.operationId)
        }
        let resultats
        try {
          resultats = await pousser({
            deviceId: appareil.deviceId,
            jetonAppareil: appareil.jeton,
            operations: lot,
            jetonSession,
          })
        } catch (erreur) {
          if (erreur instanceof ErreurSync) {
            if (erreur.code === 'APPAREIL_REVOQUE') {
              changerEtat({ mode: 'APPAREIL_REVOQUE', detail: erreur.message })
              arrete = true
              return
            }
            if (erreur.code === 'SESSION_EXPIREE') {
              for (const operation of lot) {
                await queue.marquerPending(operation.operationId, erreur.message)
              }
              changerEtat({ mode: 'SESSION_EXPIREE', detail: erreur.message })
              return
            }
            if (erreur.code === 'NON_APPAIRE') {
              changerEtat({ mode: 'NON_APPAIRE', detail: erreur.message })
              return
            }
          }
          // Erreur réseau/serveur : retour en PENDING avec backoff exponentiel.
          echecs += 1
          for (const operation of lot) {
            await queue.marquerPending(operation.operationId, String(erreur.message))
          }
          changerEtat({ mode: echecs > 3 ? 'ERREUR' : 'OFFLINE', detail: String(erreur.message) })
          return
        }

        const parId = new Map(resultats.map((r) => [r.operationId, r]))
        for (const operation of lot) {
          const resultat = parId.get(operation.operationId)
          if (!resultat) {
            await queue.marquerPending(operation.operationId, 'Pas de réponse serveur pour cette opération.')
            continue
          }
          if (resultat.outcome === 'APPLIED' || resultat.outcome === 'ALREADY_APPLIED') {
            await queue.marquerSynchronized(operation.operationId)
          } else if (resultat.outcome === 'CONFLICT') {
            await queue.marquerConflict(operation.operationId, resultat.detail ?? 'Conflit non détaillé')
          } else {
            await queue.marquerRejected(operation.operationId, resultat.detail ?? 'Rejet sans détail')
          }
        }
        lot = await queue.prochainLot(100)
      }

      await marquerDerniereSynchro(new Date().toISOString())
      changerEtat({ mode: 'SYNCED', compteurs: await queue.compteurs(), bilan })
    } catch (erreur) {
      const code = erreur instanceof ErreurSync ? erreur.code : 'ERREUR'
      if (code === 'SESSION_EXPIREE') changerEtat({ mode: 'SESSION_EXPIREE', detail: String(erreur.message) })
      else if (code === 'NON_APPAIRE') changerEtat({ mode: 'NON_APPAIRE', detail: String(erreur.message) })
      else if (code === 'APPAREIL_REVOQUE') changerEtat({ mode: 'APPAREIL_REVOQUE', detail: String(erreur.message) })
      else changerEtat({ mode: 'ERREUR', detail: String(erreur.message) })
    } finally {
      enCours = false
    }
  }

  async function boucle() {
    while (!arrete) {
      try {
        const reseau = await verifierConnectivite()
        if (reseau.etat === 'SERVEUR_JOIGNABLE') {
          // Attente de stabilité (5 s) pour éviter les bascules rapides.
          await new Promise((r) => setTimeout(r, ATTENTE_STABILITE_MS))
          const encore = await verifierConnectivite()
          if (!arrete && encore.etat === 'SERVEUR_JOIGNABLE') {
            await cycle()
          }
          if (!arrete) await new Promise((r) => setTimeout(r, INTERVALLE_OK_MS))
        } else if (reseau.etat === 'NON_APPAIRE') {
          changerEtat({ mode: 'NON_APPAIRE', detail: 'Appairage requis pour synchroniser.' })
          await new Promise((r) => setTimeout(r, INTERVALLE_ERREUR_MS * 4))
        } else {
          changerEtat({ mode: 'OFFLINE', detail: reseau.detail ?? reseau.etat })
          await new Promise((r) => setTimeout(r, INTERVALLE_ERREUR_MS))
        }
      } catch (e) {
        log('Watcher sync : ' + String(e?.message ?? e))
        await new Promise((r) => setTimeout(r, INTERVALLE_ERREUR_MS))
      }
    }
  }

  boucle().catch((e) => log('Watcher sync arrêté sur erreur : ' + String(e)))

  return {
    arreter: () => {
      arrete = true
    },
    definirSession,
    cycleMaintenant: cycle,
  }
}

export async function fermerWatcher() {
  await fermerAppliquer()
}
