// =============================================================================
//  EXPORT CHIFFRE DES DONNEES NON SYNCHRONISEES — desktop/sync/export.mjs
// =============================================================================
//  La file locale est chiffree AES-256-GCM. La cle est DERIVEE de la phrase
//  de recuperation via PBKDF2 (600 000 iterations) — elle n'est JAMAIS
//  stockee sur disque. Sans la phrase, l'export est inexploitable.
//
//  La phrase est affichee UNE SEULE FOIS a l'appairage (voir l'API
//  /api/sync/appareils). L'utilisateur la conserve hors du poste (papier ou
//  gestionnaire de mots de passe personnel).
// =============================================================================

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ITERATIONS_PBKDF2 = 600_000

function deriverCle(phrase, selHex) {
  return crypto.pbkdf2Sync(phrase, Buffer.from(selHex, 'hex'), ITERATIONS_PBKDF2, 32, 'sha256')
}

/**
 * Ecrit un export chiffre du contenu de la file (operations non synchronisees).
 * Le sel est inclus EN CLAIR dans le fichier (il n'est pas un secret) ; la
 * phrase, elle, ne quitte jamais l'utilisateur.
 */
export async function exporterFile({ dossierDonnees, phrase, contenu }) {
  const sel = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cle = deriverCle(phrase, sel.toString('hex'))

  const chiffreur = crypto.createCipheriv('aes-256-gcm', cle, iv)
  const donnees = Buffer.concat([
    chiffreur.update(Buffer.from(JSON.stringify(contenu), 'utf8')),
    chiffreur.final(),
  ])
  const tag = chiffreur.getAuthTag()

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fichier = path.join(dossierDonnees, 'sync-backup', `export-${horodatage}.syncbak`)
  fs.mkdirSync(path.dirname(fichier), { recursive: true })

  // Format : [sel(16) | iv(12) | tag(16) | donnees]
  fs.writeFileSync(fichier, Buffer.concat([sel, iv, tag, donnees]))
  return fichier
}

/**
 * Reimporte un export chiffre (apres reinstallation de Windows ou changement
 * de poste). La phrase est fournie par l'utilisateur ; le sel est relu du
 * fichier lui-meme. Sans la bonne phrase, le decifratement echoue (tag GCM
 * invalide) — aucune donnée n'est corrompue.
 */
export async function importerFile({ fichier, phrase }) {
  const brut = fs.readFileSync(fichier)
  const sel = brut.subarray(0, 16)
  const iv = brut.subarray(16, 28)
  const tag = brut.subarray(28, 44)
  const donnees = brut.subarray(44)

  const cle = deriverCle(phrase, sel.toString('hex'))
  const dechiffreur = crypto.createDecipheriv('aes-256-gcm', cle, iv)
  dechiffreur.setAuthTag(tag)

  const clair = Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()])
  return JSON.parse(clair.toString('utf8'))
}
