'use client'

import { useEffect, useState } from 'react'

/**
 * =============================================================================
 *  INDICATEUR DE SYNCHRONISATION (application de bureau uniquement)
 * =============================================================================
 *
 *  Bandeau discret dans l'en-tête de page : l'utilisateur doit toujours
 *  savoir si ses données sont SAUVEGARDÉES LOCALEMENT et si elles ont atteint
 *  le système en ligne. Sur les sites web, `window.sahedDesktop` n'existe pas :
 *  le composant ne rend RIEN (aucun impact sur le site en ligne).
 *
 *  Tous les libellés sont en FRANÇAIS (exigence §6).
 */

type EtatSync =
  | { mode: 'SYNCED'; compteurs?: Record<string, number> }
  | { mode: 'SYNCING' }
  | { mode: 'OFFLINE'; detail?: string }
  | { mode: 'ERREUR'; detail?: string }
  | { mode: 'SESSION_EXPIREE'; detail?: string }
  | { mode: 'APPAREIL_REVOQUE'; detail?: string }
  | { mode: 'NON_APPAIRE'; detail?: string }
  | null

interface CompteursSync {
  enAttente: number
  synchronisees: number
  conflits: number
  rejetees: number
}

const LIBELLES: Record<NonNullable<EtatSync>['mode'], { texte: string; classe: string }> = {
  SYNCED: { texte: 'Synchronisé', classe: 'sync-badge sync-ok' },
  SYNCING: { texte: 'Synchronisation en cours…', classe: 'sync-badge sync-encours' },
  OFFLINE: { texte: 'Hors ligne — données enregistrées sur cet ordinateur', classe: 'sync-badge sync-horsligne' },
  ERREUR: { texte: 'Échec de synchronisation', classe: 'sync-badge sync-erreur' },
  SESSION_EXPIREE: { texte: 'Session en ligne expirée — reconnexion requise', classe: 'sync-badge sync-erreur' },
  APPAREIL_REVOQUE: { texte: 'Appareil révoqué — synchronisation désactivée', classe: 'sync-badge sync-erreur' },
  NON_APPAIRE: { texte: 'Synchronisation désactivée (appairage requis)', classe: 'sync-badge sync-horsligne' },
}

function formaterHeure(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function IndicateurSynchronisation(): React.JSX.Element | null {
  const [actif, setActif] = useState(false)
  const [etat, setEtat] = useState<EtatSync>(null)
  const [compteurs, setCompteurs] = useState<CompteursSync | null>(null)
  const [derniere, setDerniere] = useState<string | null>(null)

  useEffect(() => {
    const api = (
      window as unknown as {
        sahedDesktop?: {
          etatSyncActuel: () => Promise<EtatSync>
          derniereSynchro: () => Promise<string | null>
          compteurs: () => Promise<CompteursSync | null>
          surChangementEtat: (r: (e: EtatSync) => void) => () => void
        }
      }
    ).sahedDesktop
    if (!api) return // Site web : rien à afficher.
    const canal = api
    setActif(true)
    let demonte = false
    async function charger() {
      const etatActuel = await canal.etatSyncActuel()
      const derniereValeur = await canal.derniereSynchro()
      const compteursValeur = await canal.compteurs()
      if (demonte) return
      setEtat(etatActuel)
      setDerniere(derniereValeur)
      setCompteurs(compteursValeur)
    }
    void charger()
    const arreter = canal.surChangementEtat((nouvelEtat) => {
      setEtat(nouvelEtat)
      void canal.compteurs().then((c: CompteursSync | null) => {
        if (!demonte) setCompteurs(c)
      })
      if (nouvelEtat?.mode === 'SYNCED') {
        void canal.derniereSynchro().then((d: string | null) => {
          if (!demonte) setDerniere(d)
        })
      }
    })
    const intervalle = setInterval(charger, 15_000)
    return () => {
      demonte = true
      clearInterval(intervalle)
      arreter()
    }
  }, [])

  if (!actif || !etat) return null
  const libelle = LIBELLES[etat.mode] ?? { texte: 'Clinique Sahed', classe: 'sync-badge' }

  return (
    <div className={libelle.classe} role="status" aria-live="polite">
      <span className="sync-badge-texte">{libelle.texte}</span>
      <span className="sync-badge-detail">
        Dernière synchronisation : {formaterHeure(derniere)}
        {compteurs && compteurs.enAttente > 0 ? ` · ${compteurs.enAttente} en attente` : ''}
        {compteurs && compteurs.conflits > 0 ? ` · ${compteurs.conflits} conflit(s) à résoudre` : ''}
      </span>
    </div>
  )
}
