import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  FINANCE_SESSION_COOKIE_NAME,
  resoudreSessionFinanciere,
} from '@backend/auth/finance-session'

/**
 * =============================================================================
 *  MISE EN PAGE DU SITE FINANCIER PRIVÉ (§finances, §securite) — v7
 * =============================================================================
 *
 *  PROTECTION SERVEUR, DENY BY DEFAULT :
 *
 *   Chaque page du site financier passe par cette mise en page, qui resout la
 *   session DEDIEE (`sahed_finance_session`) cote serveur. Sans session
 *   financiere valide — y compris avec une session clinique valide — l'acces
 *   est refuse et l'utilisateur est redirige vers la connexion financiere.
 *
 *   L'ANCIEN BANDEAU BLANC (identité + email) a été RETIRÉ (§finances-v7) :
 *   aucune barre d'identité ne le remplace. Le bouton « Déconnecter » vit
 *   désormais dans l'en-tête de la page (composant DeconnexionFinances).
 *
 *   ATTENTION : cette verification protege le RENDU. Les DONNEES sont protegees
 *   par `routeFinanciere` sur chaque route API : un appel direct sans session
 *   financiere valide renvoie 401/403, quelle que soit la page.
 */
export default async function LayoutFinances({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const jeton = magasinCookies.get(FINANCE_SESSION_COOKIE_NAME)?.value
  const session = await resoudreSessionFinanciere(jeton)

  // Pas de session financière valide : retour à la connexion financière.
  if (!session) {
    redirect('/finances/connexion')
  }

  return (
    /* THÈME PROPRE AU SITE FINANCIER : la coquille définit ses propres jetons
     * (`--fn-*`) dans `finances.css` et ne dépend pas du thème clinique. */
    <div className="finances-coquille">
      <main className="finances-contenu">{children}</main>
    </div>
  )
}
