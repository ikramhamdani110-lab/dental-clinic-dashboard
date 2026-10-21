// =============================================================================
//  LANCEUR DE BUREAU EN MODE DEVELOPPEMENT
// =============================================================================
//  Demarre Electron pointant sur le build autonome deja produit par
//  `npm run desktop:build`. A utiliser pour tester le shell sans reinstall.
// =============================================================================

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const env = {
  ...process.env,
  DESKTOP_DEV: '1',
  ELECTRON_FORCE_IS_PACKAGED: undefined,
}
// En mode dev, resources = racine du projet (main.mjs y trouve tout).
const electron = path.join(racine, 'node_modules', 'electron', 'cli.js')
const enfant = spawn(process.execPath, [electron, path.join(racine, 'desktop', 'main.mjs')], {
  env,
  stdio: 'inherit',
})
enfant.on('exit', (code) => process.exit(code ?? 0))
