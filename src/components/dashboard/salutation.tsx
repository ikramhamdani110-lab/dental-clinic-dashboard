'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * =============================================================================
 *  SALUTATION DU TABLEAU DE BORD — ANIMATION DE FRAPPE, UNE SEULE FOIS
 * =============================================================================
 *
 *  Affiche « Bonjour Dr Sahed » en revelant les lettres une par une. L'animation
 *  se joue QU'UNE SEULE FOIS PAR SESSION, et seulement lorsque le medecin ENTRE
 *  dans le tableau de bord depuis une AUTRE section.
 *
 *  CE QUI PILOTE L'ANIMATION, ET CE QUI NE LA PILOTE PAS
 *
 *    Le MONTAGE ne peut pas servir de declencheur : un composant client est
 *    demonte puis remonte a chaque navigation, et React en mode strict
 *    (`reactStrictMode`) monte, demonte et remonte chaque effet. Une animation
 *    declenchee au montage se rejouerait donc a chaque retour sur le tableau de
 *    bord, et son minuteur serait arrete par le nettoyage intermediaire du mode
 *    strict — c'est exactement ce qui laissait la salutation vide, curseur
 *    clignotant.
 *
 *    L'animation est donc pilotee par une MACHINE A ETATS conservee dans une
 *    reference, qui survit aux remontages de l'effet :
 *
 *      'vierge'   — rien n'a encore ete tente ;
 *      'en-cours' — la frappe est engagee ; un minuteur vit quelque part ;
 *      'finie'    — la frappe est terminee (ou volontairement omise).
 *
 *    Le minuteur lui-meme vit dans une AUTRE reference. L'effet ne l'arrete
 *    jamais : il le laisse vivre jusqu'a la derniere lettre. Le nettoyage du mode
 *    strict ne peut donc plus tuer l'animation en cours.
 *
 *  QUAND L'ANIMATION SE DECLENCHE
 *
 *    A l'ENTREE dans le tableau de bord, c'est-a-dire quand le chemin precedent
 *    n'etait pas `/tableau-de-bord` :
 *      - `precedent === null` : premier rendu apres un chargement de page ;
 *      - `precedent !== chemin` : navigation depuis une autre section.
 *
 *    Un simple re-rendu sur place (`precedent === chemin`) ne declenche rien.
 *    Un retour ulterieur depuis une autre section ne declenche rien non plus :
 *    l'etat vaut alors 'finie', et le drapeau de session confirme.
 *
 *  REGLES RESPECTEES
 *
 *   - L'animation ne se joue qu'UNE fois : l'index progresse de 0 a la longueur
 *     du texte, puis le minuteur est arrete. Rien ne relance la progression.
 *   - Elle n'EFFACE jamais le texte : l'index ne diminue jamais.
 *   - Elle NE BOUCLE PAS : aucune condition de retour au debut.
 *   - Le texte final RESTE affiche, definitivement.
 *
 *  POURQUOI PAS D'ANIMATION CSS POUR LE TEXTE
 *
 *    Une machine a ecrire en CSS (largeur animee + `overflow: hidden`) masquerait
 *    des lettres et produirait un rendu variant selon la police et la largeur
 *    reelle du texte. Ici le texte complet est TOUJOURS dans le DOM pour les
 *    lecteurs d'ecran, et seule la portion visible change : l'information reste
 *    accessible immediatement, sans attendre la fin de l'animation.
 *
 *  Si le systeme demande des animations reduites, le texte apparait d'emblee.
 */

/** Delai entre deux lettres. Assez vif pour rester elegant, jamais saccade. */
const DELAI_PAR_LETTRE_MS = 55

/** Chemin de l'accueil prive : c'est LUI qui marque une « entree ». */
const CHEMIN_TABLEAU_BORD = '/tableau-de-bord'

