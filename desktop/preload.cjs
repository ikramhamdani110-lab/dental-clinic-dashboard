// =============================================================================
//  PRELOAD ELECTRON — desktop/preload.cjs
// =============================================================================
//  Expose un canal ÉTROIT et LECTURE SEULE à l'interface locale : l'état de
//  synchronisation et l'appairage. Aucun accès disque, aucun secret, aucune
//  API Node. contextIsolation reste active côté main.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sahedDesktop', {
  /** Vrai dans l'application de bureau, absent sur les sites web. */
  bureau: true,
  /** Dernier état de synchronisation connu. */
  etatSyncActuel: () => ipcRenderer.invoke('sahed:sync-etat-actuel'),
  /** Horodatage ISO de la dernière synchronisation réussie (ou null). */
  derniereSynchro: () => ipcRenderer.invoke('sahed:sync-derniere'),
  /** Compteurs de la file locale (pending, synchronisées, conflits, rejetées). */
  compteurs: () => ipcRenderer.invoke('sahed:sync-compteurs'),
  /** Appairage : URL HTTPS du serveur + jeton de session récupéré par la page de connexion. */
  configurerSync: (url, jetonSession) => ipcRenderer.invoke('sahed:sync-configurer', { url, jetonSession }),
  /** Force un cycle de synchronisation immédiat. */
  synchroniserMaintenant: () => ipcRenderer.invoke('sahed:sync-cycle'),
  /** Abonnement aux changements d'état poussés par le watcher. */
  surChangementEtat: (rappel) => {
    const ecouteur = (_event, etat) => rappel(etat)
    ipcRenderer.on('sahed:sync-etat', ecouteur)
    return () => ipcRenderer.removeListener('sahed:sync-etat', ecouteur)
  },
})
