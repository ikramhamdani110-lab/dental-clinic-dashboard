import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'

import { contenu } from '@content/index'

import './globals.css'

/**
 * =============================================================================
 *  TYPOGRAPHIE
 * =============================================================================
 *
 *  L'application entiere est composee en BOOK ANTIQUA, la salutation du tableau
 *  de bord mise a part.
 *
 *  BOOK ANTIQUA n'est PAS dans le catalogue Google Fonts : `next/font` ne peut
 *  donc pas la rapatrier. Elle n'est pas non plus auto-hebergee : un fichier
 *  `woff2` avait ete produit, mais le navigateur le REJETAIT (« Failed to convert
 *  WOFF 2.0 font to SFNT »). Or la fonte est installee sur les postes Windows, ou
 *  le navigateur la resout directement.
 *
 *  Aucune declaration ni prechargement de police n'est donc necessaire ici : les
 *  jetons `--police-*` de `theme.css` suffisent, et ils prevoient un repli
 *  metriquement proche (Palatino) pour les postes qui n'ont pas Book Antiqua.
 *
 *  La salutation « Bonjour Dr Sahed » est une exception : elle est composee dans
 *  une cursive classique, citee par le jeton `--police-salutation` parmi des
 *  fontes reellement presentes sur le poste.
 */

/**
 * Mise en page racine.
 *
 * `suppressHydrationWarning` est necessaire sur `<html>` : le script de theme
 * ci-dessous ecrit `data-theme` avant l'hydratation, ce qui est le comportement
 * voulu (eviter le « flash » de theme au chargement).
 */
export const metadata: Metadata = {
  title: {
    default: contenu.meta.titreApplication,
    template: `%s — ${contenu.meta.nomApplication}`,
  },
  description: contenu.meta.descriptionApplication,
  applicationName: contenu.meta.nomApplication,
  robots: { index: false, follow: false },
  formatDetection: { telephone: true, email: true, address: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * Couleur de la barre systeme (mobile), alignee sur `--fond-page` de chaque
   * theme. Ces valeurs sont les seules couleurs du projet qui ne peuvent pas
   * venir d'un jeton CSS : le navigateur les lit AVANT que la feuille de style
   * ne soit appliquee. Elles doivent donc rester synchronisees avec `theme.css`.
   */
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1727' },
    { media: '(prefers-color-scheme: light)', color: '#eff3f8' },
  ],
}

/**
 * Script de theme execute AVANT le premier rendu.
 *
 * Sans lui, la page s'afficherait avec le theme par defaut puis basculerait,
 * produisant un flash desagreable — particulierement genant sur un poste de
 * travail clinique. Le script lit la preference enregistree, sinon la
 * preference systeme. Il est volontairement minuscule et sans dependance.
 */
const scriptTheme = `
(function () {
  try {
    var cle = 'sahed-theme';
    var enregistre = localStorage.getItem(cle);
    var theme = enregistre === 'clair' || enregistre === 'sombre'
      ? enregistre
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'sombre');
  }
})();
`

/**
 * Lit le nonce CSP de la requete courante.
 *
 * Le middleware genere un nonce par reponse et le depose dans l'en-tete de
 * REQUETE `x-nonce` (via `NextResponse.next({ request: { headers } })`). Appeler
 * `headers()` ici, dans un composant serveur, rend le rendu dynamique pour cette
 * requete et permet donc de lire le nonce.
 *
 * SANS ce report, les scripts inline de Next.js (amorcage du routeur, donnees de
 * vol) ne portent aucun `nonce` : le navigateur les bloque, React ne s'hydrate
 * jamais, et la page reste un simple instantane HTML inerte (§38).
 *
 * ATTENTION — POURQUOI L'ATTRIBUT `nonce` EST ECRIT EN CHAINE BRUTE
 *
 * Le navigateur VIDE l'attribut `nonce` des elements `<script>` juste apres les
 * avoir analyses (protection contre l'exfiltration par selecteurs CSS) : la
 * valeur ne survit que dans la propriete interne `element.nonce`. React, en
 * revanche, compare l'attribut qu'il avait rendu (`nonce="..."`) a celui qu'il
 * trouve dans le DOM (`nonce=""`), conclut a une divergence d'hydratation et
 * RE-REND tout le `<head>`.
 *
 * Ce re-rendu n'est pas cosmetique : pendant les quelques centaines de
 * millisecondes qu'il dure, les formulaires sont presents a l'ecran mais leurs
 * gestionnaires ne sont pas attaches. Un clic sur « Se connecter » est alors
 * traite par le NAVIGATEUR (soumission HTML native), donc sans `onSubmit`,
 * donc sans appel a `/api/auth/login` : la connexion echoue silencieusement.
 *
 * `suppressHydrationWarning` est donc place SUR le `<script>` lui-meme, et non
 * sur `<html>` : la divergence d'attribut est toleree, React ne re-rend plus le
 * `<head>`, et le formulaire devient utilisable des le premier rendu.
 *
 * Le nonce reste integralement applique : React ecrit bien l'attribut dans le
 * HTML rendu par le serveur, et la CSP le lit a l'analyse. Seule la
 * RECONCILIATION cote client de cet attribut est desactivee.
 */
async function lireNonce(): Promise<string | undefined> {
  const entetes = await headers()
  return entetes.get('x-nonce') ?? undefined
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const nonce = await lireNonce()

  return (
    <html lang="fr" data-theme="sombre" suppressHydrationWarning>
      <head>
        {/*
          Script bloquant volontaire : il doit s'executer avant la peinture.
          Il porte le nonce de la requete, sans quoi la CSP le bloquerait.

          `nonce` est transmis tel quel : le navigateur le videra lui-meme dans
          le DOM, ce qui est NORMAL. `suppressHydrationWarning` evite que React
          ne re-rende le <head> a cause de ce vidage inevitable.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: scriptTheme }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
