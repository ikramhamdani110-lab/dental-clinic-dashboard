// =============================================================================
//  CONFIGURATION ELECTRON-BUILDER — INSTALLATEUR WINDOWS
// =============================================================================
//  Produit un installateur NSIS autonome : aucun Node.js, aucun PostgreSQL ni
//  outils de developpement requis chez l'utilisateur final. Les binaires
//  PostgreSQL embarques resident dans `resources/` (deja assembles par
//  desktop/prepare.mjs). Les donnees cliniques persistent dans AppData,
//  survive a la desinstallation.
// =============================================================================

const appId = 'dz.sahed.clinique'
const productName = 'Clinique Sahed'

/** @type {import('electron-builder').Configuration} */
const config = {
  appId,
  productName,
  directories: {
    output: 'desktop/dist',
    app: 'desktop/resources',
    buildResources: 'desktop/ico',
  },
  // Le dossier de l'application ne contient que main.mjs + package.json.
  // TOUT le runtime (Next standalone, node.exe, binaires PostgreSQL) passe par
  // extraResources : electron-builder le copie verbatim SANS re-collecter ni
  // elaguer les node_modules (cause du bug de demarrage apres installation).
  files: ['**/*'],
  // DEUX entrées : une copie de runtime complet, une seconde JUSTE pour
  // runtime/node_modules.electron-builder ignore les node_modules dans les
  // copies d'extraResources (comportement interne app-builder), donc sans cette
  // seconde entrée, embedded-postgres et les binaires PostgreSQL ne seraient
  // jamais emballés et l'application installée ne démarrerait pas.
  extraResources: [
    { from: 'desktop/runtime', to: 'runtime' },
    { from: 'desktop/runtime/node_modules', to: 'runtime/node_modules' },
  ],
  asar: false, // argon2 et les binaires postgres restent accessibles en clair.
  // Pas de rebuild natif pour Electron : les binaires embarques (argon2 du
  // runtime Next, PostgreSQL) tournent dans le node.exe independant, PAS dans
  // le processus Electron. Le rebuild @electron/rebuild plantait et tuait le
  // packaging sans message.
  npmRebuild: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'desktop/ico/icon.ico',
    // PAS de certificat de signature : l'application locale n'est pas signée
    // (avertissement SmartScreen documenté). Le « signAndEditExecutable » par
    // défaut reste actif : c'est LUI qui prépare l'exe pour charger
    // resources/app sans argument — sans lui, l'exe installé quittait
    // immédiatement sans fenêtre (bug observé).
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    artifactName: 'Clinique-Sahed-Setup-${version}.exe',
    shortcutName: productName,
    uninstallDisplayName: productName,
    deleteAppDataOnUninstall: false,
  },
  // Aucune mise a jour en ligne : l'application fonctionne hors ligne.
  publish: null,
}

module.exports = config
