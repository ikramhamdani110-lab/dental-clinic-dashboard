/**
 * =============================================================================
 *  PDF DU DOSSIER PATIENT (§10, §45)
 * =============================================================================
 *
 *  Document A4, en FRANCAIS (exigence produit : tout PDF est imprime en
 *  francais, quelle que soit la langue de l'interface), style clinique sobre.
 *  Il rassemble
 *  UNIQUEMENT les données déjà visibles sur la fiche patient :
 *
 *    1. Informations du patient  — nom, prénom, âge, sexe, téléphone,
 *       adresse et note, si disponibles ;
 *    2. Rendez-vous              — TOUS les rendez-vous du patient, avec le
 *       traitement lié et son solde (Total / Payé / Reste) ;
 *    3. Paiements                — TOUS les versements du patient, avec le
 *       résumé Total des soins / Total payé / Total restant.
 *
 *  AUCUNE donnée retirée de l'application n'est réintroduite (numéro de dent,
 *  email, antécédents médicaux, contact d'urgence...), et AUCUN calcul
 *  financier n'est refait ici : les montants proviennent des MÊMES services
 *  que la fiche (`obtenirPatient`, `calculerSoldePatient`, `rendezVousDuPatient`,
 *  `paiementsDuPatient`), appelés avec une pagination couvrant TOUT l'historique.
 *
 *  PAGINATION NATURELLE :
 *    Le contenu s'écoule de la première page à la dernière sans saut forcé ni
 *    page blanche. Un en-tête de tableau déborde proprement : sur une nouvelle
 *    page, l'en-tête de colonnes est réimprimé.
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
import { obtenirPatient, calculerSoldePatient } from '@backend/services/patients.service'
import { rendezVousDuPatient } from '@backend/services/appointments.service'
import { paiementsDuPatient } from '@backend/services/payments.service'

const LARGEUR_UTILE = FORMAT_A4.largeur - MARGE * 2

/** Taille de page utilisée pour les exports : l'historique complet, d'un coup. */
const TAILLE_COMPLETE = 10_000

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
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function dateCourte(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  // Numerique jj/mm/aaaa : lisible dans les DEUX langues, reste LTR.
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function libelleSexe(sexe: string, langue: LanguePdf): string {
  if (sexe === 'MASCULIN' || sexe === 'HOMME') return libelle(langue, 'homme')
  if (sexe === 'FEMININ' || sexe === 'FEMME') return libelle(langue, 'femme')
  return sexe
}

/** Âge affichable : identique à la règle de la fiche (l'âge saisi d'abord). */
function afficherAge(age: number | null, dateNaissance: Date | null, langue: LanguePdf): string {
  const unite = langue === 'ar' ? ` ${libelle(langue, 'ans')}` : ` ${libelle(langue, 'ans')}`
  if (age !== null) return `${age}${unite}`
  if (dateNaissance) {
    const aujourdHui = new Date()
    let ans = aujourdHui.getFullYear() - dateNaissance.getFullYear()
    const mois = aujourdHui.getMonth() - dateNaissance.getMonth()
    if (mois < 0 || (mois === 0 && aujourdHui.getDate() < dateNaissance.getDate())) ans -= 1
    return `${ans}${unite}`
  }
  return '-'
}

function titreSection(doc: PDFKit.PDFDocument, titre: string): void {
  const langue = langueDe(doc)
  const rtl = estRtl(langue)
  const alignement = rtl ? 'right' : 'left'
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
      width: LARGEUR_UTILE * 0.55,
      lineBreak: false,
      align: alignement,
    })
  appliquerPolice(doc, valeur, 'gras')
  doc
    .fillColor(options.alerte ? '#b3261e' : '#111111')
    .text(valeur, MARGE + LARGEUR_UTILE * 0.55, y, {
      width: LARGEUR_UTILE * 0.45,
      align: 'right',
    })
  doc.moveDown(0.3)
}

