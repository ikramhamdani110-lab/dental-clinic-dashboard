// =============================================================================
//  LIVRAISON DE L'INSTALLATEUR — desktop/livrer.mjs
// =============================================================================
//  Place l'installateur produit par electron-builder à l'emplacement EXIGÉ :
//      dist/installer/Sahed-Dental-Clinic-Setup-x64.exe
//  et génère le rapport de diagnostic portable (journaux sans données patient).
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).version ?? '1.0.0'

const dossierDist = path.join(racine, 'desktop', 'dist')
const dossierLivrable = path.join(racine, 'dist', 'installer')
fs.mkdirSync(dossierLivrable, { recursive: true })

// 1. Trouver l'installateur produit.
const candidats = fs
  .readdirSync(dossierDist)
  .filter((f) => /^Sahed-Dental-Clinic-Setup-.*-x64\.exe$/i.test(f))
if (candidats.length === 0) {
  console.error('Aucun installateur trouvé dans', dossierDist)
  console.error('Exécutez d’abord : npm run desktop:build && npm run desktop:installer')
  process.exit(1)
}
const nom = candidats.sort().at(-1)
const source = path.join(dossierDist, nom)
const cible = path.join(dossierLivrable, 'Sahed-Dental-Clinic-Setup-x64.exe')
fs.copyFileSync(source, cible)
const tailleMo = (fs.statSync(cible).size / (1024 * 1024)).toFixed(1)
console.log(`Installateur livré : dist/installer/Sahed-Dental-Clinic-Setup-x64.exe (${tailleMo} Mo, version ${version})`)

// 2. Rapport de diagnostic portable (AUCUNE donnée patient : journaux de
//    démarrage et de sync seulement, jamais la base ni les documents).
const dossierRapport = path.join(racine, 'dist', 'diagnostic')
fs.rmSync(dossierRapport, { recursive: true, force: true })
fs.mkdirSync(dossierRapport, { recursive: true })
const appData = process.env.APPDATA ?? ''
const dossierDonnees = path.join(appData, 'Clinique Sahed')
const inclus = []
if (fs.existsSync(dossierDonnees)) {
  for (const nom2 of ['startup.log', 'sync-events.log']) {
    const f = path.join(dossierDonnees, nom2)
    if (fs.existsSync(f)) {
      // Les 500 dernières lignes seulement ; le journal de sync ne contient
      // jamais de payload ni de jeton (voir desktop/sync/log.mjs).
      const lignes = fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(-500)
      fs.writeFileSync(path.join(dossierRapport, nom2), lignes.join('\n'))
      inclus.push(nom2)
    }
  }
}
fs.writeFileSync(
  path.join(dossierRapport, 'README.txt'),
  [
    'RAPPORT DE DIAGNOSTIC — Clinique Sahed (application de bureau)',
    `Généré le : ${new Date().toISOString()}`,
    `Version de l'application : ${version}`,
    '',
    'Contenu : journaux de démarrage et de synchronisation (500 dernières lignes).',
    'AUCUNE donnée patient, aucun document, aucun secret n’est inclus.',
    'Transmettez ce dossier en cas de problème technique.',
  ].join('\n'),
)
console.log(`Rapport de diagnostic : dist/diagnostic/ (${inclus.length} journal(aux))`)
