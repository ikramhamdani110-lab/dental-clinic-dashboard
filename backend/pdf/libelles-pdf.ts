/**
 * =============================================================================
 *  LIBELLES PDF — FRANCAIS / ARABE
 * =============================================================================
 *
 *  Les deux PDF (tableau de bord, dossier patient) peuvent etre generes en
 *  français ou en arabe, selon la langue choisie dans l'interface. Les libelles
 *  des documents sont centralises ici : un seul endroit a corriger pour
 *  harmoniser un terme imprime.
 *
 *  REMARQUE FONTES : l'em-dash « — » n'a pas de glyphe dans Noto Naskh Arabic
 *  (tofu a l'impression). Dans les libelles arabes, le tiret separateur est
 *  donc l'hyphen-minus « - », present dans la police.
 */

import type { LanguePdf } from '@backend/pdf/pdf'

type Dictionnaire = Record<string, string>

const FR: Dictionnaire = {
  nomClinique: 'Sahed Dental Clinic',
  tableauDeBord: 'Tableau de bord — synthèse du jour',
  dossierPatient: 'Dossier patient',
  genereLe: 'Rapport généré le',
  documentGenereLe: 'Document généré le',
  indicateursDuJour: 'Indicateurs du jour',
  rdvJour: 'Rendez-vous du jour (planifiés)',
  nouveauxPatients: 'Nouveaux patients (première visite aujourd’hui)',
  patientsVenus: 'Patients venus au cabinet aujourd’hui',
  payeAujourdhui: 'Payé aujourd’hui',
  paiements: 'paiement',
  paiementsPluriel: 'paiements',
  restantDus: 'Montants restant dus par les patients',
  rendezVousDuJour: 'Rendez-vous du jour',
  nouveauxRendezVous: 'Nouveaux rendez-vous',
  aucunRdvJour: 'Aucun rendez-vous planifié pour aujourd’hui.',
  aucunRdvCree: 'Aucun rendez-vous créé aujourd’hui.',
  patient: 'Patient',
  traitement: 'Traitement',
  date: 'Date',
  heure: 'Heure',
  statut: 'Statut',
  informationsPatient: 'Informations du patient',
  nom: 'Nom',
  prenom: 'Prénom',
  age: 'Âge',
  sexe: 'Sexe',
  telephone: 'Téléphone',
  adresse: 'Adresse',
  note: 'Note',
  resumeFinancier: 'Résumé financier',
  totalSoins: 'Total des soins',
  totalPaye: 'Total payé',
  totalRestant: 'Total restant',
  rendezVous: 'Rendez-vous',
  aucunRdvPatient: 'Aucun rendez-vous pour ce patient.',
  aucunPaiement: 'Aucun paiement enregistré pour ce patient.',
  paiementAssocie: 'Traitement associé',
  montant: 'Montant',
  paye: 'Payé',
  reste: 'Reste',
  ans: 'ans',
  homme: 'Homme',
  femme: 'Femme',
  planifie: 'Planifié',
  fait: 'Fait',
  absent: 'Absent',
  reprogramme: 'Reprogrammé',
  valide: 'Validé',
  annule: 'Annulé',
  page: 'page',
}

const AR: Dictionnaire = {
  nomClinique: 'عيادة الدكتور ساهد',
  tableauDeBord: 'لوحة القيادة - حصيلة اليوم',
  dossierPatient: 'ملف المريض',
  genereLe: 'تم إنشاء التقرير يوم',
  documentGenereLe: 'تم إنشاء الوثيقة يوم',
  indicateursDuJour: 'مؤشرات اليوم',
  rdvJour: 'مواعيد اليوم (المبرمجة)',
  nouveauxPatients: 'مرضى جدد (زيارة أولى اليوم)',
  patientsVenus: 'المرضى الذين حضروا اليوم',
  payeAujourdhui: 'المدفوع اليوم',
  paiements: 'دفع',
  paiementsPluriel: 'دفعات',
  restantDus: 'المبالغ المتبقية على المرضى',
  rendezVousDuJour: 'مواعيد اليوم',
  nouveauxRendezVous: 'المواعيد الجديدة',
  aucunRdvJour: 'لا توجد مواعيد مبرمجة لليوم.',
  aucunRdvCree: 'لم تُنشأ أي موعد اليوم.',
  patient: 'المريض',
  traitement: 'العلاج',
  date: 'التاريخ',
  heure: 'الساعة',
  statut: 'الحالة',
  informationsPatient: 'معلومات المريض',
  nom: 'اللقب',
  prenom: 'الاسم',
  age: 'العمر',
  sexe: 'الجنس',
  telephone: 'الهاتف',
  adresse: 'العنوان',
  note: 'ملاحظة',
  resumeFinancier: 'الملخص المالي',
  totalSoins: 'مجموع العلاجات',
  totalPaye: 'المجموع المدفوع',
  totalRestant: 'المجموع المتبقي',
  rendezVous: 'المواعيد',
  aucunRdvPatient: 'لا توجد مواعيد لهذا المريض.',
  aucunPaiement: 'لا توجد دفعات مسجلة لهذا المريض.',
  paiementAssocie: 'العلاج المرتبط',
  montant: 'المبلغ',
  paye: 'مدفوع',
  reste: 'المتبقي',
  ans: 'سنة',
  homme: 'ذكر',
  femme: 'أنثى',
  planifie: 'مبرمج',
  fait: 'منجز',
  absent: 'غائب',
  reprogramme: 'أعيد برمجته',
  valide: 'مصادق عليه',
  annule: 'ملغى',
  page: 'صفحة',
}

/** Libelle imprime pour une cle, dans la langue du document. */
export function libelle(langue: LanguePdf, cle: string): string {
  const dictionnaire = langue === 'ar' ? AR : FR
  return dictionnaire[cle] ?? FR[cle] ?? cle
}

/** Libelle francais ou arabe d'un statut de rendez-vous stocke en base. */
export function libelleStatut(statut: string, langue: LanguePdf): string {
  const base: string = (() => {
    switch (statut) {
      case 'PLANIFIE':
      case 'CONFIRME':
      case 'EN_ATTENTE':
      case 'EN_COURS':
        return 'planifie'
      case 'TERMINE':
        return 'fait'
      case 'ABSENT':
        return 'absent'
      case 'REPROGRAMME':
        return 'reprogramme'
      default:
        return statut
    }
  })()
  return libelle(langue, base)
}
