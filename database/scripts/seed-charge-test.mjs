#!/usr/bin/env node
/**
 * =============================================================================
 *  GENERATEUR DE DONNEES DE CHARGE — BASE JETABLE UNIQUEMENT
 * =============================================================================
 *
 *  Cree un jeu de donnees REALISTE pour mesurer les performances :
 *    100 patients, 1 000 rendez-vous, 500 traitements, 2 000 paiements,
 *    visites multiples, traitements partiellement/entierement payes, annules,
 *    paiements annules (contre-passations), plusieurs mois d'historique.
 *
 *  SECURITE — GARDE-FOU CRITIQUE
 *    Ce script REFUSE de s'executer si le nom de la base ne contient pas
 *    « _test ». Il ne doit JAMAIS toucher la base d'exploitation du cabinet :
 *    les donnees inserees sont FAUSSES et jetables (§52).
 *
 *  Usage :
 *    TEST_DATABASE_URL="postgresql://.../sahed_load_test" node database/scripts/seed-charge-test.mjs
 */

import { randomUUID } from 'node:crypto'

import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const URL = process.env.TEST_DATABASE_URL ?? ''
if (!URL) {
  process.stderr.write('TEST_DATABASE_URL est obligatoire (base jetable).\n')
  process.exit(1)
}
if (!/_test\b|test/i.test(URL)) {
  process.stderr.write(
    `REFUS : la base cible ne ressemble pas a une base de test jetable.\nURL : ${URL.replace(/:[^:@/]+@/, ':***@')}\n`,
  )
  process.exit(1)
}
if (/sahed_clinic\b/i.test(URL)) {
  process.stderr.write('REFUS ABSOLU : la base cible est la base de production.\n')
  process.exit(1)
}

const prisma = new PrismaClient({ datasources: { db: { url: URL } } })

const PRENOMS = [
  'Ahmed', 'Fatima', 'Yacine', 'Amina', 'Karim', 'Leila', 'Sofiane', 'Nadia',
  'Omar', 'Samira', 'Rachid', 'Hind', 'Bilal', 'Meriem', 'Djamel', 'Assia',
  'Nabil', 'Wafa', 'Farid', 'Sonia',
]
const NOMS = [
  'Benali', 'Haddad', 'Bouzid', 'Cherif', 'Mansouri', 'Ouali', 'Kaci', 'Belkacem',
  'Zerrouki', 'Bensalem', 'Meziane', 'Taleb',
]
const TYPES = [
  'Consultation', 'Detartrage', 'Soin conservateur (obturation)', 'Devitalisation',
  'Extraction', 'Couronne', 'Bridge', 'Implant', 'Radiographie', 'Urgence',
]
const DENTS = ['11', '12', '16', '21', '24', '36', '37', '46', '47']
const METHODES = ['ESPECES', 'CARTE', 'VIREMENT', 'AUTRE']
const STATUTS_TRAITEMENT = ['PLANIFIE', 'EN_COURS', 'TERMINE']
const STATUTS_RDV = ['PLANIFIE', 'CONFIRME', 'EN_ATTENTE', 'TERMINE', 'ANNULE', 'ABSENT']

/** Nombre de mois d'historique a couvrir. */
const MOIS_HISTORIQUE = 8

function choix(tableau) {
  return tableau[Math.floor(Math.random() * tableau.length)]
}

/**
 * Date aleatoire uniforme entre `debut` et `fin`. Les dates restent dans le
 * PASSE par rapport a maintenant : la contrainte base
 * `payments_date_plausible_check` refuse une date de paiement future.
 */
function dateEntre(debut, fin) {
  const t = debut.getTime() + Math.random() * (fin.getTime() - debut.getTime())
  return new Date(t)
}

