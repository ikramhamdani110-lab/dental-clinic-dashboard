'use client'

/**
 * =============================================================================
 *  BARRIERE D'ERREUR GLOBALE (§33, §36)
 * =============================================================================
 *
 *  Dernier filet de securite : elle remplace la MISE EN PAGE RACINE lorsqu'une
 *  erreur empeche celle-ci de s'afficher. Elle doit donc fournir elle-meme
 *  `<html>` et `<body>`, et ne peut PAS dependre du contenu applicatif (qui a
 *  pu echouer) : le texte est ecrit en dur, en francais, sans aucun detail
 *  technique.
 *
  * Le corps est volontairement minimal : aucun secret, aucun chemin, aucune pile.
  *
  * ATTENTION — POURQUOI LES COULEURS SONT ECRITES ICI ET NULLE PART AILLEURS
  *
  * Cette barriere s'affiche PRECISEMENT quand la mise en page racine a echoue.
  * Elle ne peut donc pas compter sur la feuille de style de l'application pour
  * etre lisible : ses couleurs sont volontairement autonomes.
  *
  * Le theme n'est pas pour autant ignore : `data-theme` a ete pose sur `<html>`
  * par le script d'amorcage AVANT l'erreur, et il est relu ici pour choisir la
  * palette. L'ecran d'erreur reste donc coherent avec le mode choisi, tout en
  * restant lisible si l'attribut manque (on retombe alors sur le mode sombre,
  * qui est le defaut de l'application).
  */

 /** Palette autonome de l'ecran d'erreur, pour chacun des deux themes. */
 const PALETTES = {
   sombre: {
     fond: '#0e1727',
     texte: '#edf3fc',
     texteSecondaire: '#b3c4db',
     bordureBouton: '#3c5478',
     fondBouton: '#22344f',
   },
   clair: {
     fond: '#eff3f8',
     texte: '#152238',
     texteSecondaire: '#47586f',
     bordureBouton: '#bccbdd',
     fondBouton: '#ffffff',
   },
 } as const

 export default function ErreurGlobale({ reset }: { reset: () => void }): React.JSX.Element {
   /*
    * Le rendu serveur ne connait pas le theme : on part du mode sombre (defaut de
    * l'application). Au premier rendu client, l'attribut pose par le script
    * d'amorcage est lu directement sur `<html>` — sans `useState`, donc sans
    * risque de desynchronisation d'hydratation dans une barriere d'erreur, ou
    * toute complexite supplementaire serait un risque.
    */
   const theme =
     typeof document !== 'undefined' &&
     document.documentElement.getAttribute('data-theme') === 'clair'
       ? 'clair'
       : 'sombre'
   const palette = PALETTES[theme]

   return (
     <html lang="fr" data-theme={theme}>
       <body
         style={{
           margin: 0,
           minHeight: '100vh',
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'center',
           background: palette.fond,
           color: palette.texte,
           fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
         }}
       >
         <div style={{ maxWidth: 460, padding: 32, textAlign: 'center' }}>
           <h1 style={{ fontSize: 20, marginBottom: 12 }}>Une erreur est survenue</h1>
           <p style={{ fontSize: 15, lineHeight: 1.6, color: palette.texteSecondaire }}>
             L’application n’a pas pu s’afficher. Vos donnees sont intactes. Reessayez ; si le
             probleme persiste, contactez le support.
           </p>
           <button
             type="button"
             onClick={reset}
             style={{
               marginTop: 20,
               padding: '10px 20px',
               borderRadius: 8,
               border: `1px solid ${palette.bordureBouton}`,
               background: palette.fondBouton,
               color: palette.texte,
               fontSize: 15,
               cursor: 'pointer',
             }}
           >
             Reessayer
           </button>
         </div>
       </body>
     </html>
   )
 }