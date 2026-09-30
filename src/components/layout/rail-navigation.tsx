'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

import { Icone, type NomIcone } from '@/components/ui/icone'
import { useNotifications } from '@/components/ui/notifications'
import { useTheme } from '@/components/ui/theme-provider'
import { messageErreur, requeteApi } from '@/lib/api-client'

/**
 * =============================================================================
 *  RAIL DE NAVIGATION VERTICAL (remplace la barre laterale et la barre d'entete)
 * =============================================================================
 *
 *  Principe : un rail FLOTTANT, etroit et arrondi, pose a gauche du contenu.
 *  Il n'occupe que la largeur de ses icones — le contenu gagne toute la place
 *  horizontale qu'occupaient l'ancienne barre laterale (15 rem) et l'entete.
 *
 *  Trois idees structurent ce composant :
 *
 *   1. ICONES SEULES PAR DEFAUT. Le libelle n'apparait qu'au survol ou au focus
 *      clavier, et SEUL l'element concerne le revele : le rail ne s'elargit
 *      jamais. Le libelle est positionne en ABSOLU (`position: absolute`) pour
 *      qu'il ne participe pas a la largeur du rail — sans cela, l'apparition du
 *      texte pousserait la mise en page et provoquerait un debordement.
 *
 *   2. ACCESSIBLE SANS SURVOL. Chaque lien porte un `aria-label` explicite et
 *      un `title` (infobulle native). Le libelle visuel s'affiche aussi au
 *      `:focus-visible`, donc au clavier exactement comme a la souris. Le survol
 *      n'est jamais le seul moyen d'atteindre une information.
 *
 *   3. ETAT ACTIF EXPLICITE. L'element courant porte `aria-current="page"` :
 *      c'est a la fois ce qu'annoncent les lecteurs d'ecran et ce que la feuille
 *      de style utilise pour le mettre en evidence. Aucune duplication de logique.
 *
 *  Aucun systeme de theme n'est cree ici : le composant consomme le
 *  `ThemeProvider` existant (`@/components/ui/theme-provider`).
 *
 *  Le rail est present sur TOUTES les pages privees : Tableau de bord, Patients,
 *  Rendez-vous, Rapports.
 */

interface EntreeRail {
  href: string
  libelle: string
  icone: NomIcone
}

/**
 * Ordre impose : Patients, Rendez-vous, Rapports.
 *
 * Le Tableau de bord n'est PAS dans cette liste : il reste joignable par la
 * marque du rail (le monogramme « DS » en haut), qui ramene a l'accueil de
 * l'espace prive. Cela evite d'ajouter une quatrieme icone a un rail dont la
 * fonction est justement d'etre compact.
 */
const ENTREES: EntreeRail[] = [
  { href: '/patients', libelle: t('navigation.patients'), icone: 'patients' },
  { href: '/rendez-vous', libelle: t('navigation.rendezVous'), icone: 'calendrier' },
  { href: '/rapports', libelle: t('navigation.rapports'), icone: 'rapports' },
]

