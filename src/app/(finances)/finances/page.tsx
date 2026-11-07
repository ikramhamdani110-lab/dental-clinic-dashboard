import type { Metadata } from 'next'

import { TableauBordFinancier } from '@/components/finances/tableau-de-bord'

/**
 * Page d'accueil du site financier privé — accès réservé au médecin.
 *
 * Ce n'est PAS la page Rapports du secrétariat : c'est l'application financière
 * du médecin, avec sa propre navigation, ses propres connexion et session, et
 * ses propres routes API (`routeFinanciere`).
 *
 * La protection est faite par la mise en page du groupe `(finances)` : sans
 * session financière dédiée valide, l'utilisateur est redirigé vers
 * `/finances/connexion` AVANT que cette page ne soit rendue.
 */
export const metadata: Metadata = {
  title: 'Tableau de bord financier — Finances privées',
  robots: { index: false, follow: false },
}

export default function PageFinances(): React.JSX.Element {
  return <TableauBordFinancier />
}
