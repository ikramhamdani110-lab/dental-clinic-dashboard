/**
 * =============================================================================
 *  GENERATION PDF — PDFKIT (§45, §27)
 * =============================================================================
 *
 *  Les PDF du cabinet (tableau de bord, dossier patient) sont produits COTE
 *  SERVEUR par PDFKit. Aucune donnee patient ne traverse le navigateur pour
 *  etre mise en page par une librairie client : le serveur lit la base,
 *  compose le document, puis renvoie les octets au medecin authentifie.
 *
 *  STYLE VOLONTAIREMENT SOBRE :
 *    - A4 (595.28 x 841.89 pt), marges 48 pt ;
 *    - filets de separation fins, AUCUN fond colore plein, aucun degrade ;
 *    - pagination en pied de page.
 *
 *  POLICES UNICODE :
 *    Helvetica (police standard PDF, WinAnsi) ne couvre ni l'arabe, ni certains
 *    caracteres typographiques français (œ...). Les documents sont composes
 *    avec Noto Sans (latin complet : accents é è ê à ç œ, DZD/DA, ponctuation)
 *    et, pour l'arabe, Noto Naskh Arabic. Ces polices TTF sont INTEGREES au
 *    fichier PDF : le rendu est identique sur tous les postes.
 *
 *  LANGUE DU DOCUMENT — EXIGENCE PRODUIT :
 *    Tout PDF genere par l'application est imprime en FRANCAIS, quelle que soit
 *    la langue affichee dans l'interface. Les libelles arabes restent definis
 *    dans `libelles-pdf.ts` (code preserve) mais ne sont PLUS selectionnes :
 *    `definirLangue` est forcé a « fr » a la creation du document, et l'appelant
 *    ne peut plus choisir. Les fragments de DONNEES contenant de l'arabe (noms,
 *    notes...) continuent d'etre composes avec la police arabe, sans etre
 *    traduits ni reorientes.
 */

import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NOM_CLINIQUE = 'Sahed Dental Clinic'
export const NOM_CLINIQUE_ARABE = 'عيادة الدكتور ساهد'

/** Dimensions A4 portrait, en points. */
export const FORMAT_A4 = { largeur: 595.28, hauteur: 841.89 } as const
export const MARGE = 48

/** Langue d'un document PDF : français ou arabe. */
export type LanguePdf = 'fr' | 'ar'

/** Vrai si la langue s'ecrit de droite a gauche. */
export function estRtl(langue: LanguePdf): boolean {
  return langue === 'ar'
}

/** Langue par document : PDFKit n'a pas de champ `language`, on la garde ici. */
const LANGUES = new WeakMap<PDFKit.PDFDocument, LanguePdf>()

export function definirLangue(doc: PDFKit.PDFDocument, langue: LanguePdf): void {
  LANGUES.set(doc, langue)
}

export function langueDe(doc: PDFKit.PDFDocument): LanguePdf {
  return LANGUES.get(doc) ?? 'fr'
}

export interface OptionsEnTete {
  titre: string
  sousTitre?: string
  /** Langue du document ; « fr » par defaut. */
  langue?: LanguePdf
}

/**
 * Cree un document A4 pret a recevoir le contenu, avec l'en-tete clinique et
 * la pagination deja en place. Le tampon de date est passe par l'appelant :
 * il provient de la MEME horloge que les calculs du tableau de bord.
 */
export function creerDocumentPdf(options: OptionsEnTete): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE },
    autoFirstPage: true,
    // NECESSAIRE au pied de page pagine : sans `bufferPages`, PDFKit « flush »
    // chaque page à sa création et `switchToPage` ne peut plus y revenir.
    bufferPages: true,
    info: {
      Title: `${options.titre} — ${NOM_CLINIQUE}`,
      Author: NOM_CLINIQUE,
      Creator: NOM_CLINIQUE,
    },
  })

  definirLangue(doc, 'fr')
  policeDefaut(doc, 'normale')

  enTete(doc, options)
  return doc
}

// ── Polices intégrées ─────────────────────────────────────────────────────────
// Les fichiers TTF vivent dans `assets/fonts`. Le chemin est résolu depuis la
// RACINE DU PAQUET (import.meta.url), PAS depuis process.cwd() :
//  - en dev et en `next start`, cwd = racine du projet → les deux chemins sont
//    identiques ;
//  - sur Vercel (serverless), cwd = /var/task mais le bundle compilé vit dans
//    /var/task/.next/server/... — un chemin basé sur cwd pointait hors du
//    bundle et produisait ENOENT « assets/fonts/NotoSans-Regular.ttf »
//    (erreur production observée sur les routes /api/*/pdf).
// On remonte donc depuis CE fichier : backend/pdf → backend → racine.

const RACINE_PAQUET = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function cheminPolice(fichier: string): string {
  // 1. Chemin bundle-relatif (production serverless et next start).
  const candidatBundle = resolve(RACINE_PAQUET, 'assets', 'fonts', fichier)
  if (existsSync(candidatBundle)) return candidatBundle
  // 2. Repli historique : cwd-relatif (certains environnements copient
  //    assets/fonts à côté du binaire — installations de bureau).
  return resolve(process.cwd(), 'assets', 'fonts', fichier)
}

const POLICES = {
  latin: cheminPolice('NotoSans-Regular.ttf'),
  latinGras: cheminPolice('NotoSans-Bold.ttf'),
  arabe: cheminPolice('NotoNaskhArabic-Regular.ttf'),
  arabeGras: cheminPolice('NotoNaskhArabic-Bold.ttf'),
}

