import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { t } from '@content/index'
import { SESSION_COOKIE_NAME } from '@backend/auth/session'
import { DonneesTableauBord } from '@/components/dashboard/donnees-tableau-bord'
import { SalutationTableauBord } from '@/components/dashboard/salutation'

/**
 * ACCUEIL DU TABLEAU DE BORD (§25).
 *
 * Premier ecran du medecin. Il repond a « Qu'est-ce qui est important
 * aujourd'hui ? » : rendez-vous, patients attendus, traitements en cours,
 * revenus et montants restants.
 *
 * L'EN-TETE GENERIQUE A ETE RETIRE ICI.
 *  L'ancien en-tete empilait trois lignes (« Tableau de bord », l'identite du
 *  compte, puis « Qu'est-ce qui est important aujourd'hui ? »). Il est remplace
 *  par une seule salutation, « Bonjour Dr Sahed », qui accueille le medecin sans
 *  repeter le nom de la page ni poser une question rhetorique.
 *
 *  Cette page ne passe donc PAS par `PagePrivee` : elle n'a plus de titre a
 *  afficher, et c'est precisement ce qui supprime l'en-tete. L'authentification
 *  reste assuree par la mise en page du groupe `(dashboard)`, qui enveloppe
 *  toutes les pages privees — la protection est inchangee.
 */
export const metadata: Metadata = {
  title: t('tableauDeBord.titre'),
  robots: { index: false, follow: false },
}

export default async function PageTableauDeBord(): Promise<React.JSX.Element> {
  /*
   * IDENTIFIANT DE SESSION, TRANSMIS A LA SALUTATION.
   *
   * Le cookie de session est `HttpOnly` : le composant client ne peut pas le
   * lire, et ne peut donc pas savoir seule qu'une NOUVELLE connexion a eu lieu.
   * La lecture se fait ici, cote serveur, et seule l'identifiant est transmis.
   *
   * Ce n'est pas une donnee sensible : l'identifiant de session ne donne aucun
   * acces par lui-meme (le cookie reste `HttpOnly` + `Secure`), et il n'est de
   * toute facon pas affiche a l'ecran.
   */
  const magasinCookies = await cookies()
  const sessionId = magasinCookies.get(SESSION_COOKIE_NAME)?.value ?? null

  return (
    <>
      <SalutationTableauBord texte={t('tableauDeBord.salutation')} sessionId={sessionId} />
      <DonneesTableauBord />
    </>
  )
}
