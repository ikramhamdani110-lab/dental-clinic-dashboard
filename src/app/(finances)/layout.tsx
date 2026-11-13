import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  FINANCE_SESSION_COOKIE_NAME,
  resoudreSessionFinanciere,
} from '@backend/auth/finance-session'

/**
 * =============================================================================
 *  MISE EN PAGE DU SITE FINANCIER PRIVÉ — APPLICATION SÉPARÉE
 * =============================================================================
 *
 *  PROTECTION SERVEUR, DENY BY DEFAULT :
 *
 *   Chaque page du site financier passe par cette mise en page, qui résout la
 *   session DÉDIÉE (`sahed_finance_session`) côté serveur. Sans session
 *   financière valide — y compris avec une session clinique valide — l'accès
 *   est refusé et l'utilisateur est redirigé vers la connexion financière.
 *
 *  COQUILLE D'APPLICATION :
 *
 *   Le site financier n'a NI barre de navigation NI pied de page : la page
 *   s'ouvre directement sur les trois boîtes. Il garde son propre thème
 *   (`--fn-*`), en mode clair uniquement. Rien n'est emprunté au secrétariat :
 *   ni la barre latérale, ni les en-têtes, ni les jetons de couleur du thème
 *   clinique.
 *
 *   ATTENTION : cette vérification protège le RENDU. Les DONNÉES sont protégées
 *   par `routeFinanciere` sur chaque route API : un appel direct sans session
 *   financière valide renvoie 401/403, quelle que soit la page.
 */
export default async function LayoutFinances({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const jeton = magasinCookies.get(FINANCE_SESSION_COOKIE_NAME)?.value
  const session = await resoudreSessionFinanciere(jeton)

  // Pas de session financière valide : retour à la connexion financière.
  // (La session reste vérifiée ici, côté serveur, même si plus rien de son
  // identité n'est affiché à l'écran.)
  if (!session) {
    redirect('/finances/connexion')
  }

  return (
    /*
     * THÈME PROPRE AU SITE FINANCIER : la coquille définit ses propres jetons
     * (`--fn-*`) dans `finances.css` et ne dépend pas du thème clinique. Elle
     * est TOUJOURS claire : aucun attribut `data-theme`, aucune bascule.
     *
     * L'attribut `data-theme="sombre"` hérité de `<html>` est explicitement
     * neutralisé : sans lui, certains styles sombres du thème clinique fuitent
     * sur des éléments du site financier (contraste dégradé de la carte
     * « DETTE » observé à l'audit). La racine `<html>` reste un domaine du
     * secrétariat ; cette coquille ne lui doit rien.
     */
    <div className="finances-coquille" data-theme="clair">
      <main className="finances-contenu">{children}</main>
    </div>
  )
}
