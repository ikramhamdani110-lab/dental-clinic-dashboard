/**
 * =============================================================================
 *  PDF DU TABLEAU DE BORD (§25, §45)
 * =============================================================================
 *
 *  Document A4, en FRANCAIS (exigence produit : tout PDF est imprime en
 *  francais, quelle que soit la langue de l'interface), style clinique sobre.
 *  TOUTES les
 *  valeurs viennent de `donneesTableauBord()` — le MEME service que
 *  GET /api/dashboard. Le PDF ne peut donc pas contredire l'ecran : il imprime
 *  exactement ce que le medecin lit, au moment de l'export.
 *
 *  PAGINATION :
 *    Le contenu commence EN HAUT DE LA PREMIERE PAGE et s'ecoule naturellement.
 *    Un saut de page n'a lieu que lorsqu'il n'y a plus de place — jamais avant,
 *    jamais pour « preparer » une page vide. Les lignes de tableau et les titres
 *    restent avec leur contenu (un titre n'est jamais orphelin en bas de page).
 *
 *  COMPACTE :
 *    Tailles de police et interlignes choisis pour tenir au maximum sur la
 *    premiere A4, sans jamais devenir illisibles ni se chevaucher.
 */

import { formaterMontant } from '@backend/domain/finance'
import {
  appliquerPolice,
  creerDocumentPdf,
  estRtl,
  FORMAT_A4,
  langueDe,
  MARGE,
  octetsPdf,
  policeDefaut,
  type LanguePdf,
} from '@backend/pdf/pdf'
import { libelle, libelleStatut } from '@backend/pdf/libelles-pdf'
import { donneesTableauBord } from '@backend/services/reports.service'

const LARGEUR_UTILE = FORMAT_A4.largeur - MARGE * 2

/** Marge de sécurité basse : en dessous, on saute a la page suivante. */
const BAS_DE_PAGE = FORMAT_A4.hauteur - MARGE

/** Passe a la page suivante si la place restante est insuffisante. */
function garantirPlace(doc: PDFKit.PDFDocument, pointsNecessaires: number): void {
  if (doc.y + pointsNecessaires > BAS_DE_PAGE) {
    doc.addPage()
  }
}

