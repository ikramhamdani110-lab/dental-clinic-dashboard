/**
 * =============================================================================
 *  MISE EN PAGE PUBLIQUE — PAGE DE CONNEXION FINANCIERE
 * =============================================================================
 *
 *  Cette mise en page n'est PAS protegee : elle encapsule uniquement la page de
 *  connexion, qui est la porte d'entree du site financier. Elle est isolee du
 *  groupe `(finances)` pour eviter la boucle de redirection : sans elle, la
 *  mise en page protegee renvoyait vers `/finances/connexion`... qui vivait
 *  DANS le groupe protege, donc se renvoyait vers elle-meme.
 *
 *  La page de connexion reste `noindex` et ne reference jamais l'application
 *  clinique. La vraie protection des donnees reste dans `(finances)/layout.tsx`
 *  et `routeFinanciere` sur chaque API.
 */
export default function LayoutConnexionPublique({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <>{children}</>
}
