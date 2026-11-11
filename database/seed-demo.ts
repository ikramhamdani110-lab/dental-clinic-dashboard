/**
 * =============================================================================
 *  GENERATION DE DONNEES DE DEMONSTRATION (FAKE)
 * =============================================================================
 *
 *  Ce script alimente une base de DEMONSTRATION, hebergee sur une instance
 *  PostgreSQL separee (port 5433). Il refuse categoriquement de s'executer si
 *  l'URL ne pointe pas sur ce port : la base de production `sahed_clinic`
 *  (port 5432) lui est donc inaccessible, meme par erreur de variable
 *  d'environnement.
 *
 *  AUCUNE DONNEE REELLE N'EST UTILISEE.
 *    - les patients sont des prenoms et noms fictifs (liste locale) ;
 *    - les numeros de telephone sont factices et reserves a la zone de test ;
 *    - les identifiants et adresses email appartiennent a des domaines
 *      inexistants (example.invalid), qui ne peuvent pas etre livres ;
 *    - les montants sont arbitraires mais plausibles, en dinars.
 *
 *  Ce qui est produit, pour que la demonstration soit convaincante :
 *
 *    - AUJOURD'HUI : des rendez-vous planifies HONORES, un patient absent, un
 *      rendez-vous a venir, et des visites sans rendez-vous (dont des
 *      patients dont c'est la premiere venue) — pour alimenter les deux
 *      listes du tableau de bord ;
 *    - des paiements du jour, pour que « Paiements du jour » ne soit pas nul ;
 *    - des traitements PARTIELLEMENT soldes, pour illustrer les paiements
 *      partiels et le « Montant restant » ;
 *    - plusieurs mois d'historique financier, pour que les Rapports et la
 *      courbe des revenus mensuels aient de la matiere sur chaque periode.
 *
 *  Les regles metier ne sont pas simulees : les soldes sont la consequence des
 *  paiements inseres, jamais des valeurs ecrites en dur.
 */

import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import type { Prisma } from '@prisma/client'

// -----------------------------------------------------------------------------
//  PRECAUTION ABSOLUE
// -----------------------------------------------------------------------------

const PORT_DEMO = '5433'
const url = process.env.DATABASE_URL ?? ''

/*
 * SORTIE CONSOLE.
 *
 * Le projet n'autorise pas `console.*` : les scripts ecrivent sur le flux
 * standard (`process.stdout.write`), comme `database/seed.ts`. Ces deux
 * fonctions rendent le script lisible sans introduire de nouveau `console`.
 */
function dire(ligne = ''): void {
  process.stdout.write(ligne + '\n')
}

function avertir(message: string, detail?: string): void {
  process.stderr.write(detail ? `${message} ${detail}\n` : message + '\n')
}

if (new URL(url).port !== PORT_DEMO) {
  avertir(
    `REFUS : ce script ne s'execute que sur le port ${PORT_DEMO} (base de demonstration).\n` +
      `        Port recu : ${new URL(url).port || '(aucun)'}.\n` +
      `        La base de production n'est pas touchee.`,
  )
  process.exit(1)
}

const prisma = new PrismaClient()

// -----------------------------------------------------------------------------
//  DONNEES FICTIVES
// -----------------------------------------------------------------------------

const TYPES = [
  'تركيب الأسنان',
  'تقويم وتنظيف الأسنان',
  'جراحة الأسنان واللثة',
  'علاج تسوس وعصب الأسنان بالأشعة',
] as const