export type PoliceStyle = 'normale' | 'gras'

/** Detecte tout caractere arabe dans un fragment de texte. */
export function contientArabe(texte: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(texte)
}

/**
 * Applique la police selon le CONTENU du fragment et le style :
 * - fragment contenant de l'arabe → Noto Naskh Arabic (seule police avec les
 *   glyphes arabes, y compris dans un document français) ;
 * - sinon → Noto Sans (accents français, DA, ponctuation).
 * Le choix par contenu plutôt que par langue évite les carrés « tofu » quand
 * une donnée (nom de traitement, note...) contient de l'arabe dans un PDF français.
 */
export function appliquerPolice(
  doc: PDFKit.PDFDocument,
  fragment: string,
  style: PoliceStyle = 'normale',
): void {
  if (contientArabe(fragment)) {
    doc.font(style === 'gras' ? POLICES.arabeGras : POLICES.arabe)
  } else {
    doc.font(style === 'gras' ? POLICES.latinGras : POLICES.latin)
  }
}

/** Applique la police par defaut de la langue (pour l'en-tete, les filets...). */
export function policeDefaut(doc: PDFKit.PDFDocument, style: PoliceStyle = 'normale'): void {
  if (langueDe(doc) === 'ar') {
    doc.font(style === 'gras' ? POLICES.arabeGras : POLICES.arabe)
  } else {
    doc.font(style === 'gras' ? POLICES.latinGras : POLICES.latin)
  }
}

/** En-tete : nom de la clinique, titre du document, date, filet. */
function enTete(doc: PDFKit.PDFDocument, options: OptionsEnTete): void {
  const rtl = estRtl(langueDe(doc))
  const alignement: 'left' | 'right' = rtl ? 'right' : 'left'
  const nomClinique = rtl ? NOM_CLINIQUE_ARABE : NOM_CLINIQUE

  doc
    .fontSize(16)
    .fillColor('#111111')
    .text(nomClinique, MARGE, MARGE - 20, {
      width: FORMAT_A4.largeur - MARGE * 2,
      align: alignement,
    })

  policeDefaut(doc, 'normale')
  doc.fontSize(11).fillColor('#444444').text(options.titre, { align: alignement })

  if (options.sousTitre) {
    doc.fontSize(9).fillColor('#666666').text(options.sousTitre, { align: alignement })
  }

  doc
    .moveDown(0.5)
    .moveTo(MARGE, doc.y)
    .lineTo(FORMAT_A4.largeur - MARGE, doc.y)
    .lineWidth(1)
    .strokeColor('#222222')
    .stroke()
    .moveDown(1)
    .fontSize(10)
    .fillColor('#111111')
}

/**
 * PIED DE PAGE — ÉCRIT EN FIN DE DOCUMENT, PAS À LA CRÉATION.
 *
 * Le pied de page n'est possible qu'une fois toutes les pages connues
 * (numérotation totale). Il est donc appelé par `octetsPdf` juste avant
 * `doc.end()`. L'écrire à la création serait le bug de la « page 1 presque
 * vide » : `switchToPage` laisse le curseur en bas de page 1, et tout le
 * contenu suivant débordait sur la page 2.
 */
function piedDePage(doc: PDFKit.PDFDocument): void {
  const gamme = doc.bufferedPageRange()
  // Le pied est tracé DANS la zone de texte (au-dessus de la marge basse) :
  // un y dans la marge basse ferait paginationner le pied lui-même, ce qui
  // produisait des pages vides « fantômes » après le contenu.
  const yPied = FORMAT_A4.hauteur - MARGE - 10
  for (let i = gamme.start; i < gamme.start + gamme.count; i += 1) {
    doc.switchToPage(i)
    // Tracé direct (pas `doc.text`) : `text` fait couler le curseur et peut
    // paginationner ; ici on écrit la chaîne en opérateurs bruts, SANS toucher
    // au flux de mise en page — impossible de créer une page fantôme.
    const libelle = `${NOM_CLINIQUE} - page ${i + 1} / ${gamme.count}`
    doc.font(POLICES.latin)
    const largeur = doc.widthOfString(libelle)
    const y = yPied + 8 // ligne de base (PDFKit mesure le haut du texte)
    doc
      .save()
      .font(POLICES.latin)
      .fontSize(8)
      .fillColor('#777777')
      .translate(FORMAT_A4.largeur - MARGE - largeur, y)
      .text(libelle, 0, 0, { lineBreak: false, width: undefined })
      .restore()
  }
}

/**
 * Genere les octets du PDF. Le pied de page est écrit ICI, une fois tout le
 * contenu posé (toutes les pages existent donc, numérotation exacte) puis le
 * document est terminé. L'attente est necessaire : PDFKit ecrit les pages en
 * tampon.
 */
export function octetsPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    const morceaux: Buffer[] = []
    doc.on('data', (morceau: Buffer) => morceaux.push(morceau))
    doc.on('end', () => resoudre(Buffer.concat(morceaux)))
    doc.on('error', rejeter)
    piedDePage(doc)
    doc.end()
  })
}

/** Met le texte en couleur « danger » quand un reste est strictement positif. */
export function couleurReste(resteCentimes: number): string {
  return resteCentimes > 0 ? '#b3261e' : '#111111'
}
