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
 *
 * ── TOUJOURS EN MODE SOMBRE ───────────────────────────────────────────────────
 * Cette page est TOUJOURS rendue en theme sombre, quelle que soit la preference
 * enregistree du medecin ou celle du systeme. On ne joue pas avec `localStorage`
 * ni avec un script : l'attribut `data-theme="sombre"` est pose sur le `<main>`
 * DE CETTE PAGE, dans le HTML rendu par le serveur, donc des le premier octet.
 *
 * Trois raisons a cette isolation :
 *
 *   - aucun FLASH : la feuille de style porte le theme sombre des le premier
 *     rendu, la page n'apparait donc jamais claire avant de basculer ;
 *   - aucun effet de bord : `<html>` n'est pas touche. Le `ThemeProvider` du
 *     tableau de bord continue de lire et d'ecrire `data-theme` sur la racine, et
 *     la bascule clair / sombre y fonctionne exactement comme avant ;
 *   - le retour sur `/connexion` apres deconnexion retrouve la page sombre, quel
 *     que soit le theme choisi dans l'application.
 *
 * Les jetons utilises (`--fond-page`, `--accent`, `--texte-principal`…) sont
 * ceux du theme sombre deja definis dans `theme.css` : la page ne duplique
 * aucune couleur, elle reutilise la palette existante.
 */
export const metadata: Metadata = {
  title: t('auth.titreConnexion'),
  robots: { index: false, follow: false },
}

export default function PageConnexion(): React.JSX.Element {
  return (
    <main className="page-connexion" data-theme="sombre">
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
