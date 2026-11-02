// =============================================================================
//  JOURNAL DE SYNCHRONISATION LOCALE — desktop/sync/log.mjs
// =============================================================================
//  Trace horodatee dans AppData/clinique/sync-events.log. Aucune donnee
//  sensible (jamais de payload, jamais de jeton, jamais de phrase de
//  recuperation).
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'

const FICHIER = () =>
  path.join(process.env.DESKTOP_DATA_DIR ?? '.', 'sync-events.log')

export function journalSync(evenement, detail = '') {
  const ligne = `[${new Date().toISOString()}] ${evenement}${detail ? ' — ' + detail : ''}\n`
  try {
    fs.mkdirSync(path.dirname(FICHIER()), { recursive: true })
    fs.appendFileSync(FICHIER(), ligne, 'utf8')
  } catch {
    // Le journal ne doit JAMAIS faire echouer la synchronisation.
  }
}

export function lireJournalSync(lignes = 100) {
  try {
    const contenu = fs.readFileSync(FICHIER(), 'utf8')
    return contenu.split(/\r?\n/).filter(Boolean).slice(-lignes)
  } catch {
    return []
  }
}
