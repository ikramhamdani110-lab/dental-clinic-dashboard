import type { Metadata } from 'next'

import { t } from '@content/index'

import { FormulaireConnexion } from '@/components/auth/formulaire-connexion'

/**
 * Page de connexion (§6).
 *
 * Accessible a tout le monde (c'est la porte d'entree), mais SEUL le compte
 * medecin existe (§2) : aucun portail patient, aucune inscription.
 *
 * La page est `noindex` : un moteur de recherche ne doit pas la proposer.
 *
 * ── COMPOSITION ──────────────────────────────────────────────────────────────
 * Le formulaire est dans une carte — une surface claire, aux coins legerement
 * arrondis, posee sur une ombre bleu bebe diffuse qui la fait flotter. Ce n'est
 * ni une carte SaaS (pas de bordure marquee, pas de verre) ni une simple boite
 * : la profondeur vient de l'ombre et de l'espace, pas d'un contour.
 *
 * L'atmosphere derriere reste tres discrete et n'intercepte aucun clic.
 */
export const metadata: Metadata = {
  title: t('auth.titreConnexion'),
  robots: { index: false, follow: false },
}

export default function PageConnexion(): React.JSX.Element {
  return (
    <main className="page-connexion">
      {/* Atmosphere : deux nappes tres floutees, tres basse opacite, immobiles. */}
      <div className="connexion-atmosphere" aria-hidden="true">
        <span className="connexion-lueur connexion-lueur--haute" />
        <span className="connexion-lueur connexion-lueur--basse" />
      </div>

      <div className="connexion-carte">
        <h1 className="connexion-titre">{t('auth.titreConnexion')}</h1>

        <FormulaireConnexion />
      </div>
    </main>
  )
}
