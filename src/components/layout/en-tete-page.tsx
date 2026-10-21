'use client'

import { useT } from '@/components/langue/fournisseur-langue'

/**
 * =============================================================================
 *  EN-TETE DE PAGE (dans le flux du contenu, pas une bande pleine largeur)
 * =============================================================================
 *
 *  Contient le titre de la page et le nom du medecin connecte.
 *
 *  POURQUOI PAS LE TITRE DANS UNE BANDE GLOBALE ?
 *    L'ancienne mise en page reservait une bande horizontale pleine largeur a
 *    l'entete (menu + titre + theme + deconnexion). Le rail de navigation
 *    reprend desormais le menu, le theme et la deconnexion : il ne reste au
 *    niveau de la page que son titre, qui n'a aucune raison d'occuper toute la
 *    largeur. Le placer dans le flux du contenu libere de la hauteur et evite
 *    une bande vide sur les pages courtes.
 *
 *  AUCUN BOUTON D'ACTION ICI. Les actions appartiennent a la page concernee :
 *  la liste des patients porte deja son propre bouton « Nouveau patient » dans
 *  sa barre d'outils. En ajouter un second ici le dupliquerait a l'ecran.
 *
 *  Le nom du medecin reste affiche : c'est un repere utile en cabinet, ou
 *  plusieurs personnes peuvent utiliser le meme poste.
 */
/**
 * En-tete de page — CLIENT, pour que le titre suive la langue choisie.
 *
 * Si `cleTitre` est fournie, le titre est résolu au rendu dans la langue
 * active ; sinon, le `titre` (déjà traduit côté serveur) est affiché tel quel.
 */
export function EnTetePage({
  titre,
  cleTitre,
  utilisateur,
}: {
  titre?: string
  cleTitre?: string
  utilisateur: { nomAffichage: string; email: string }
}): React.JSX.Element {
  const t = useT()
  const affiche = cleTitre ? t(cleTitre) : titre

  return (
    <div className="en-tete-page">
      <div className="en-tete-page-identite">
        <h1 className="en-tete-page-titre">{affiche}</h1>
        <p className="en-tete-page-utilisateur">
          {utilisateur.nomAffichage}
          <span className="en-tete-page-role"> · {t('commun.medecin')}</span>
        </p>
      </div>
      {/*
        PAS de sélecteur de langue ici : le rail de navigation porte déjà
        l'unique bascule FR/AR de l'interface. Avoir un second contrôle dans
        l'en-tête dupliquait la même action à l'écran.
      */}
    </div>
  )
}
