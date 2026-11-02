'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, messageErreur, requeteFinanciere, type OptionsRequete } from '@/lib/finances-api-client'

/**
 * =============================================================================
 *  RECUPERATION DE DONNEES — SITE FINANCIER
 * =============================================================================
 *
 *  Meme contrat que `useRequete` du tableau de bord clinique, mais appelle le
 *  client financier dedie (`requeteFinanciere`), donc la session separee.
 */

export interface EtatRequeteFinanciere<T> {
  donnees: T | null
  chargement: boolean
  erreur: string | null
  recharger: () => void
}

export function useRequeteFinanciere<T>(
  chemin: string | null,
  options?: OptionsRequete,
): EtatRequeteFinanciere<T> {
  const [donnees, setDonnees] = useState<T | null>(null)
  const [chargement, setChargement] = useState<boolean>(Boolean(chemin))
  const [erreur, setErreur] = useState<string | null>(null)
  const [compteur, setCompteur] = useState(0)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const recharger = useCallback(() => setCompteur((valeur) => valeur + 1), [])

  useEffect(() => {
    if (!chemin) {
      setChargement(false)
      setDonnees(null)
      return
    }

    let annule = false
    setChargement(true)
    setErreur(null)

    requeteFinanciere<T>(chemin, optionsRef.current)
      .then((resultat) => {
        if (annule) return
        setDonnees(resultat)
      })
      .catch((cause: unknown) => {
        if (annule) return
        setErreur(cause instanceof ApiError ? cause.message : messageErreur(cause))
      })
      .finally(() => {
        if (annule) return
        setChargement(false)
      })

    return () => {
      annule = true
    }
  }, [chemin, compteur])

  return { donnees, chargement, erreur, recharger }
}