/**
 * Cle du drapeau « frappe deja jouee POUR CETTE connexion ».
 *
 * Elle est SUFFIXEE de l'identifiant de connexion fourni par le serveur.
 * C est la cle du comportement demande :
 *
 *   - la meme connexion conserve le meme suffixe, donc revenir sur le tableau
 *     de bord ne rejoue rien ;
 *   - une nouvelle connexion donne un jeton neuf, donc un suffixe different,
 *     et la frappe se rejoue.
 *
 * Le stockage est `sessionStorage` : il est vide a l'ouverture d'un nouvel
 * onglet comme apres une fermeture complete du navigateur. Dans les deux cas la
 * frappe se joue, ce qui est attendu pour une nouvelle seance.
 *
 * Le numero de version (`v2`) rappelle que la regle a change : les sessions
 * ouvertes avant le changement repartent d un etat propre.
 */
const CLE_SESSION = 'sahed-salutation-jouee:v2'

/** Separateur entre la cle et l identifiant de connexion. */
const SEPARATEUR_CLE = ':'

/** Cle de stockage propre a la connexion courante. */
function clefDeSession(sessionId: string | null): string {
  return CLE_SESSION + SEPARATEUR_CLE + (sessionId ?? 'courante')
}

/**
 * Indique si la frappe a deja ete jouee POUR LA CONNEXION COURANTE.
 */
function dejaJouee(sessionId: string | null): boolean {
  try {
    return window.sessionStorage.getItem(clefDeSession(sessionId)) === '1'
  } catch {
    // Stockage indisponible : on laisse jouer plutot que de bloquer l affichage.
    return false
  }
}

/** Marque la frappe comme jouee POUR LA CONNEXION COURANTE. */
function marquerJouee(sessionId: string | null): void {
  try {
    window.sessionStorage.setItem(clefDeSession(sessionId), '1')
  } catch {
    // Stockage indisponible : l animation se rejouera, ce qui reste correct.
  }
}