const PRENOMS_F = [
  'Amina', 'Yasmine', 'Sofia', 'Lina', 'Nour', 'Rania', 'Hayet', 'Meriem',
  'Sarah', 'Imene', 'Kenza', 'Aya', 'Nadia', 'Sonia', 'Warda', 'Djamila',
]
const PRENOMS_H = [
  'Yacine', 'Karim', 'Sofiane', 'Amir', 'Nabil', 'Reda', 'Hamza', 'Bilal',
  'Omar', 'Farid', 'Adel', 'Riad', 'Zinedine', 'Mustapha', 'Chaker', 'Lotfi',
]
const NOMS = [
  'Benali', 'Haddad', 'Cherif', 'Meziane', 'Larbi', 'Saidi', 'Bouzid', 'Kaci',
  'Belkacem', 'Hamdani', 'Ziani', 'Benaissa', 'Ferhat', 'Mansouri', 'Ouahab',
  'Yilmaz', 'Ait Ahmed', 'Kessai',
]
const VILLAGES = [
  'Alger Centre', 'Bab Ezzouar', 'Hydra', 'Kouba', 'El Harrach', 'Birkhadem',
  'Chéraga', 'Draria', 'Bologhine', 'Aïn Naadja',
]
const MOTIFS_SANS_RDV = [
  'Première consultation', 'Urgence dentaire', 'Douleur aiguë',
  'Contrôle rapide', 'Accident dentaire',
]
const SEXES = ['FEMININ', 'MASCULIN', 'NON_PRECISE'] as const

/** Tirage pseudo-aleatoire deterministe : deux executions donnent le meme jeu. */
function alea(graine: number): () => number {
  let s = graine
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const rnd = alea(20260928)

/*
 * LECTEUR SEQUENTIEL RESERVABLE.
 *
 * La graine etant FIXE, une partie des rendez-vous generes tombe forcement en
 * chevauchement un jour donne (ex. 25 avril 11h00-11h30 contre 11h15-11h45) :
 * la contrainte `appointments_no_overlap` refuse alors le seed entier sur le
 * cluster de demonstration, pour une collision purement due au calendrier.
 *
 * `entre()` / `choisir()` alimentent les DONNEES affichees : ils consomment
 * donc toujours le generateur (jeu de donnees stable d'une execution a
 * l'autre). Seule la reservation d'un CREANEAU passe par ce second lecteur,
 * qui consomme exactement UN tirage par creneau mais peut le REJOUER : une
 * collision est resolue en tirant un autre creneau, sans deplacer les tirages
 * qui determinent les noms, montants et dates de l'historique.
 */
const reserveur: () => number = alea(1)
const entreReserve = (min: number, max: number): number =>
  min + Math.floor(reserveur() * (max - min + 1))

const choisir = <T,>(liste: readonly T[]): T => liste[Math.floor(rnd() * liste.length)] as T
const entre = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1))

/**
 * Tirage SANS REPETITION IMMEDIATE.
 *
 * Un tirage uniforme sur une petite liste produit des repetitions voisines : sur
 * l'ecran, dix patients s'appelaient « Belkacem » d'affilee, ce qui donne une
 * demonstration trompeuse — on croirait un bug de recherche alors que c'est la
 * generation. On refuse donc de repeter deux fois de suite la meme valeur.
 */
const memoire: Array<string | number> = []
function choisirVariante<T,>(liste: readonly T[]): T {
  for (let essai = 0; essai < 12; essai++) {
    const valeur = choisir(liste)
    const cle = String(valeur)
    if (memoire[memoire.length - 1] !== cle) {
      memoire.push(cle)
      return valeur
    }
  }
  return choisir(liste)
}

