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
  files: ['**/*'],
  asar: false, // argon2 et les binaires postgres restent accessibles en clair.
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'desktop/ico/icon.ico',
    // Pas de certificat de signature : l'application locale n'est pas signée.
    // Windows affichera l'avertissement standard SmartScreen au premier
    // lancement (application non reconnue) — c'est documenté dans le guide.
    signAndEditExecutable: false,
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
