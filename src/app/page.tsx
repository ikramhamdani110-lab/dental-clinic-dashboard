import { redirect } from 'next/navigation'

/**
 * La racine du site n'expose AUCUNE page publique.
 *
 * L'application est un espace prive reserve au medecin : la racine renvoie donc
 * directement vers le tableau de bord. Le middleware se charge de rediriger vers
 * la page de connexion toute personne non authentifiee, avant meme d'atteindre
 * le tableau de bord.
 */
export default function Racine(): never {
  redirect('/tableau-de-bord')
}