function jour(h: number, m = 0): Date {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

function decaleJours(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

/**
 * Date PASSEE, `h` mois en arriere, au jour `m` du mois — CREANEAU seul.
 *
 * Le mois COURANT (`h = 0`) ne produit pas toujours une date passee : au
 * 8 octobre, « le 28 du mois courant » est le 28 octobre, donc DANS LE FUTUR.
 * Or l'appelant s'en sert comme date de PAIEMENT, et la contrainte
 * `payments_date_plausible_check` refuse une date de paiement future : le seed
 * echouait les jours 1 a 27 du mois. On borne donc le mois courant a la date du
 * jour, en conservant l'heure aleatoire.
 *
 * L'heure et la minute sont tirees avec `entreReserve()` : ce lecteur
 * consomme les MÊMES deux tirages, dans le même ordre, que l'ancien `mois()`,
 * mais peut être rejoué en cas de collision de créneau. Le flux de données
 * (`rnd`) reste donc strictement inchangé.
 */
function moisReserve(h: number, m: number): Date {
  const d = new Date()
  const jourBorne = h === 0 ? Math.min(m, d.getDate()) : m
  return new Date(
    d.getFullYear(),
    d.getMonth() - h,
    jourBorne,
    entreReserve(9, 16),
    entreReserve(0, 3) * 15,
    0,
    0,
  )
}

/**
 * CREE UN RENDEZ-VOUS SUR UN CREANEAU LIBRE.
 *
 * `appointments_no_overlap` interdit deux rendez-vous qui se chevauchent pour
 * un meme praticien. Un creneau deja pris n'est PAS un echec : on retire alors
 * un autre creneau, en respectant les regles de la journee
 * (`9h-19h` par pas de 30 minutes dans `espace`, `9h-17h` sinon), puis on
 * rejoue l'insertion. La contrainte est ainsi respectee sans jamais la
 * desactiver ni supprimer de donnee.
 *
 * En cas d'epuisement (50 essais), l'erreur initiale est relancee.
 */
async function creerRendezVousLibre(
  data: Prisma.AppointmentUncheckedCreateInput,
  espace: 'journee' | 'historique' = 'historique',
): Promise<{ id: string }> {
  const DUREE = 30 * 60_000
  const PAS = 30 * 60_000
  let debut = data.dateDebut as Date
  let premiereErreur: unknown

  for (let essai = 1; essai <= 50; essai++) {
    try {
      return await prisma.appointment.create({
        data: { ...data, dateDebut: debut, dateFin: new Date(debut.getTime() + DUREE) },
      })
    } catch (erreur) {
      const message = String((erreur as { message?: string }).message ?? '')
      const collision =
        message.includes('appointments_no_overlap') ||
        message.includes('23P01') ||
        message.includes('P2004')
      if (!collision) throw erreur
      premiereErreur = premiereErreur ?? erreur
      debut = new Date(debut.getTime() + PAS)
      const borneMax = espace === 'journee' ? 19 : 17
      if (debut.getHours() >= borneMax) {
        // Fin de plage : on reprend le lendemain a 9h.
        const suivant = new Date(debut)
        suivant.setDate(suivant.getDate() + 1)
        suivant.setHours(9, 0, 0, 0)
        debut = suivant
      }
    }
  }
  throw premiereErreur
}

/** Numero fictif : prefixe reserved + indicatif, jamais attribuable. */
function telephone(i: number): string {
  return `0550 ${String(100000 + i).slice(0, 6)}`
}

async function main(): Promise<void> {
  dire('=== Donnees de DEMONSTRATION (100% fictives) ===\n')

  // ── Purge de la base de demo ───────────────────────────────────────────────
  //   Seule la base de demonstration est concernee : le port est verifie plus
  //   haut, la connexion ne peut pas pointer ailleurs.
  dire('1. Purge de la base de demonstration…')
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      payment_corrections, payments, prescription_items, prescriptions,
      odontogram_entries, medical_records, documents, treatment_visits,
      appointment_reschedules, appointments, treatments, trash_entries,
      activity_logs, login_attempts, password_reset_tokens, sessions,
      patients, users, settings
    RESTART IDENTITY CASCADE
  `)

  // ── Compte medecin de demonstration ───────────────────────────────────────
  dire('2. Compte medecin de demonstration…')
  const email = process.env.DOCTOR_EMAIL_DEMO ?? 'dr.sahed@demo.cabinet'
  const motDePasse = process.env.DOCTOR_PASSWORD_DEMO ?? 'DemoSahed2026!'
  const nom = process.env.DOCTOR_NAME_DEMO ?? 'Dr Sahed (demonstration)'

  const pepper = process.env.PASSWORD_PEPPER
  const medecin = await prisma.user.create({
    data: {
      email,
      displayName: nom,
      role: 'MEDECIN',
      passwordHash: await argon2.hash(pepper ? `${motDePasse}${pepper}` : motDePasse, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
      isActive: true,
    },
  })

  // ── Patients ──────────────────────────────────────────────────────────────
  dire('3. Patients fictifs…')
  const NB_PATIENTS = 60
  const patients = []
  for (let i = 0; i < NB_PATIENTS; i++) {
    const feminin = rnd() > 0.5
    const prenom = feminin ? choisirVariante(PRENOMS_F) : choisirVariante(PRENOMS_H)
    patients.push(
      await prisma.patient.create({
        data: {
          nom: choisirVariante(NOMS),
          prenom,
          age: entre(19, 68),
          sexe: feminin ? 'FEMININ' : rnd() > 0.5 ? 'MASCULIN' : choisir(SEXES),
          telephone: telephone(i),
          adresse: `${entre(1, 180)}, rue des Freres ${choisir(['Mansouri', 'Didouche Mourad', 'Larbi Ben Mhidi', 'Coluche'])}, ${choisir(VILLAGES)}`,
          notesGenerales: rnd() > 0.7 ? 'Patient de démonstration — dossier fictif.' : null,
        },
      }),
    )
  }

  // ── Historique : consultations passees ─────────────────────────────────────
  //   Cela rend les patients "connus" : sans cela, tous seraient affiches comme
  //   nouveaux et la liste des rendez-vous plans n'aurait aucun sens.
  dire('4. Historique de consultations et paiements…')
  const marqueur = 'Sans rendez-vous'
  let numeroIdempotence = 0
  const cle = (): string => `demo-${(numeroIdempotence++).toString().padStart(6, '0')}`

  for (const patient of patients) {
    const nbConsultations = entre(0, 3)
    for (let c = 0; c < nbConsultations; c++) {
      const h = entre(0, 7)
      const debut = moisReserve(h, entre(1, 28))
      const fin = new Date(debut.getTime() + 30 * 60_000)

      const traitement = await prisma.treatment.create({
        data: {
          patientId: patient.id,
          typeTraitement: choisir(TYPES),
          dents: JSON.stringify([String(entre(11, 48))]),
          prixTotalCentimes: entre(8, 60) * 100_000,
          statut: 'TERMINE',
          dateDebut: debut,
          dateFin: fin,
        },
      })

      // ── Reservation du creneau ──────────────────────────────────────────
      //  Le meme praticien ne peut avoir deux rendez-vous qui se chevauchent
      //  (`appointments_no_overlap`). Une collision est resolue en retirant un
      //  creneau libre, jamais en supprimant le rendez-vous ni en desactivant
      //  la contrainte.
      await creerRendezVousLibre({
        patientId: patient.id,
        praticienId: medecin.id,
        treatmentId: traitement.id,
        dateDebut: debut,
        dateFin: fin,
        statut: 'TERMINE',
      })

      await prisma.treatmentVisit.create({
        data: {
          treatmentId: traitement.id,
          numeroSeance: 1,
          dateDebut: debut,
          dateFin: fin,
          proceduresRealisees: 'Seance de demonstration.',
        },
      })

      // Un tiers du prix est regle : le reste constitue le credit a recevoir.
      await prisma.payment.create({
        data: {
          patientId: patient.id,
          treatmentId: traitement.id,
          montantCentimes: Math.round((traitement.prixTotalCentimes * entre(30, 100)) / 100),
          datePaiement: debut,
          idempotencyKey: cle(),
          createdById: medecin.id,
          statut: 'VALIDE',
        },
      })
    }
  }

  // ── AUJOURD'HUI : ce que le medecin voit en arrivant ───────────────────────
  dire('5. Journee du jour (les deux listes du tableau de bord)…')
  /*
   * Planning de la journee (12 entrees) : 8 rendez-vous planifies de 9h a 16h30,
   * puis l'absent de 8h00, puis 2 patients sans rendez-vous de 17h a 18h30.
   * Chaque creneau est SEPARE du precedent — aucun chevauchement sur un meme
   * praticien, condition imposee par `appointments_no_overlap`.
   */
  const ENTREES_DU_JOUR: ReadonlyArray<{ debut: number; duree: number }> = [
    { debut: 9, duree: 30 },
    { debut: 10, duree: 30 },
    { debut: 11, duree: 30 },
    { debut: 12, duree: 30 },
    { debut: 13, duree: 30 },
    { debut: 14, duree: 30 },
    { debut: 15, duree: 30 },
    { debut: 16, duree: 30 },
    { debut: 8, duree: 30 }, // absent
    { debut: 17, duree: 30 },
    { debut: 18, duree: 30 },
    { debut: 19, duree: 30 },
  ]
  const patientsDuJour = patients.slice(0, 12)
  let index = 0
  for (const patient of patientsDuJour) {
    //  Cles par index : ces rendez-vous ne consomment AUCUN tirage du generateur
    //  (contrairement a `jour`/`entre`), le jeu de donnees reste donc identique.
    //  Les creneaux sont volontairement SEPARES : avant, le rendez-vous
    //  "absent" de 8h00 chevauchait ceux de 9h00-11h30 deja poses, et l'index 9
    //  (11h00) recouvrait le rendez-vous de 11h30 — `appointments_no_overlap`
    //  refusait alors le seed entier.
    const heure = ENTREES_DU_JOUR[index]!.debut
    const debut = jour(heure, 0)
    const fin = jour(heure, ENTREES_DU_JOUR[index]!.duree)

    if (index < 8) {
      // 8 rendez-vous PLANIFIES : c'est le contenu de la premiere liste.
      const termine = index < 6
      const traitement = await prisma.treatment.create({
        data: {
          patientId: patient.id,
          typeTraitement: choisir(TYPES),
          dents: JSON.stringify([String(entre(11, 48))]),
          prixTotalCentimes: entre(10, 80) * 100_000,
          statut: termine ? 'EN_COURS' : 'PLANIFIE',
          dateDebut: debut,
        },
      })
      const rdv = await creerRendezVousLibre(
        {
          patientId: patient.id,
          praticienId: medecin.id,
          treatmentId: traitement.id,
          dateDebut: debut,
          dateFin: fin,
          statut: termine ? 'TERMINE' : 'CONFIRME',
        },
        'journee',
      )
      await prisma.treatmentVisit.create({
        data: {
          treatmentId: traitement.id,
          appointmentId: rdv.id,
          numeroSeance: 1,
          dateDebut: debut,
          dateFin: termine ? fin : null,
        },
      })
      // Le creneau passe le medecin HONORE — sans paiement pour certains, afin
      // que le credit a recevoir ne soit pas nul.
      if (termine) {
        await prisma.payment.create({
          data: {
            patientId: patient.id,
            treatmentId: traitement.id,
            montantCentimes: traitement.prixTotalCentimes,
            datePaiement: debut,
            idempotencyKey: cle(),
            createdById: medecin.id,
            statut: 'VALIDE',
          },
        })
      }
    } else if (index === 8) {
      // Un rendez-vous planifie NON HONORE : il doit apparaitre « N'est pas venu ».
      const debutAbs = jour(ENTREES_DU_JOUR[index]!.debut, 0)
      await creerRendezVousLibre(
        {
          patientId: patient.id,
          praticienId: medecin.id,
          dateDebut: debutAbs,
          dateFin: jour(ENTREES_DU_JOUR[index]!.debut, ENTREES_DU_JOUR[index]!.duree),
          statut: 'ABSENT',
        },
        'journee',
      )
    } else if (index < 11) {
      // 2 patients SANS rendez-vous, dont un vu pour la PREMIERE fois.
      const sansRdv = (await prisma.appointment.count({ where: { patientId: patient.id } })) === 0
      const debut = jour(ENTREES_DU_JOUR[index]!.debut, 0)
      const traitement = await prisma.treatment.create({
        data: {
          patientId: patient.id,
          typeTraitement: choisir(TYPES),
          prixTotalCentimes: entre(5, 40) * 100_000,
          statut: 'EN_COURS',
          dateDebut: debut,
        },
      })
      await creerRendezVousLibre(
        {
          patientId: patient.id,
          praticienId: medecin.id,
          treatmentId: traitement.id,
          dateDebut: debut,
          dateFin: jour(ENTREES_DU_JOUR[index]!.debut, ENTREES_DU_JOUR[index]!.duree),
          motif: `${marqueur} — ${choisir(MOTIFS_SANS_RDV)}`,
          statut: 'TERMINE',
        },
        'journee',
      )
      if (sansRdv) {
        await prisma.payment.create({
          data: {
            patientId: patient.id,
            treatmentId: traitement.id,
            montantCentimes: entre(5, 25) * 100_000,
            datePaiement: debut,
            idempotencyKey: cle(),
            createdById: medecin.id,
          },
        })
      }
    }
    index += 1
  }

  // ── PAIEMENTS PARTIELS : le cas « 20 000 puis 5 000 » ─────────────────────
  dire('6. Traitements partiellement soldes (paiements partiels)…')
  const patientsPartiels = patients.slice(12, 22)
  for (const patient of patientsPartiels) {    const debut = decaleJours(-entre(3, 25))
    const traitement = await prisma.treatment.create({
      data: {
        patientId: patient.id,
        typeTraitement: choisir(TYPES),
        prixTotalCentimes: 20_000 * 100,
        statut: 'EN_COURS',
        dateDebut: debut,
      },
    })
    // Premier versement, puis un second : chaque paiement reste une ecriture
    // distincte, jamais un ecrasement du precedent.
    for (const part of [10_000, 5_000]) {
      await prisma.payment.create({
        data: {
          patientId: patient.id,
          treatmentId: traitement.id,
          montantCentimes: part * 100,
          datePaiement: decaleJours(-entre(0, 6)),
          idempotencyKey: cle(),
          createdById: medecin.id,
          notes: 'Versement partiel — donnee fictive.',
        },
      })
    }
  }

  // ── Rendez-vous a venir : « Nouveaux rendez-vous » du planning ───────────
  dire('7. Rendez-vous a venir…')
  for (let i = 0; i < 14; i++) {
    const couleur = choixStatut()
    const patient = patients[entre(0, NB_PATIENTS - 1)]!
    // Creneaux separes : 9h, 10h, ... 16h sur 14 jours a venir. Une collision
    // (meme jour, meme heure) est rejouee sans consommer de tirage supplementaire.
    const debut = decaleJours(entre(1, 20))
    debut.setHours(entre(9, 16), 0, 0, 0)
    const traitement = await prisma.treatment.create({
      data: {
        patientId: patient.id,
        typeTraitement: choisir(TYPES),
        prixTotalCentimes: entre(6, 50) * 100_000,
        statut: 'PLANIFIE',
        dateDebut: debut,
      },
    })
    // Le creneau est reserve : jour/heure tires ci-dessus sont respectes quand
    // ils sont libres, sinon le premier creneau libre suivant est utilise.
    await creerRendezVousLibre({
      patientId: patient.id,
      praticienId: medecin.id,
      treatmentId: traitement.id,
      dateDebut: debut,
      dateFin: new Date(debut.getTime() + 30 * 60_000),
      statut: couleur,
    })
  }

  // ── Un paiement annule : il ne doit PAS compter dans les totaux ────────────
  //   Il materialise la regle « ne pas compter les paiements invalides ».
  const patientAnnule = patients[30]!
  const traitementAnnule = await prisma.treatment.create({
    data: {
      patientId: patientAnnule.id,
      typeTraitement: choisir(TYPES),
      prixTotalCentimes: 15_000 * 100,
      statut: 'EN_COURS',
      dateDebut: decaleJours(-10),
    },
  })
  await prisma.payment.create({
    data: {
      patientId: patientAnnule.id,
      treatmentId: traitementAnnule.id,
      montantCentimes: 15_000 * 100,
      datePaiement: decaleJours(-10),
      idempotencyKey: cle(),
      createdById: medecin.id,
      statut: 'ANNULE',
      notes: 'Paiement annule — NE DOIT PAS compter dans les encaissements.',
    },
  })

  const [nPatients, nRdv, nTrait, nPaiements] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.treatment.count(),
    prisma.payment.count(),
  ])

  dire('\n=== Base de demonstration prete ===')
  dire(`  patients     : ${nPatients}`)
  dire(`  rendez-vous  : ${nRdv}`)
  dire(`  traitements  : ${nTrait}`)
  dire(`  paiements    : ${nPaiements}`)
  dire(`\n  connexion : ${email} / ${motDePasse}`)
}

function choixStatut(): 'PLANIFIE' | 'CONFIRME' | 'REPROGRAMME' {
  const r = rnd()
  if (r < 0.5) return 'PLANIFIE'
  if (r < 0.85) return 'CONFIRME'
  return 'REPROGRAMME'
}

main()
  .catch((e: unknown) => {
    avertir('Echec de la generation :', e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
