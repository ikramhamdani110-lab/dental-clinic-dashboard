'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { t } from '@content/index'

/**
 * =============================================================================
 *  GESTION DU THEME (clair / sombre)
 * =============================================================================
 *
 *  Le theme est applique via l'attribut `data-theme` sur `<html>`, deja pose
 *  par le script de mise en page racine (eviter le flash au chargement).
 *
 *  Ce contexte ne fait que refleter et modifier ce choix. Il est volontairement
 *  minimal : aucun rendu ne doit dependre de son hydratation pour rester
 *  utilisable.
 */

type Theme = 'clair' | 'sombre'

interface ThemeContextValue {
  theme: Theme
  basculerTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const CLE_STOCKAGE = 'sahed-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  /*
   * Le rendu serveur ne connait pas le theme : on part du defaut (sombre) et on
   * corrige au montage, a partir de l'attribut DEJA pose par le script racine.
   *
   * Ce n'est pas une source de clignotement : le script d'amorcage s'execute
   * avant la peinture, donc l'ATTRIBUT est deja correct ; seul l'ETAT React
   * arrive une fraction de seconde plus tard, et il ne pilote que l'icone du
   * bouton de bascule, jamais les couleurs de l'interface.
   */
  const [theme, setTheme] = useState<Theme>('sombre')

  useEffect(() => {
    const actuel = document.documentElement.getAttribute('data-theme')
    if (actuel === 'clair' || actuel === 'sombre') setTheme(actuel)
  }, [])

  /*
   * `appliquerTheme` est le SEUL endroit qui ecrit `data-theme`. Toute la
   * coherence clair / sombre de l'application repose sur cet attribut unique :
   * aucun composant ne peint ses propres couleurs, donc aucun composant ne peut
   * « rester en arriere » lors d'une bascule.
   * L'attribut est ecrit sur `<html>` — la racine du document — afin que le
   * theme atteigne AUSSI les surfaces hors `<body>` (fond du document, barres de
   * defilement, controles natifs), et pas seulement l'arbre React.
   */
  const appliquerTheme = useCallback((suivant: Theme) => {
    document.documentElement.setAttribute('data-theme', suivant)
    try {
      localStorage.setItem(CLE_STOCKAGE, suivant)
    } catch {
      // Le stockage peut etre indisponible (navigation privee) : le theme
      // s'applique pour la session sans etre persiste. Pas d'erreur visible.
    }
  }, [])

  const basculerTheme = useCallback(() => {
    setTheme((precedent) => {
      const suivant: Theme = precedent === 'sombre' ? 'clair' : 'sombre'
      appliquerTheme(suivant)
      return suivant
    })
  }, [appliquerTheme])

  return <ThemeContext.Provider value={{ theme, basculerTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const contexte = useContext(ThemeContext)
  if (!contexte) {
    throw new Error('useTheme doit etre utilise a l’interieur de ThemeProvider.')
  }
  return contexte
}

/** Bouton de bascule clair / sombre. */
export function BoutonTheme(): React.JSX.Element {
  const { theme, basculerTheme } = useTheme()
  const versClair = theme === 'sombre'

  return (
    <button
      type="button"
      onClick={basculerTheme}
      className="bouton-theme"
      aria-label={versClair ? t('theme.modeClair') : t('theme.modeSombre')}
      title={versClair ? t('theme.modeClair') : t('theme.modeSombre')}
    >
      <span aria-hidden="true">{versClair ? '☀' : '☾'}</span>
      <span className="visuellement-cache">
        {versClair ? t('theme.modeClair') : t('theme.modeSombre')}
      </span>
    </button>
  )
}