export function RailNavigation(): React.JSX.Element {
  const { theme, basculerTheme } = useTheme()
  const notifications = useNotifications()
  const router = useRouter()
  // Le chemin sert ici uniquement a marquer la marque « DS » comme courante
  // lorsque le medecin est sur le tableau de bord : la marque EST l'entree de
  // cette section, elle doit donc porter `aria-current` comme les autres.
  const chemin = usePathname()
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false)

  const enClair = theme === 'clair'

  /**
   * Deconnexion : action SERVEUR (revocation de la session), pas un simple
   * effacement de cookie cote navigateur. Comportement inchange — l'ancien
   * bouton d'en-tete a simplement change d'emplacement.
   */
  async function seDeconnecter(): Promise<void> {
    setDeconnexionEnCours(true)
    try {
      await requeteApi('/api/auth/logout', { methode: 'POST' })
      router.push('/connexion')
      router.refresh()
    } catch (erreur) {
      notifications.erreur(messageErreur(erreur))
      setDeconnexionEnCours(false)
    }
  }

  return (
    <nav className="rail" aria-label={t('navigation.menuPrincipal')}>
      {/* Marque : ramene a l'accueil de l'espace prive. */}
      <Link
        href="/tableau-de-bord"
        className="rail-item rail-marque"
        aria-current={chemin === '/tableau-de-bord' ? 'page' : undefined}
        aria-label={t('navigation.tableauDeBord')}
        title={t('navigation.tableauDeBord')}
      >
        {/*
          MARQUE « DS » — Sahed Dental.

          Elle remplace l'ancienne icone de tableau de bord : ce n'est pas un
          pictogramme generique mais le monogramme du cabinet, utilise comme
          petit repere de marque. Il ramene a l'accueil de l'espace prive.

          Le libelle « Tableau de bord » n'apparait qu'au survol / au focus, en
          meme temps que le petit soulignement, comme les autres elements.
        */}
        <span className="rail-marque-texte" aria-hidden="true">
          DS
        </span>
        {/*
          UN SEUL trait sous « Tableau de bord ».

          Le separateur qui suivait cette marque a ete RETIRE : la marque porte
          deja son propre trait d'etat (`.rail-soulignement`, visible a l'etat
          courant et au survol), et le separateur venait s'empiler juste en
          dessous. Deux traits horizontaux identiques se lisaient alors comme un
          doublon, sans rien apporter.

          Le trait de section reste, lui, present sur les autres elements : c'est
          l'unique repere de survol et de section courante.
        */}
        <span className="rail-soulignement" aria-hidden="true" />
        {/*
          `aria-hidden` comme sur les autres elements du rail : le libelle est
          deja porte par l'`aria-label` du lien. Sans cela, un lecteur d'ecran
          annonçait « Tableau de bord » deux fois (une fois par l'etiquette,
          une fois par le texte visible).
        */}
        <span className="rail-libelle" aria-hidden="true">
          {t('navigation.tableauDeBord')}
        </span>
      </Link>

      <ul className="rail-liste">
        {ENTREES.map((entree) => (
          <li key={entree.href}>
            {/*
              `aria-current` est pose par le CSS via `:has()`/attribut : on le
              laisse ici au serveur/client React qui connait l'URL courante.
              On utilise le lien Next : la navigation reste cote client, donc
              instantanee, et le rail ne se demonte pas entre deux pages.
            */}
            <LienRail entree={entree} />
          </li>
        ))}
      </ul>

      <span className="rail-separateur" aria-hidden="true" />

      {/* ── Bascule clair / sombre ─────────────────────────────────────────── */}
      <button
        type="button"
        className="rail-item rail-bouton"
        onClick={basculerTheme}
        aria-label={enClair ? t('theme.modeSombre') : t('theme.modeClair')}
        title={enClair ? t('theme.modeSombre') : t('theme.modeClair')}
      >
        <Icone nom={enClair ? 'lune' : 'soleil'} className="rail-icone" />
        <span className="rail-soulignement" aria-hidden="true" />
        <span className="rail-libelle" aria-hidden="true">
          {enClair ? t('theme.modeSombre') : t('theme.modeClair')}
        </span>
      </button>

      {/* ── Deconnexion ────────────────────────────────────────────────────── */}
      <button
        type="button"
        className="rail-item rail-bouton"
        onClick={seDeconnecter}
        disabled={deconnexionEnCours}
        aria-label={t('navigation.deconnexion')}
        title={t('navigation.deconnexion')}
      >
        <Icone nom="deconnexion" className="rail-icone" />
        <span className="rail-libelle" aria-hidden="true">
          {t('navigation.deconnexion')}
        </span>
      </button>
    </nav>
  )
}

/**
 * Un lien du rail.
 *
 * Le composant est isole pour pouvoir lire l'URL courante (`usePathname`) sans
 * re-rendre tout le rail a chaque navigation : seule cette petite unite depend
 * du chemin.
 */
function LienRail({ entree }: { entree: EntreeRail }): React.JSX.Element {
  const chemin = usePathname()

  // Une section est active pour elle-meme ET pour ses sous-pages
  // (`/patients/123` garde « Patients » actif) : c'est ce qu'attend le medecin.
  const actif = chemin === entree.href || chemin.startsWith(`${entree.href}/`)

  return (
    <Link
      href={entree.href}
      className="rail-item"
      aria-current={actif ? 'page' : undefined}
      aria-label={entree.libelle}
      title={entree.libelle}
    >
      <Icone nom={entree.icone} className="rail-icone" />
      {/*
        Petit trait clair qui apparait sous l'icone au survol et au focus.
        C'est un element a part (et non une bordure) afin de pouvoir l'animer
        en opacite ET en largeur, sans deplacer l'icone.
      */}
      <span className="rail-soulignement" aria-hidden="true" />
      <span className="rail-libelle" aria-hidden="true">
        {entree.libelle}
      </span>
    </Link>
  )
}