function enteteTableau(doc: PDFKit.PDFDocument, colonnes: string[], largeurs: readonly number[]): void {
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

/** Génère le PDF complet du dossier d'un patient, à partir des services existants. */
export async function pdfDossierPatient(
  patientId: string,
  langue: LanguePdf = 'fr',
): Promise<{
  pdf: Buffer
  /** Nom de fichier suggéré, déjà sanitisé (dossier-patient-nom-prenom.pdf). */
  nomFichier: string
}> {
  // Le patient est d'abord VALIDÉ (existe, pas en corbeille) : `obtenirPatient`
  // lève INTROUVABLE sinon, exactement comme la fiche.
  const [patient, solde, pageRendezVous, pagePaiements] = await Promise.all([
    obtenirPatient(patientId),
    calculerSoldePatient(patientId),
    rendezVousDuPatient(patientId, { page: 1, taille: TAILLE_COMPLETE }),
    paiementsDuPatient(patientId, { page: 1, taille: TAILLE_COMPLETE }),
  ])

  const nomComplet = `${patient.prenom} ${patient.nom}`
  const maintenant = new Date()
  const rtl = langue === 'ar'
  const alignement: 'left' | 'right' = rtl ? 'right' : 'left'

  const doc = creerDocumentPdf({
    titre: `${libelle(langue, 'dossierPatient')} - ${nomComplet}`,
    sousTitre: `${libelle(langue, 'documentGenereLe')} ${dateLongue(maintenant, langue)}`,
    langue,
  })

  // ── INFORMATIONS DU PATIENT ────────────────────────────────────────────────
  titreSection(doc, libelle(langue, 'informationsPatient'))
  const champs: Array<[string, string]> = [
    [libelle(langue, 'nom'), patient.nom],
    [libelle(langue, 'prenom'), patient.prenom],
    [libelle(langue, 'age'), afficherAge(patient.age, patient.dateNaissance, langue)],
    [libelle(langue, 'sexe'), libelleSexe(patient.sexe, langue)],
    [libelle(langue, 'telephone'), patient.telephone],
    [libelle(langue, 'adresse'), patient.adresse ?? '-'],
    [libelle(langue, 'note'), patient.notesGenerales ?? '-'],
  ]
  for (const [etiquette, valeur] of champs) {
    garantirPlace(doc, 20)
    const y = doc.y
    policeDefaut(doc, 'normale')
    doc.fontSize(10).fillColor('#333333').text(etiquette, MARGE, y, {
      width: LARGEUR_UTILE * 0.3,
      lineBreak: false,
      align: alignement,
    })
    appliquerPolice(doc, valeur, 'gras')
    doc.fillColor('#111111').text(valeur, MARGE + LARGEUR_UTILE * 0.3, y, {
      width: LARGEUR_UTILE * 0.7,
      align: rtl ? 'left' : 'left',
    })
    doc.moveDown(0.2)
  }

  // ── RÉSUMÉ FINANCIER (même calcul que la fiche) ────────────────────────────
  titreSection(doc, libelle(langue, 'resumeFinancier'))
  ligneIndicateur(doc, libelle(langue, 'totalSoins'), formaterMontant(solde.totalTraitementsCentimes))
  ligneIndicateur(doc, libelle(langue, 'totalPaye'), formaterMontant(solde.totalPayeCentimes))
  ligneIndicateur(doc, libelle(langue, 'totalRestant'), formaterMontant(solde.resteAPayerCentimes), {
    alerte: solde.resteAPayerCentimes > 0,
  })

  // ── RENDEZ-VOUS (tous) ─────────────────────────────────────────────────────
  titreSection(doc, `${libelle(langue, 'rendezVous')} - ${pageRendezVous.elements.length}`)
  if (pageRendezVous.elements.length === 0) {
    policeDefaut(doc, 'normale')
    doc.fontSize(10).fillColor('#666666').text(libelle(langue, 'aucunRdvPatient'), {
      width: LARGEUR_UTILE,
      align: alignement,
    })
  } else {
    const largeurs = [
      LARGEUR_UTILE * 0.18,
      LARGEUR_UTILE * 0.3,
      LARGEUR_UTILE * 0.16,
      LARGEUR_UTILE * 0.12,
      LARGEUR_UTILE * 0.12,
      LARGEUR_UTILE * 0.12,
    ]
    const colonnes = [
      libelle(langue, 'date'),
      libelle(langue, 'traitement'),
      libelle(langue, 'totalSoins'),
      libelle(langue, 'paye'),
      libelle(langue, 'reste'),
      libelle(langue, 'statut'),
    ]
    enteteTableau(doc, colonnes, largeurs)
    for (const rdv of pageRendezVous.elements) {
      ligneTableau(
        doc,
        [
          dateCourte(rdv.dateDebut),
          rdv.traitement ? rdv.traitement.typeTraitement : (rdv.motif ?? '-'),
          rdv.traitement ? formaterMontant(rdv.traitement.prixTotalCentimes) : '-',
          rdv.traitement ? formaterMontant(rdv.traitement.montantPayeCentimes) : '-',
          rdv.traitement ? formaterMontant(rdv.traitement.resteAPayerCentimes) : '-',
          libelleStatut(rdv.statut, langue),
        ],
        largeurs,
        { entete: colonnes },
      )
    }
  }

  // ── PAIEMENTS (tous) ───────────────────────────────────────────────────────
  titreSection(doc, `${libelle(langue, 'paiementsPluriel')} - ${pagePaiements.elements.length}`)
  if (pagePaiements.elements.length === 0) {
    policeDefaut(doc, 'normale')
    doc.fontSize(10).fillColor('#666666').text(libelle(langue, 'aucunPaiement'), {
      width: LARGEUR_UTILE,
      align: alignement,
    })
  } else {
    const largeurs = [LARGEUR_UTILE * 0.22, LARGEUR_UTILE * 0.5, LARGEUR_UTILE * 0.18, LARGEUR_UTILE * 0.1]
    const colonnes = [
      libelle(langue, 'date'),
      libelle(langue, 'paiementAssocie'),
      libelle(langue, 'montant'),
      libelle(langue, 'statut'),
    ]
    enteteTableau(doc, colonnes, largeurs)
    for (const paiement of pagePaiements.elements) {
      ligneTableau(
        doc,
        [
          dateCourte(paiement.datePaiement),
          paiement.treatment?.typeTraitement ?? '-',
          formaterMontant(paiement.montantCentimes),
          paiement.statut === 'VALIDE'
            ? libelle(langue, 'valide')
            : paiement.statut === 'ANNULE'
              ? libelle(langue, 'annule')
              : paiement.statut,
        ],
        largeurs,
        { entete: colonnes },
      )
    }
  }

  // Nom de fichier demandé : dossier-patient-NOM-PRENOM.pdf. Sanitisé
  // strictement : accents transcrits, seuls lettres/chiffres/tirets survivent.
  const sanitaire = (valeur: string) =>
    valeur
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'patient'

  return {
    pdf: await octetsPdf(doc),
    nomFichier: `dossier-patient-${sanitaire(patient.nom)}-${sanitaire(patient.prenom)}.pdf`,
  }
}
