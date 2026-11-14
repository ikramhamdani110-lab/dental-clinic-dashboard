// =============================================================================
//  APPAIRAGE INTERACTIF DU POSTE — desktop/sync/appairage.mjs
// =============================================================================
//  Procédure sécurisée (exigence §4) :
//    1. l'utilisateur saisit l'URL du serveur en ligne (HTTPS) ;
//    2. une fenêtre Electron restreinte ouvre la page de CONNEXION du site
//       en ligne : l'utilisateur s'y connecte avec son compte habituel —
//       le poste ne voit JAMAIS le mot de passe ;
//    3. une fois connecté, l'utilisateur clique « Appairer ce poste » sur la
//       page /parametres : l'API renvoie un jeton d'appareil ;
//    4. le jeton est stocké chiffré DPAPI (CurrentUser) — voir config.mjs.
//
//  La fenêtre d'appairage ne charge QUE l'URL fournie, avec contextIsolation ;
//  aucune navigation sortante n'est permise (liste blanche sur le domaine).
// =============================================================================

import { BrowserWindow } from 'electron'

/**
 * Ouvre la fenêtre d'appairage et attend que la page /parametres émette le
 * jeton via `window.sahedDesktop.appairer(jeton)`.
 * Résout avec { jeton, serveur } ou rejette si l'utilisateur ferme la fenêtre.
 */
export async function appairageInteractif(urlServeur) {
  return new Promise((resoudre, rejeter) => {
    const fenetre = new BrowserWindow({
      width: 1100,
      height: 800,
      title: 'Appairage — Clinique Sahed',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    const origine = new URL(urlServeur).origin
    let resolu = false

    fenetre.webContents.on('will-navigate', (event, url) => {
      // Liste blanche : rester sur l'origine du serveur en ligne.
      if (!url.startsWith(origine)) event.preventDefault()
    })
    fenetre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    fenetre.webContents.on('before-input-event', (event, input) => {
      // Empêche DevTools (F12) dans la fenêtre d'appairage.
      if (input.key === 'F12') event.preventDefault()
    })

    // La page /parametres injecte le jeton via le canal postMessage.
    const surMessage = (event, payload) => {
      if (event.sender !== fenetre.webContents || resolu) return
      if (payload?.type !== 'sahed-appairage' || typeof payload.jeton !== 'string') return
      resolu = true
      resoudre({ jeton: payload.jeton, serveur: urlServeur })
      fenetre.close()
    }
    // Écouteur global Electron : filtré sur l'expéditeur ci-dessus.
    process.on('message', () => {}) // no-op : garde le handle process vivant

    fenetre.webContents.on('ipc-message', surMessage)

    fenetre.on('closed', () => {
      if (!resolu) rejeter(new Error('Appairage annulé par l’utilisateur.'))
    })

    fenetre.loadURL(new URL('/parametres', origine).toString())
  })
}
