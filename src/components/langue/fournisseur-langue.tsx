'use client'

import { createContext, Fragment, useCallback, useContext, useEffect, useState } from 'react'

import {
  CLE_LANGUE,
  LANGUE_DEFAUT,
  arbreLangue,
  definirLangueActive,
  estRtl,
  t as tTraduire,
  type ContenuFr,
  type Langue,
} from '@content/index'

/**
 * =============================================================================
 *  FOURNISSEUR DE LANGUE (FR PAR DÉFAUT, AR RTL)
 * =============================================================================
 *
 *  Le français est la langue PAR DÉFAUT : une première ouverture affiche
 *  l'application en français, sans action du médecin. S'il bascule en arabe,
 *  le choix est mémorisé dans le navigateur (localStorage) et appliqué dès le
 *  chargement suivant : `<html dir="rtl" lang="ar">`, texte aligné à droite.
 *
 *  Les composants lisent la langue via `useLangue` et traduisent avec
 *  `t(chemin, langue)`. Aucun texte n'est codé en dur selon la langue.
 *
 *  SEULS LES LIBELLÉS BASCULENT. Les données du cabinet (noms, adresses,
 *  notes, traitements...) viennent de la base et ne passent JAMAIS par `t()` :
 *  elles restent exactement telles qu'enregistrées.
 */

interface ContexteLangue {
  langue: Langue
  rtl: boolean
  /** Incrémenté à chaque changement : force le re-rendu des consommateurs. */
  version: number
  changerLangue: (langue: Langue) => void
}

const Contexte = createContext<ContexteLangue>({
  langue: LANGUE_DEFAUT,
  rtl: false,
  version: 0,
  changerLangue: () => {},
})

/** Lit la langue enregistrée, avec repli sûr sur le français. */
function lireLangueEnregistree(): Langue {
  try {
    const valeur = window.localStorage.getItem(CLE_LANGUE)
    return valeur === 'ar' ? 'ar' : LANGUE_DEFAUT
  } catch {
    return LANGUE_DEFAUT
  }
}

/** Applique la direction et la langue au document. */
function appliquerLangueAuDocument(langue: Langue): void {
  const racine = document.documentElement
  racine.lang = langue
  racine.dir = estRtl(langue) ? 'rtl' : 'ltr'
  racine.setAttribute('data-langue', langue)
}

export function FournisseurLangue({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Le PREMIER rendu est toujours français (rendu serveur et hydratation
  // identiques) : la langue enregistrée est lue APRES montage, comme le thème.
  const [langue, setLangue] = useState<Langue>(LANGUE_DEFAUT)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const enregistree = lireLangueEnregistree()
    setLangue(enregistree)
    definirLangueActive(enregistree)
    appliquerLangueAuDocument(enregistree)
  }, [])

  const changerLangue = useCallback((suivante: Langue) => {
    setLangue(suivante)
    setVersion((v) => v + 1)
    // Rend la langue visible partout : les `t()` sans argument la lisent.
    definirLangueActive(suivante)
    try {
      window.localStorage.setItem(CLE_LANGUE, suivante)
    } catch {
      // Stockage indisponible : le choix tient pour la session courante.
    }
    appliquerLangueAuDocument(suivante)
  }, [])

  return (
    <Contexte.Provider value={{ langue, rtl: estRtl(langue), version, changerLangue }}>
      {/*
        Remontage de l'arbre au changement de langue (key={version}).

        C'est ce qui fait basculer TOUTE l'interface sans modifier aucun
        composant : les centaines d'appels à `t()` résolvent leur libellé au
        rendu, donc un re-rendu complet suffit. Aucun élément n'est ajouté au
        DOM (Fragment), la mise en page est inchangée — seuls les MOTS changent.
      */}
      <Fragment key={version}>{children}</Fragment>
    </Contexte.Provider>
  )
}

/** Langue courante du rendu client + fonction de bascule. */
export function useLangue(): ContexteLangue {
  return useContext(Contexte)
}

/** Traduit un chemin dans la langue courante du client. */
export function useT(): (chemin: string) => string {
  const { langue } = useContext(Contexte)
  return useCallback((chemin: string) => tTraduire(chemin, langue), [langue])
}

/** Arbre de libellés de la langue courante (pour les listes). */
export function useContenu(): ContenuFr {
  const { langue } = useContext(Contexte)
  return arbreLangue(langue)
}
