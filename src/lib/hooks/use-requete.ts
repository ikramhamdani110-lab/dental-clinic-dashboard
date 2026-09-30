'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, messageErreur, requeteApi, type OptionsRequete } from '@/lib/api-client'

/**
 * =============================================================================
 *  RECUPERATION DE DONNEES COTE CLIENT
 * =============================================================================
 *
 *  Un petit crochet maison plutot qu'une grande bibliotheque : le besoin est
 *  simple (charger une ressource, recharger apres une action), et chaque
 *  dependance supplementaire doit etre justifiee (§58).
 *
 *  Il gere :
 *    - l'etat de chargement,
 *    - l'erreur (message francais deja normalise par le client API),
 *    - l'annulation de la requete precedente lors d'un rechargement ou d'un
 *      demontage (evite les mises a jour d'etat apres disparition du composant).
 */

export interface EtatRequete<T> {
  donnees: T | null
  chargement: boolean
  erreur: string | null
  /** Identifiant de reponse attendu : toute erreur 404 y est aussi signalee. */
  introuvable: boolean
  recharger: () => void
}

export function useRequete<T>(chemin: string | null, options?: OptionsRequete): EtatRequete<T> {
  const [donnees, setDonnees] = useState<T | null>(null)
  const [chargement, setChargement] = useState<boolean>(Boolean(chemin))
  const [erreur, setErreur] = useState<string | null>(null)
  const [introuvable, setIntrouvable] = useState(false)
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

    const controleur = new AbortController()
    let annule = false

    setChargement(true)
    setErreur(null)
    setIntrouvable(false)

    requeteApi<T>(chemin, { ...optionsRef.current, signal: controleur.signal })
      .then((resultat) => {
        if (annule) return
        setDonnees(resultat)
        setChargement(false)
      })
      .catch((cause: unknown) => {
        if (annule) return
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setErreur(messageErreur(cause))
        setIntrouvable(cause instanceof ApiError && cause.statut === 404)
        setChargement(false)
      })

    return () => {
      annule = true
      controleur.abort()
    }
  }, [chemin, compteur])

  return { donnees, chargement, erreur, introuvable, recharger }
}

/**
 * Crochet de recherche avec DEBOUNCE (§26).
 *
 * La recherche n'est envoyee au serveur qu'une fois la frappe stabilisee : cela
 * evite une requete par touche, ce qui saturerait inutilement la base.
 */
export function useDebounce<T>(valeur: T, delaiMs = 300): T {
  const [valeurDifferee, setValeurDifferee] = useState(valeur)

  useEffect(() => {
    const minuteur = window.setTimeout(() => setValeurDifferee(valeur), delaiMs)
    return () => window.clearTimeout(minuteur)
  }, [valeur, delaiMs])

  return valeurDifferee
}