async function main() {
  const maintenant = new Date()
  const debutHistorique = new Date(maintenant)
  debutHistorique.setMonth(debutHistorique.getMonth() - MOIS_HISTORIQUE)
  // Un peu de marge pour ne jamais generer une date future.
  const finPasse = new Date(maintenant.getTime() - 24 * 60 * 60 * 1000)

  process.stdout.write('Creation du compte medecin de test...\n')
  // Meme poivre applicatif que l'application (PASSWORD_PEPPER) : sans lui, la
  // verification de connexion echouerait. Le mot de passe de test est jetable.
  const MOT_DE_PASSE_TEST = 'ChargeTest-2026!'
  const PEPPER = process.env.PASSWORD_PEPPER ?? ''
  const hash = await argon2.hash(PEPPER ? `${MOT_DE_PASSE_TEST}${PEPPER}` : MOT_DE_PASSE_TEST, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
  const medecin = await prisma.user.create({
    data: {
      email: 'medecin.charge@test.dz',
      displayName: 'Dr Charge',
      role: 'MEDECIN',
      passwordHash: hash,
      isActive: true,
    },
  })

  // ---------------------------------------------------------------------------
  //  PATIENTS (100)
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de 100 patients...\n')
  const patientsData = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    nom: choix(NOMS),
    prenom: choix(PRENOMS),
    telephone: `05${String(50000000 + i).padStart(7, '0')}`,
    sexe: i % 2 === 0 ? 'MASCULIN' : 'FEMININ',
    dateNaissance: dateEntre(new Date('1955-01-01'), new Date('2015-01-01')),
    adresse: `Rue ${i + 1}, Alger`,
  }))
  await prisma.patient.createMany({ data: patientsData })
  const patientIds = patientsData.map((p) => p.id)

  // ---------------------------------------------------------------------------
  //  TRAITEMENTS (500) + VISITES
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de 500 traitements et de leurs visites...\n')
  const traitementsData = []
  for (let i = 0; i < 500; i += 1) {
    const patientId = patientIds[i % patientIds.length]
    // 10% de traitements annules.
    const annule = i % 10 === 0
    const statut = annule ? 'ANNULE' : choix(STATUTS_TRAITEMENT)
    const prix = (Math.floor(Math.random() * 40) + 5) * 5_000 // 25 000 .. 225 000 centimes
    const dateDebut = dateEntre(debutHistorique, finPasse)
    traitementsData.push({
      id: randomUUID(),
      patientId,
      typeTraitement: choix(TYPES),
      dents: JSON.stringify([choix(DENTS)]),
      prixTotalCentimes: prix,
      statut,
      dateDebut,
      dateFin: statut === 'TERMINE' ? dateEntre(dateDebut, finPasse) : null,
    })
  }
  await prisma.treatment.createMany({ data: traitementsData })

  // Plusieurs visites par traitement (1 a 4), numero de seance unique.
  const visitesData = []
  for (const traitement of traitementsData) {
    if (traitement.statut === 'ANNULE') continue
    const nbVisites = (Math.floor(Math.random() * 4) + 1) | 0
    for (let n = 1; n <= nbVisites; n += 1) {
      const dateVisite = dateEntre(traitement.dateDebut, finPasse)
      visitesData.push({
        id: randomUUID(),
        treatmentId: traitement.id,
        numeroSeance: n,
        dateDebut: dateVisite,
      })
    }
  }
  // createMany par lots pour eviter une requete trop longue.
  for (let i = 0; i < visitesData.length; i += 500) {
    await prisma.treatmentVisit.createMany({ data: visitesData.slice(i, i + 500) })
  }

  // ---------------------------------------------------------------------------
  //  RENDEZ-VOUS (1 000), dates variees, y compris passes et a venir
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de 1 000 rendez-vous...\n')
  const debutRdv = new Date(maintenant)
  debutRdv.setMonth(debutRdv.getMonth() - MOIS_HISTORIQUE)
  const finRdv = new Date(maintenant)
  finRdv.setMonth(finRdv.getMonth() + 2) // quelques rendez-vous a venir

  const rdvData = []
  for (let i = 0; i < 1000; i += 1) {
    const debut = dateEntre(debutRdv, finRdv)
    const fin = new Date(debut.getTime() + 30 * 60 * 1000)
    rdvData.push({
      id: randomUUID(),
      patientId: patientIds[i % patientIds.length],
      praticienId: medecin.id,
      dateDebut: debut,
      dateFin: fin,
      statut: choix(STATUTS_RDV),
      motif: choix(['Controle', 'Douleur', 'Detartrage', 'Suivi', 'Urgence']),
      dents: JSON.stringify([choix(DENTS)]),
    })
  }
  for (let i = 0; i < rdvData.length; i += 500) {
    await prisma.appointment.createMany({ data: rdvData.slice(i, i + 500) })
  }

  // ---------------------------------------------------------------------------
  //  PAIEMENTS (2 000), plusieurs mois, partiels/complets/annules
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de 2 000 paiements...\n')
  const traitementsPayables = traitementsData.filter((t) => t.statut !== 'ANNULE')
  const paiementsData = []
  let cle = 0
  for (let i = 0; i < 2000; i += 1) {
    const traitement = traitementsPayables[i % traitementsPayables.length]
    if (!traitement) break
    cle += 1
    const datePaiement = dateEntre(debutHistorique, finPasse)
    // 12% de paiements annules (contre-passation).
    const statut = i % 8 === 0 ? 'ANNULE' : 'VALIDE'
    // Montant : fraction du prix (paiement partiel frequent).
    const fraction = [0.25, 0.5, 0.75, 1][i % 4]
    const montant = Math.max(1_000, Math.round((traitement.prixTotalCentimes * fraction) / 4))
    paiementsData.push({
      id: randomUUID(),
      patientId: traitement.patientId,
      treatmentId: traitement.id,
      montantCentimes: montant,
      datePaiement,
      methode: choix(METHODES),
      statut,
      idempotencyKey: `charge-${cle}-${randomUUID()}`,
      createdById: medecin.id,
    })
  }
  for (let i = 0; i < paiementsData.length; i += 500) {
    await prisma.payment.createMany({ data: paiementsData.slice(i, i + 500) })
  }

  // ---------------------------------------------------------------------------
  //  DOSSIERS MEDICAUX / ORDONNANCES / ODONTOGRAMME / DOCUMENTS (echantillon)
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de dossiers medicaux, ordonnances, odontogramme, documents...\n')
  const dossiersData = []
  for (let i = 0; i < 300; i += 1) {
    const t = traitementsData[i % traitementsData.length]
    dossiersData.push({
      id: randomUUID(),
      patientId: t.patientId,
      treatmentId: t.id,
      date: dateEntre(debutHistorique, finPasse),
      motifPlainte: 'Douleur dentaire',
      diagnostic: 'Carie profonde',
      traitementRealise: 'Soin conservateur',
      createdById: medecin.id,
    })
  }
  await prisma.medicalRecord.createMany({ data: dossiersData })

  const ordonnancesData = []
  const itemsData = []
  for (let i = 0; i < 200; i += 1) {
    const t = traitementsData[i % traitementsData.length]
    const id = randomUUID()
    ordonnancesData.push({
      id,
      patientId: t.patientId,
      treatmentId: t.id,
      date: dateEntre(debutHistorique, finPasse),
      notes: 'Antibiotherapie 5 jours',
      createdById: medecin.id,
    })
    itemsData.push({
      id: randomUUID(),
      prescriptionId: id,
      medicament: 'Amoxicilline 500mg',
      dosage: '1 gelule',
      frequence: '3 fois par jour',
      duree: '5 jours',
      position: 0,
    })
  }
  await prisma.prescription.createMany({ data: ordonnancesData })
  await prisma.prescriptionItem.createMany({ data: itemsData })

  const odontoData = []
  for (let i = 0; i < 800; i += 1) {
    odontoData.push({
      id: randomUUID(),
      patientId: patientIds[i % patientIds.length],
      numeroDent: choix(DENTS),
      etat: choix(['SAINE', 'CARIE', 'OBTUREE', 'COURONNE', 'ABSENTE']),
      date: dateEntre(debutHistorique, finPasse),
      createdById: medecin.id,
    })
  }
  await prisma.odontogramEntry.createMany({ data: odontoData })

  const documentsData = []
  for (let i = 0; i < 150; i += 1) {
    documentsData.push({
      id: randomUUID(),
      patientId: patientIds[i % patientIds.length],
      nomOriginal: `radio-${i}.png`,
      cheminStockage: `test/radio-${i}.png`,
      mimeType: 'image/png',
      tailleOctets: 1024 * (i + 1),
      checksumSha256: 'a'.repeat(64),
      categorie: 'Radiographie',
      createdById: medecin.id,
    })
  }
  await prisma.document.createMany({ data: documentsData })

  // ---------------------------------------------------------------------------
  //  CORBEILLE — quelques elements restaurables et quelques expires
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation d’elements de Corbeille (restaurables et expires)...\n')
  const maintenantMs = Date.now()
  const corbeilleData = []
  for (let i = 0; i < 40; i += 1) {
    const supprimeLe = new Date(maintenantMs - i * 60 * 1000)
    const expireLe = new Date(supprimeLe.getTime() + 24 * 60 * 60 * 1000)
    corbeilleData.push({
      id: randomUUID(),
      entityType: 'RENDEZ_VOUS',
      entityId: rdvData[i]?.id ?? randomUUID(),
      description: `Rendez-vous de test ${i}`,
      snapshot: '{}',
      supprimeParId: medecin.id,
      supprimeLe,
      expireLe,
    })
  }
  await prisma.trashEntry.createMany({ data: corbeilleData })

  // ---------------------------------------------------------------------------
  //  JOURNAL D'ACTIVITE (volume realiste)
  // ---------------------------------------------------------------------------
  process.stdout.write('Creation de 600 entrees de journal d’activite...\n')
  const journalData = []
  for (let i = 0; i < 600; i += 1) {
    journalData.push({
      id: randomUUID(),
      action: 'PATIENT_MODIFIE',
      userId: medecin.id,
      userEmail: medecin.email,
      entityType: 'Patient',
      entityId: patientIds[i % patientIds.length],
      createdAt: dateEntre(debutHistorique, finPasse),
    })
  }
  for (let i = 0; i < journalData.length; i += 500) {
    await prisma.activityLog.createMany({ data: journalData.slice(i, i + 500) })
  }

  const compteurs = {
    patients: await prisma.patient.count(),
    appointments: await prisma.appointment.count(),
    treatments: await prisma.treatment.count(),
    visits: await prisma.treatmentVisit.count(),
    payments: await prisma.payment.count(),
    medicalRecords: await prisma.medicalRecord.count(),
    prescriptions: await prisma.prescription.count(),
    odontogram: await prisma.odontogramEntry.count(),
    documents: await prisma.document.count(),
    trash: await prisma.trashEntry.count(),
    activityLogs: await prisma.activityLog.count(),
  }
  process.stdout.write('Donnees de charge creees :\n' + JSON.stringify(compteurs, null, 2) + '\n')
}

main()
  .catch((erreur) => {
    process.stderr.write('[seed-charge] Echec : ' + (erreur instanceof Error ? erreur.message : String(erreur)) + '\n')
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })