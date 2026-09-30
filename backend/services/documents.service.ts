import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

import { fileTypeFromBuffer } from 'file-type'

import { getEnv } from '@backend/config/env'
import { prisma } from '@backend/database/prisma'
import {
  ALLOWED_DOCUMENT_MIME_SET,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { logger } from '@backend/logging/logger'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE DOCUMENTS (§22)
 * =============================================================================
 *
 *  PRINCIPES DE SECURITE
 *
 *  1. STOCKAGE PRIVE : les fichiers sont ecrits HORS de la racine web
 *     (`DOCUMENTS_STORAGE_PATH`). Ils ne sont jamais servis par un serveur de
 *     fichiers statique : une URL devinee ne donne acces a rien.
 *
 *  2. CONTROLE DU TYPE REEL : l'extension et l'en-tete `Content-Type` fournis
 *     par le client sont FALSIFIABLES. La verification porte sur la SIGNATURE
 *     BINAIRE du contenu (`file-type`), seule fiable.
 *
 *  3. NOM DE FICHIER SANS RISQUE : le nom d'origine est conserve pour
 *     l'AFFICHAGE uniquement ; le nom sur disque est un UUID plus une extension
 *     maitrisee. Aucune donnee du client n'entre dans un chemin de fichier.
 *
 *  4. PROTECTION CONTRE LE PATH TRAVERSAL : le chemin de stockage est toujours
 *     construit a partir d'un identifiant genere, jamais d'une entree utilisateur.
 *     Une verification supplementaire s'assure que le chemin resolu reste dans
 *     le repertoire racine.
 *
 *  5. LIMITE DE TAILLE : appliquee cote serveur, avant et pendant l'ecriture.
 *
 *  6. AUCUN PDF N'EST GENERE (§45). Un PDF deja existant peut etre televerse
 *     s'il est cliniquement necessaire (ex. un compte rendu externe).
 */

/** Repartoire racine du stockage, resolu depuis l'environnement. */
function racineStockage(): string {
  const env = getEnv()
  if (!env.DOCUMENTS_STORAGE_PATH) {
    throw new Error(
      'DOCUMENTS_STORAGE_PATH n’est pas configure. Le stockage des documents est obligatoire.',
    )
  }
  return normalize(env.DOCUMENTS_STORAGE_PATH)
}

/**
 * Verifie qu'un chemin resolu reste bien dans la racine de stockage.
 * Defense en profondeur contre le path traversal, independamment de la facon
 * dont le chemin a ete construit.
 */
function verifierCheminSur(cheminComplet: string): void {
  const racine = racineStockage()
  const resolu = normalize(cheminComplet)
  if (!resolu.startsWith(racine + sep) && resolu !== racine) {
    throw erreurs.fichierInvalide('Chemin de stockage invalide.')
  }
}

/** Nom du fichier sur disque : UUID + extension maitrisee. Aucune donnee client. */
function nomSurDisque(id: string, extension: string): string {
  return `${id}${extension}`
}

/** Extensions autorisees, associees aux types MIME reconnus. */
const EXTENSION_PAR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
}

export interface ResultatTeleversement {
  id: string
  nomOriginal: string
}

/**
 * Enregistre un document televerse.
 * Le fichier est ecrit sur disque AVANT la ligne en base : si la base echoue,
 * le fichier orphelin est supprime (nettoyage).
 */
export async function televerserDocument(
  donnees: {
    patientId: string
    fichier: File
    categorie: string | null
    description: string | null
  },
  contexte: JournalContext,
): Promise<ResultatTeleversement> {
  const env = getEnv()
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  // ── 1. Controle de taille AVANT lecture du contenu ──────────────────────────
  if (donnees.fichier.size <= 0) {
    throw erreurs.fichierInvalide('Le fichier est vide.')
  }
  if (donnees.fichier.size > env.DOCUMENTS_MAX_BYTES) {
    throw erreurs.fichierTropVolumineux(Math.floor(env.DOCUMENTS_MAX_BYTES / (1024 * 1024)))
  }

  // ── 2. Lecture en memoire puis controle de la signature reelle ──────────────
  const contenu = Buffer.from(await donnees.fichier.arrayBuffer())

  // Recontrole apres lecture : la taille annoncee par le client est indicatif,
  // seul le contenu recu fait foi.
  if (contenu.length > env.DOCUMENTS_MAX_BYTES) {
    throw erreurs.fichierTropVolumineux(Math.floor(env.DOCUMENTS_MAX_BYTES / (1024 * 1024)))
  }

  const typeDetecte = await fileTypeFromBuffer(contenu)
  if (!typeDetecte || !ALLOWED_DOCUMENT_MIME_SET.has(typeDetecte.mime)) {
    throw erreurs.fichierInvalide(
      'Ce type de fichier n’est pas autorise. Formats acceptes : JPEG, PNG, WebP, GIF, TIFF, BMP et PDF.',
    )
  }

  // ── 3. Nom sur disque genere, jamais derive du client ──────────────────────
  const id = randomUUID()
  const extension = EXTENSION_PAR_MIME[typeDetecte.mime] ?? '.bin'
  const nomDisque = nomSurDisque(id, extension)
  const cheminComplet = join(racineStockage(), nomDisque)
  verifierCheminSur(cheminComplet)

  // Nom d'origine affiche : on retire tout separateur de chemin pour eviter
  // qu'un nom malveillant ne perturbe l'affichage ou les journaux.
  const nomOriginalSur = donnees.fichier.name.replace(/[/\\]/g, '_').slice(0, 200) || 'document'

  await mkdir(racineStockage(), { recursive: true })
  await writeFile(cheminComplet, contenu)

  const checksumSha256 = createHash('sha256').update(contenu).digest('hex')

  try {
    await prisma.document.create({
      data: {
        id,
        patientId: donnees.patientId,
        nomOriginal: nomOriginalSur,
        cheminStockage: nomDisque,
        mimeType: typeDetecte.mime,
        tailleOctets: contenu.length,
        checksumSha256,
        categorie: donnees.categorie,
        description: donnees.description,
        createdById: contexte.userId,
      },
    })
  } catch (error) {
    // La ligne en base a echoue : le fichier ecrit est orphelin, on le supprime.
    await unlink(cheminComplet).catch(() => undefined)
    throw error
  }

  await journaliser(contexte, ACTIONS.DOCUMENT_AJOUTE, {
    entityType: 'Document',
    entityId: id,
    metadata: { patientId: donnees.patientId, mimeType: typeDetecte.mime, taille: contenu.length },
  })

  return { id, nomOriginal: nomOriginalSur }
}

export interface DocumentListe {
  id: string
  nomOriginal: string
  mimeType: string
  tailleOctets: number
  categorie: string | null
  description: string | null
  createdAt: Date
}

/**
 * Documents d'un patient, du plus recent au plus ancien.
 *
 * PAGINATION SERVEUR (§35) : radiographies, comptes rendus et pieces jointes
 * s'accumulent au fil des annees ; un patient suivi longtemps peut en avoir des
 * centaines. Seule la page demandee est lue en base ; le tri secondaire sur
 * l'identifiant garantit un ordre deterministe (les documents partagent souvent
 * le meme `createdAt` lors d'un import groupe).
 */
export async function listerDocumentsPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<DocumentListe>> {
  const idsEnCorbeille = await filtreExclusion('DOCUMENT')

  const where = { patientId, id: idsEnCorbeille }
  const { skip, take } = bornesPrisma(pagination)

  const [lignes, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        nomOriginal: true,
        mimeType: true,
        tailleOctets: true,
        categorie: true,
        description: true,
        createdAt: true,
      },
    }),
    prisma.document.count({ where }),
  ])

  return construirePage(lignes, total, pagination)
}

/**
 * Variante bornee pour les usages internes qui n'ont besoin que des derniers
 * documents (jamais de l'historique complet).
 */
export async function listerDocumentsRecents(
  patientId: string,
  limite: number = DEFAULT_PAGE_SIZE,
): Promise<DocumentListe[]> {
  const borne = Math.min(Math.max(1, limite), MAX_PAGE_SIZE)
  const page = await listerDocumentsPatient(patientId, { page: 1, taille: borne })
  return page.elements
}

export async function lireDocument(
  documentId: string,
): Promise<{ contenu: Buffer; mimeType: string; nomOriginal: string }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { cheminStockage: true, mimeType: true, nomOriginal: true },
  })
  if (!document) throw erreurs.introuvable('Document')

  const cheminComplet = join(racineStockage(), document.cheminStockage)
  verifierCheminSur(cheminComplet)

  try {
    const contenu = await readFile(cheminComplet)
    return { contenu, mimeType: document.mimeType, nomOriginal: document.nomOriginal }
  } catch {
    // Le fichier a disparu du disque alors que la ligne existe : anomalie
    // journalisee, message generique au medecin.
    logger.error('Document introuvable sur le disque', { documentId })
    throw erreurs.introuvable('Document')
  }
}

/**
 * Supprime le fichier du disque.
 * Appele UNIQUEMENT lors d'une suppression DEFINITIVE (§23) : une mise en
 * Corbeille ne touche jamais au fichier, la restauration doit rester possible.
 */
export async function supprimerFichier(cheminStockage: string): Promise<void> {
  const cheminComplet = join(racineStockage(), cheminStockage)
  try {
    verifierCheminSur(cheminComplet)
    await unlink(cheminComplet)
  } catch (error) {
    // Un fichier deja absent n'est pas une erreur bloquante.
    logger.warn('Suppression de fichier document impossible', { cheminStockage, error })
  }
}

/** Extension d'un nom de fichier, sans le point. Utilisee pour l'affichage. */
export function extensionDeNom(nom: string): string {
  return extname(nom).replace(/^\./, '').toLowerCase()
}
