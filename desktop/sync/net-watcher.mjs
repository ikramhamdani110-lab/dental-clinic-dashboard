// =============================================================================
//  SURVEILLANT RESEAU + BOUCLE DE SYNCHRONISATION — desktop/sync/net-watcher.mjs
// =============================================================================
//  Relance automatiquement la synchronisation :
//    - a la reconnexion reseau (test TCP vers le serveur local Next.js, qui
//      lui-meme atteint Neon) ;
//    - toutes les 60 secondes tant que la connexion est active ;
//    - apres un crash : la file est relue depuis la base, rien n'est perdu.
//
//  REGLE ABSOLUE : l'application fonctionne INTEGRALEMENT hors ligne. Ce
//  module n'est jamais bloquant pour l'usage local — une coupure reseau
//  suspend la sync, jamais l'application.
// =============================================================================

import { pousser, tirer } from './client.mjs'

const INTERVALLE_OK_MS = 60_000
const INTERVALLE_ERREUR_MS = 15_000
const ATTENTE_STABILITE_MS = 5_000

export function demarrerWatcher({ deviceId, jetonAppareil, queue, log, surEtat }) {
  let arrete = false
  let enCours = false

  async function cycle() {
    if (arrete || enCours) return
    enCours = true
    try {
      // 1. PULL d'abord : les conflits sont detectes AVANT tout ecrasement.
      const tables = ['patients', 'appointments', 'treatments', 'payments', 'documents']
      const { lots } = await tirer({ deviceId, jetonAppareil, tables })
      await appliquerLotsLocalement(lots, log)

      // 2. PUSH ensuite : la file locale est jouee dans l'ordre chronologique.
      let lot = await queue.prochainLot(100)
      while (lot.length > 0 && !arrete) {
        for (const operation of lot) {
          await queue.marquerSyncing(operation.operationId)
        }
        let resultats
        try {
          resultats = await pousser({ deviceId, jetonAppareil, operations: lot })
        } catch (erreur) {
          if (erreur.code === 'DEVICE_REVOKED') {
            log('Appareil revoke — bascule en hors-ligne definitif.')
            surEtat?.({ mode: 'REVOKED' })
            arrete = true
            return
          }
          // Erreur reseau : retour en PENDING avec backoff exponentiel.
          for (const operation of lot) {
            await queue.marquerPending(operation.operationId, String(erreur.message))
          }
          surEtat?.({ mode: 'OFFLINE', erreur: String(erreur.message) })
          return
        }

        const parId = new Map(resultats.map((r) => [r.operationId, r]))
        for (const operation of lot) {
          const resultat = parId.get(operation.operationId)
          if (!resultat) {
            await queue.marquerPending(operation.operationId, 'Pas de reponse serveur pour cette operation.')
            continue
          }
          if (resultat.outcome === 'APPLIED' || resultat.outcome === 'ALREADY_APPLIED') {
            await queue.marquerSynchronized(operation.operationId)
          } else if (resultat.outcome === 'CONFLICT') {
            await queue.marquerConflict(operation.operationId, resultat.detail ?? 'Conflit non detaille')
          } else {
            await queue.marquerRejected(operation.operationId, resultat.detail ?? 'Rejet sans detail')
          }
        }
        lot = await queue.prochainLot(100)
      }

      surEtat?.({ mode: 'SYNCED', compteurs: await queue.compteurs() })
    } catch (erreur) {
      surEtat?.({ mode: 'OFFLINE', erreur: String(erreur.message) })
    } finally {
      enCours = false
    }
  }

  // Detection reseau : test TCP vers le serveur local, qui relaie Neon.
  async function reseauDisponible() {
    const net = await import('node:net')
    return new Promise((resolve) => {
      const socket = net.default.connect({ host: '127.0.0.1', port: 43_177 })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
      socket.setTimeout(2000, () => { socket.destroy(); resolve(false) })
    })
  }

  async function boucle() {
    while (!arrete) {
      const disponible = await reseauDisponible()
      if (disponible) {
        // Attente de stabilite (5 s) pour eviter les bascules rapides.
        await new Promise((r) => setTimeout(r, ATTENTE_STABILITE_MS))
        if (!arrete && await reseauDisponible()) await cycle()
        if (!arrete) await new Promise((r) => setTimeout(r, INTERVALLE_OK_MS))
      } else {
        surEtat?.({ mode: 'OFFLINE', erreur: 'Reseau indisponible' })
        await new Promise((r) => setTimeout(r, INTERVALLE_ERREUR_MS))
      }
    }
  }

  boucle().catch((e) => log('Watcher sync arrete sur erreur : ' + String(e)))

  return () => { arrete = true }
}

/** Applique localement les changements recus du serveur (pull). */
async function appliquerLotsLocalement(lots, log) {
  const pathMod = await import('node:path')
  const dossierStandalone = process.env.DESKTOP_SEED_STANDALONE
    ?? pathMod.default.resolve(process.env.APP_ROOT ?? '.', 'standalone')
  const cheminClient = 'file:///' + pathMod.default.resolve(dossierStandalone, 'node_modules', '@prisma', 'client', 'index.js').replace(/\\/g, '/')
  const moduleClient = await import(cheminClient)
  const PrismaClient = moduleClient.PrismaClient ?? moduleClient.default?.PrismaClient
  const prisma = new PrismaClient()
  try {
    for (const patient of lots.patients ?? []) {
      await prisma.patient.upsert({
        where: { id: patient.id },
        create: patient,
        update: patient,
      })
    }
    for (const rdv of lots.appointments ?? []) {
      // Un RDV distant en conflit de creneau n'est PAS applique : la contrainte
      // EXCLUDE locale le rejetterait. Il est consigne pour arbitrage.
      try {
        await prisma.appointment.upsert({ where: { id: rdv.id }, create: rdv, update: rdv })
      } catch {
        log(`RDV distant ${String(rdv.id)} en conflit de creneau local — arbitrage requis.`)
      }
    }
    for (const traitement of lots.treatments ?? []) {
      await prisma.treatment.upsert({ where: { id: traitement.id }, create: traitement, update: traitement })
    }
    for (const paiement of lots.payments ?? []) {
      await prisma.payment.upsert({ where: { id: paiement.id }, create: paiement, update: paiement })
    }
  } finally {
    await prisma.$disconnect()
  }
}