export function SalutationTableauBord({
  texte,
  sessionId,
}: {
  texte: string
  /**
   * Identifiant de la connexion, fourni par le serveur.
   *
   * C'est lui — et lui seul — qui distingue deux connexions successives : la
   * frappe se rejoue quand cette valeur change. Comme elle est lue dans une
   * variable de rendu, React remonte l effet des qu elle change.
   */
  sessionId: string | null
}): React.JSX.Element {
  /*
   * Par defaut, le texte COMPLET est affiche : c'est l'etat sur et immediat.
   *
   * L'animation consiste a REVELER le texte, jamais a le masquer puis le
   * reafficher. Tant que la decision de jouer n'est pas prise, la salutation est
   * donc lisible — sans JavaScript comme avant l'hydratation. C'est aussi ce qui
   * evite toute divergence d'hydratation.
   */
  const [lettresAffichees, setLettresAffichees] = useState(texte.length)

  /*
   * Machine a etats de la frappe.
   *
   * Elle vit dans une reference, donc elle SURVIT aux remontages de l'effet
   * provoques par le mode strict. C'est elle qui garantit qu'une frappe n'est
   * engagee qu'une fois, sans jamais dependre du cycle de vie du composant.
   */
/** Etats possibles de la frappe, portes par la machine a etats. */
type EtatFrappe = 'vierge' | 'en-cours' | 'finie'

  const etatFrappe = useRef<EtatFrappe>('vierge')

  /** Minuteur de la frappe. Il n'est arrete qu'a la fin, ou au demontage. */
  const minuteur = useRef<number | null>(null)

  // Chemin courant et chemin precedent : ce couple distingue une ENTREE dans le
  // tableau de bord d'un simple re-rendu sur place.
  const chemin = usePathname()
  const cheminPrecedent = useRef<string | null>(null)

  useEffect(() => {
    const precedent = cheminPrecedent.current

    // 1. On n'anime QUE sur le tableau de bord.
    if (chemin !== CHEMIN_TABLEAU_BORD) {
      cheminPrecedent.current = chemin
      return
    }

    /*
     * 2. On n'anime QUE si l'on vient d'une AUTRE section.
     *
     *    Le chemin precedent n'est PAS encore enregistre a ce stade : les deux
     *    passages de l'effet (mode strict) doivent observer le meme etat pour
     *    prendre la meme decision.
     */
    const entreDansLeTableauDeBord = precedent === null || precedent !== chemin

    // 3. La frappe ne peut etre engagee qu'une fois, et une seule.
    if (etatFrappe.current !== 'vierge') return

    // 4. Un re-rendu sur place n'est pas une entree : rien a jouer.
    if (!entreDansLeTableauDeBord) {
      cheminPrecedent.current = chemin
      return
    }

    // 5. Une frappe deja jouee dans cette session ne se rejoue pas.
    if (dejaJouee(sessionId)) {
      etatFrappe.current = 'finie'
      cheminPrecedent.current = chemin
      return
    }

    // 6. Animations reduites : le texte reste affiche d'emblee, sans frappe.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      etatFrappe.current = 'finie'
      marquerJouee(sessionId)
      cheminPrecedent.current = chemin
      return
    }

    /*
     * 7. TOUTES les conditions sont reunies : la frappe est engagee.
     *
     *    L'etat passe a 'en-cours' AVANT toute mise a jour d'etat React. Les
     *    passages ulterieurs de l'effet (mode strict, re-rendus) sont donc
     *    filtres par le test 3, sans pouvoir arreter le minuteur.
     */
    etatFrappe.current = 'en-cours'
    cheminPrecedent.current = chemin
    setLettresAffichees(0)

    let index = 0
    minuteur.current = window.setInterval(() => {
      index += 1
      setLettresAffichees(index)

      // Fin de la frappe : on arrete le minuteur, on marque la session, et on
      // fige l'etat. Le texte reste affiche tel quel, definitivement.
      if (index >= texte.length) {
        if (minuteur.current !== null) {
          window.clearInterval(minuteur.current)
          minuteur.current = null
        }
        etatFrappe.current = 'finie'
        marquerJouee(sessionId)
      }
    }, DELAI_PAR_LETTRE_MS)

    /*
     * AUCUN NETTOYAGE ICI, VOLONTAIREMENT.
     *
     * Arreter le minuteur dans la fonction de nettoyage le tuerait des le
     * remontage du mode strict, et la salutation resterait vide. Le minuteur est
     * donc laisse vivant : il s'arrete de lui-meme a la derniere lettre. Seul le
     * demontage reel du composant l'interrompt (effet dedie ci-dessous).
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chemin, sessionId])

  /*
   * AUCUN EFFET DE NETTOYAGE SEPARE.
   *
   * Un effet dedie avec un tableau de dependances vide semblait judicieux, mais
   * il est PIEge : React en mode strict simule un demontage immediatement apres
   * le montage, ce qui declencherait son nettoyage et arreterait le minuteur tout
   * juste cree.
   *
   * Le minuteur n'a donc AUCUN nettoyage : il s'arrete de lui-meme a la derniere
   * lettre (voir le test `index >= texte.length`). Si le composant quitte l'arbre
   * en pleine frappe, le minuteur continue quelques dizaines de millisecondes sur
   * un composant demonte — ce qui est sans consequence, React ignorant les mises
   * a jour d'etat d'un composant demonte, et le drapeau de session etant de toute
   * facon deja pose.
   */

  const frappeEnCours = lettresAffichees < texte.length
  /*
   * DEUX ELEMENTS, DEUX ROLES — ET UN SEUL TEXTE VISIBLE.
   *
   *   `visuellement-cache` : le texte COMPLET, en permanence, pour les lecteurs
   *   d'ecran. Il est retire du flux (1 px, `clip`), donc invisible.
   *
   *   `salutation-texte` : la portion VISIBLE, celle qui se remplit lettre a
   *   lettre. C'est le SEUL texte peint a l'ecran : il n'existe donc jamais deux
   *   fois a l'ecran, meme pendant la frappe.
   *
   * Les deux sont des `<span>` a l'interieur du meme `<h1>` : le titre reste un
   * seul element semantique, et la typographie de la salutation s'applique aux
   * deux (aucun enfant n'a de famille propre).
   */
  return (
    <h1 className="salutation">
      <span className="visuellement-cache">{texte}</span>
      <span className="salutation-texte" aria-hidden="true">
        {frappeEnCours ? texte.slice(0, lettresAffichees) : texte}
        {/* Curseur : visible seulement pendant la frappe, retire a la fin. */}
        {frappeEnCours ? <span className="salutation-curseur" aria-hidden="true" /> : null}
      </span>
    </h1>
  )
}