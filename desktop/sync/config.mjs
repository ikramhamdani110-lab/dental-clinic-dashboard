// =============================================================================
//  CONFIGURATION DE SYNCHRONISATION DU POSTE — desktop/sync/config.mjs
// =============================================================================
//  L'URL du serveur en ligne et les identifiants d'appareil sont stockes dans
//  la BASE LOCALE (table sync_config) — jamais dans l'installateur, jamais en
//  clair dans un fichier. Le jeton d'appareil est chiffre par DPAPI (Windows)
//  dans un fichier de la zone AppData.
//
//  AUCUN secret production n'est embarque dans l'application : la premiere
//  configuration passe par l'appairage interactif (voir appairage.mjs).
// =============================================================================

import path from 'node:path'
import fs from 'node:fs'

const dossierStandalone = process.env.DESKTOP_SEED_STANDALONE
  ?? path.resolve(process.env.APP_ROOT ?? '.', 'standalone')
const { PrismaClient } = await import(
  'file:///' + path.join(dossierStandalone, 'node_modules', '@prisma', 'client', 'default.js').replace(/\\/g, '/')
)
const prisma = new PrismaClient()

/** Cle DPAPI de la zone utilisateur (CryptProtectData). */
async function proteger(chaine) {
  // L'appel DPAPI passe par PowerShell (aucune dependance binaire additionnelle).
  // Entree : base64(UTF8(chaine)) ; sortie : base64(blob DPAPI).
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileP = promisify(execFile)
  const script = [
    "$entree = [Convert]::FromBase64String($env:SAHED_ENTREE);",
    "$blob = [System.Security.Cryptography.ProtectedData]::Protect($entree, $null, 'CurrentUser');",
    "[Convert]::ToBase64String($blob)",
  ].join(' ')
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, SAHED_ENTREE: Buffer.from(chaine, 'utf8').toString('base64') } },
  )
  return String(stdout).trim()
}

/** Dechiffre un blob DPAPI (base64) — retourne la chaine originale. */
async function deproteger(base64) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileP = promisify(execFile)
  const script = [
    "$blob = [Convert]::FromBase64String($env:SAHED_ENTREE);",
    "$clair = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser');",
    "[Convert]::ToBase64String($clair)",
  ].join(' ')
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, SAHED_ENTREE: base64 } },
  )
  return Buffer.from(String(stdout).trim(), 'base64').toString('utf8')
}

/** URL du serveur en ligne (HTTPS obligatoire hors dev). */
export async function obtenirUrlServeur() {
  const ligne = await prisma.syncConfig.findUnique({ where: { cle: 'serveurUrl' } })
  return ligne?.valeur ?? null
}

export async function definirUrlServeur(url) {
  const analyse = new URL(url)
  if (analyse.protocol !== 'https:' && analyse.hostname !== '127.0.0.1' && analyse.hostname !== 'localhost') {
    throw new Error('L’URL de synchronisation doit être en HTTPS (sauf test local).')
  }
  await prisma.syncConfig.upsert({
    where: { cle: 'serveurUrl' },
    create: { cle: 'serveurUrl', valeur: url },
    update: { valeur: url },
  })
}

/** Appareil appaire : { deviceId, jeton } ou null si pas encore appaire. */
export async function obtenirAppareil() {
  const id = await prisma.syncConfig.findUnique({ where: { cle: 'deviceId' } })
  const jeton = await prisma.syncConfig.findUnique({ where: { cle: 'jetonAppareil' } })
  if (!id?.valeur || !jeton?.valeur) return null
  try {
    return { deviceId: id.valeur, jeton: await deproteger(jeton.valeur) }
  } catch {
    // DPAPI échoue si le profil Windows change : le jeton est perdu, la
    // synchronisation doit repasser par un nouvel appairage. JAMAIS de crash.
    return null
  }
}

export async function definirAppareil(deviceId, jeton) {
  await prisma.syncConfig.upsert({
    where: { cle: 'deviceId' },
    create: { cle: 'deviceId', valeur: deviceId },
    update: { valeur: deviceId },
  })
  const chiffre = await proteger(jeton)
  await prisma.syncConfig.upsert({
    where: { cle: 'jetonAppareil' },
    create: { cle: 'jetonAppareil', valeur: chiffre },
    update: { valeur: chiffre },
  })
}

/** Horodatage de la dernière synchronisation réussie (affichage UI). */
export async function marquerDerniereSynchro(iso) {
  await prisma.syncConfig.upsert({
    where: { cle: 'derniereSynchro' },
    create: { cle: 'derniereSynchro', valeur: iso },
    update: { valeur: iso },
  })
}

export async function obtenirDerniereSynchro() {
  const ligne = await prisma.syncConfig.findUnique({ where: { cle: 'derniereSynchro' } })
  return ligne?.valeur ?? null
}

export async function fermerConfig() {
  await prisma.$disconnect()
}