function dateLongue(iso: string | Date, langue: LanguePdf): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(langue === 'ar' ? 'ar-DZ' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function dateCourte(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  // Numerique jj/mm/aaaa : lisible dans les DEUX langues, reste LTR.
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Titre de section : gras, souligné d'un filet fin, espacé. */
function titreSection(doc: PDFKit.PDFDocument, titre: string): void {
  const langue = langueDe(doc)
  const rtl = estRtl(langue)
  const alignement = rtl ? 'right' : 'left'
  // Un titre reste avec le contenu qui suit : on garde la place d'un titre
  // plus quelques lignes avant de sauter a la page suivante.
  garantirPlace(doc, 90)
  doc.moveDown(1)
  policeDefaut(doc, 'gras')
  doc
    .fontSize(12)
    .fillColor('#111111')
    .text(titre, MARGE, doc.y, { width: LARGEUR_UTILE, align: alignement })
  doc
    .moveTo(MARGE, doc.y + 3)
    .lineTo(FORMAT_A4.largeur - MARGE, doc.y + 3)
    .lineWidth(0.5)
    .strokeColor('#999999')
    .stroke()
    .moveDown(0.4)
}

/** Ligne « etiquette ... valeur » alignée, pour les indicateurs. */
function ligneIndicateur(
  doc: PDFKit.PDFDocument,
  etiquette: string,
  valeur: string,
  options: { alerte?: boolean } = {},
): void {
  const langue = langueDe(doc)
  const rtl = estRtl(langue)
  const alignement = rtl ? 'right' : 'left'
  garantirPlace(doc, 24)
  const y = doc.y
  policeDefaut(doc, 'normale')
  doc
    .fontSize(10)
    .fillColor('#333333')
    .text(etiquette, MARGE, y, {
      width: LARGEUR_UTILE * 0.6,
      lineBreak: false,
      align: alignement,
    })
  appliquerPolice(doc, valeur, 'gras')
  doc
    .fillColor(options.alerte ? '#b3261e' : '#111111')
    .text(valeur, MARGE + LARGEUR_UTILE * 0.6, y, {
      width: LARGEUR_UTILE * 0.4,
      align: 'right',
    })
  doc.moveDown(0.3)
}

/** En-tete de tableau (une ligne de colonnes) et separation. */
function enteteTableau(doc: PDFKit.PDFDocument, colonnes: string[], largeurs: number[]): void {
  const langue = langueDe(doc)
  const rtl = estRtl(langue)
  const alignement = rtl ? 'right' : 'left'
  garantirPlace(doc, 60)
  const y = doc.y
  let x = MARGE
  policeDefaut(doc, 'gras')
  doc.fontSize(9).fillColor('#333333')
  colonnes.forEach((colonne, index) => {
    const largeur = largeurs[index] ?? 0
    // Premiere colonne alignee selon la direction ; les autres a droite.
    doc.text(colonne, x, y, {
      width: largeur,
      align: index > 0 ? 'right' : alignement,
    })
    x += largeur
  })
  doc
    .moveTo(MARGE, doc.y + 3)
    .lineTo(FORMAT_A4.largeur - MARGE, doc.y + 3)
    .lineWidth(0.5)
    .strokeColor('#999999')
    .stroke()
    .moveDown(0.3)
}

/**
 * Une ligne de tableau, colonnes alignees a droite sauf la premiere.
 * L'en-tete est REIMPRIME en haut d'une nouvelle page si le tableau deborde :
 * le lecteur retrouve ses colonnes sans revenir en arriere.
 */
function ligneTableau(
  doc: PDFKit.PDFDocument,
  valeurs: string[],
  largeurs: number[],
  options: { gras?: boolean; entete?: string[] } = {},
): void {
  if (doc.y > BAS_DE_PAGE - 16) {
    doc.addPage()
    if (options.entete) {
      enteteTableau(doc, options.entete, largeurs)
    }
  }
  const langue = langueDe(doc)
  const rtl = estRtl(langue)
  const alignement = rtl ? 'right' : 'left'
  const y = doc.y
  let x = MARGE
  doc.fontSize(9).fillColor('#111111')
  valeurs.forEach((valeur, index) => {
    const largeur = largeurs[index] ?? 0
    appliquerPolice(doc, valeur, options.gras ? 'gras' : 'normale')
    doc.text(valeur, x, y, {
      width: largeur,
      align: index > 0 ? 'right' : alignement,
    })
    x += largeur
  })
  doc.moveDown(0.25)
}

/** Genere le PDF complet du tableau de bord, a partir du service existant. */
export async function pdfTableauDeBord(langue: LanguePdf = 'fr'): Promise<Buffer> {
  const donnees = await donneesTableauBord()
  const maintenant = new Date()
  const rtl = langue === 'ar'

  const doc = creerDocumentPdf({
    titre: libelle(langue, 'tableauDeBord'),
    sousTitre: `${libelle(langue, 'genereLe')} ${dateLongue(maintenant, langue)}`,
    langue,
  })

  // ── INDICATEURS DU JOUR ────────────────────────────────────────────────────
  titreSection(doc, libelle(langue, 'indicateursDuJour'))
  ligneIndicateur(doc, libelle(langue, 'rdvJour'), `${donnees.rendezVousDuJour.length}`)
  ligneIndicateur(doc, libelle(langue, 'nouveauxPatients'), `${donnees.nouveauxPatientsJour}`)
  ligneIndicateur(doc, libelle(langue, 'patientsVenus'), `${donnees.patientsVenusJour}`)
  ligneIndicateur(
    doc,
    `${libelle(langue, 'payeAujourdhui')} - ${donnees.nombrePaiementsJour} ${
      donnees.nombrePaiementsJour > 1
        ? libelle(langue, 'paiementsPluriel')
        : libelle(langue, 'paiements')
    }`,
    formaterMontant(donnees.revenusJourCentimes),
  )
  ligneIndicateur(
    doc,
    `${libelle(langue, 'restantDus')} - ${donnees.nombrePaiementsTotal} ${
      donnees.nombrePaiementsTotal > 1
        ? libelle(langue, 'paiementsPluriel')
        : libelle(langue, 'paiements')
    }`,
    formaterMontant(donnees.totalRestantCentimes),
    { alerte: donnees.totalRestantCentimes > 0 },
  )

  // ── RENDEZ-VOUS DU JOUR ────────────────────────────────────────────────────
  titreSection(doc, `${libelle(langue, 'rendezVousDuJour')} - ${donnees.rendezVousDuJour.length}`)
  if (donnees.rendezVousDuJour.length === 0) {
    policeDefaut(doc, 'normale')
    doc.fontSize(10).fillColor('#666666').text(libelle(langue, 'aucunRdvJour'), {
      width: LARGEUR_UTILE,
      align: rtl ? 'right' : 'left',
    })
  } else {
    const largeurs = [LARGEUR_UTILE * 0.3, LARGEUR_UTILE * 0.35, LARGEUR_UTILE * 0.25, LARGEUR_UTILE * 0.1]
    const colonnes = [
      libelle(langue, 'patient'),
      libelle(langue, 'traitement'),
      libelle(langue, 'date'),
      libelle(langue, 'statut'),
    ]
    enteteTableau(doc, colonnes, largeurs)
    for (const rdv of donnees.rendezVousDuJour) {
      ligneTableau(
        doc,
        [rdv.patient, rdv.motif ?? '-', dateCourte(rdv.dateDebut), libelleStatut(rdv.statut, langue)],
        largeurs,
        { entete: colonnes },
      )
    }
  }

  // ── NOUVEAUX RENDEZ-VOUS (CREES AUJOURD'HUI) ───────────────────────────────
  titreSection(
    doc,
    `${libelle(langue, 'nouveauxRendezVous')} — ${donnees.rendezVousCreesAujourdhui.length}`,
  )
  if (donnees.rendezVousCreesAujourdhui.length === 0) {
    policeDefaut(doc, 'normale')
    doc.fontSize(10).fillColor('#666666').text(libelle(langue, 'aucunRdvCree'), {
      width: LARGEUR_UTILE,
      align: rtl ? 'right' : 'left',
    })
  } else {
    const largeurs = [LARGEUR_UTILE * 0.3, LARGEUR_UTILE * 0.35, LARGEUR_UTILE * 0.25, LARGEUR_UTILE * 0.1]
    const colonnes = [
      libelle(langue, 'patient'),
      libelle(langue, 'traitement'),
      libelle(langue, 'date'),
      libelle(langue, 'statut'),
    ]
    enteteTableau(doc, colonnes, largeurs)
    for (const rdv of donnees.rendezVousCreesAujourdhui) {
      ligneTableau(
        doc,
        [rdv.patient, rdv.motif ?? '-', dateCourte(rdv.dateDebut), libelleStatut(rdv.statut, langue)],
        largeurs,
        { entete: colonnes },
      )
    }
  }

  return octetsPdf(doc)
}
