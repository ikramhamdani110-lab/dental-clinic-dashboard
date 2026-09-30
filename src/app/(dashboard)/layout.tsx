import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, resolveSession } from '@backend/auth/session'
import { estRoleActif } from '@backend/auth/authorization'

import { FournisseurTableauBord } from '@/components/layout/fournisseur-tableau-bord'
import { RailNavigation } from '@/components/layout/rail-navigation'

/**
 * =============================================================================
 *  MISE EN PAGE DU TABLEAU DE BORD PRIVE (§4, §39)
 * =============================================================================
 *
 *  Cette mise en page verifie la session COTE SERVEUR avant de rendre quoi que
 *  ce soit. Un utilisateur non authentifie est redirige vers la connexion.
 *
 *  ATTENTION — la verification faite ici protege le RENDU, pas les DONNEES.
 *  Les donnees sont protegees par `routePrivee` sur chaque route API : un appel
 *  direct a l'API sans session valide est refuse, quelle que soit la page. Les
 *  deux barrieres sont necessaires et complementaires (§39).
 *
 *  POURQUOI LE RAIL DE NAVIGATION EST RENDU ICI, ET NON DANS CHAQUE PAGE
 *
 *  Une mise en page (`layout`) PERSISTE d'une page a l'autre dans l'App Router :
 *  Next.js ne la remonte pas lors d'une navigation entre deux pages du meme
 *  groupe. Rendre le rail ici garantit donc qu'il survit a chaque navigation.
 *
 *  C'est indispensable, et pas seulement pour la performance : lorsque le rail
 *  etait rendu par la PAGE (via `PagePrivee`), il etait demonte puis remonte a
 *  chaque deplacement. Un clic sur une icone tombant pendant ce demontage etait
 *  perdu ou rattache a l'ancien arbre, et le medecin se retrouvait sur la page
 *  precedente. Le symptome etait trompeur : les liens etaient corrects, la cause
 *  etait leur remontage.
 *
 *  Le TITRE de la page reste fourni par la page elle-meme (`PagePrivee`), car
 *  lui seul depend de la page affichee.
 */
export default async function LayoutTableauBord({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const jeton = magasinCookies.get(SESSION_COOKIE_NAME)?.value
  const session = await resolveSession(jeton)

  // Pas de session valide : retour a la connexion. Le chemin de destination
  // n'est PAS transmis (il pourrait reveler l'existence d'une page).
  if (!session || !estRoleActif(session.user.role)) {
    redirect('/connexion')
  }

  return (
    <FournisseurTableauBord
      utilisateur={{
        nomAffichage: session.user.displayName,
        email: session.user.email,
      }}
    >
      <div className="coquille">
        {/* Lien d'evitement : atteindre le contenu au clavier sans parcourir
            toute la navigation (§50, accessibilite). */}
        <a href="#contenu-principal" className="lien-evitement">
          Aller au contenu principal
        </a>

        <RailNavigation />

        <main className="contenu-principal" id="contenu-principal" tabIndex={-1}>
          {children}
        </main>
      </div>
    </FournisseurTableauBord>
  )
}
