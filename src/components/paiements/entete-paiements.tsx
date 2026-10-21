'use client'

import { useT } from '@/components/langue/fournisseur-langue'
import { LienBouton } from '@/components/ui/bouton'

/**
 * Barre d'entête de la page Paiements — CLIENT.
 *
 * Les pages sont rendues par des composants SERVEUR, où `t()` est figé en
 * français. Pour que la langue bascule sans rechargement, cette barre résout
 * ses libellés au rendu, côté client, comme `EnTetePage` le fait pour le titre.
 */
export function EntetePaiements(): React.JSX.Element {
  const t = useT()
  return (
    <div className="entete-page">
      <div className="entete-page-haut">
        <div>
          <h2 className="entete-page-titre">{t('paiements.titre')}</h2>
          <p className="entete-page-sous-titre">{t('paiements.sousTitre')}</p>
        </div>
        <LienBouton href="/paiements/nouveau" variante="principal">
          {t('paiements.nouveau')}
        </LienBouton>
      </div>
    </div>
  )
}
