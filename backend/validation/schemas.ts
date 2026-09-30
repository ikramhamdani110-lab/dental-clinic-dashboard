import { z } from 'zod'

import { LONGUEUR_MAX_MOT_DE_PASSE, LONGUEUR_MIN_MOT_DE_PASSE } from '@backend/auth/password'
import {
  estNumeroDentFdiValide,
  TYPES_TRAITEMENT_RENDEZ_VOUS,
} from '@backend/domain/constants'
import { parseMontantEnCentimes } from '@backend/domain/finance'

/**
 * =============================================================================
 *  SCHEMAS DE VALIDATION (§33)
 * =============================================================================
 *
 *  Toute donnee entrante est validee COTE SERVEUR. La validation du navigateur
 *  n'est qu'un confort d'ergonomie : elle ne protege rien, car un client peut
 *  etre contourne.
 *
 *  Les messages sont en francais et destines a l'utilisateur.
 */

// -----------------------------------------------------------------------------
//  PRIMITIVES REUTILISABLES
// -----------------------------------------------------------------------------

/** Texte non vide, espaces superflus retires. */
export const texteRequis = (min: number, max: number, champ: string) =>
  z
    .string({ required_error: `${champ} est obligatoire.` })
    .trim()
    .min(min, `${champ} doit contenir au moins ${min} caractere(s).`)
    .max(max, `${champ} ne peut pas depasser ${max} caracteres.`)

/** Texte optionnel : une chaine vide est normalisee en `null`. */
export const texteOptionnel = (max: number, champ: string) =>
  z
    .string()
    .trim()
    .max(max, `${champ} ne peut pas depasser ${max} caracteres.`)
    .optional()
    .transform((valeur) => (valeur === undefined || valeur === '' ? null : valeur))

/** Email valide, normalise en minuscules, ou `null`. */
export const emailOptionnel = z
  .string()
  .trim()
  .toLowerCase()
  .max(180, "L'adresse email est trop longue.")
  .optional()
  .transform((valeur) => (valeur === undefined || valeur === '' ? null : valeur))
  .refine((valeur) => valeur === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur), {
    message: "L'adresse email n'est pas valide.",
  })

export const emailRequis = z
  .string({ required_error: "L'adresse email est obligatoire." })
  .trim()
  .toLowerCase()
  .min(1, "L'adresse email est obligatoire.")
  .max(180, "L'adresse email est trop longue.")
  .refine((valeur) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur), {
    message: "L'adresse email n'est pas valide.",
  })

/**
 * Telephone : on accepte les formats usuels (espaces, tirets, indicatif
 * international) mais on exige au moins 6 chiffres significatifs. Le telephone
 * est un mode de recherche du patient (§7) : un numero fantaisiste rendrait la
 * fiche introuvable.
 */
export const telephone = z
  .string({ required_error: 'Le telephone est obligatoire.' })
  .trim()
  .min(1, 'Le telephone est obligatoire.')
  .max(30, 'Le telephone est trop long.')
  .refine((valeur) => valeur.replace(/\D/g, '').length >= 6, {
    message: 'Le telephone doit contenir au moins 6 chiffres.',
  })

export const telephoneOptionnel = z
  .string()
  .trim()
  .max(30, 'Le telephone est trop long.')
  .optional()
  .transform((valeur) => (valeur === undefined || valeur === '' ? null : valeur))
  .refine((valeur) => valeur === null || valeur.replace(/\D/g, '').length >= 6, {
    message: 'Le telephone doit contenir au moins 6 chiffres.',
  })

/** Date ISO acceptee depuis un formulaire HTML ou une requete JSON. */
export const dateIso = z
  .string()
  .trim()
  .min(1, 'La date est obligatoire.')
  .refine((valeur) => !Number.isNaN(Date.parse(valeur)), { message: 'La date est invalide.' })
  .transform((valeur) => new Date(valeur))

export const dateIsoOptionnelle = z
  .string()
  .trim()
  .optional()
  .transform((valeur) => (valeur === undefined || valeur === '' ? null : valeur))
  .refine((valeur) => valeur === null || !Number.isNaN(Date.parse(valeur)), {
    message: 'La date est invalide.',
  })
  .transform((valeur) => (valeur === null ? null : new Date(valeur)))

/**
 * AGE DU PATIENT — saisie DIRECTE, en annees revolues.
 *
 *  POURQUOI L'AGE EST SAISI ET NON PLUS LA DATE DE NAISSANCE
 *
 *    Le cabinet enregistre l'age du patient, pas sa date de naissance : c'est
 *    la demande explicite du medecin, et la date de naissance n'est PAS un champ
 *    du formulaire. Refuser l'age faute de date de naissance rendait donc la
 *    creation d'un patient impossible a completer.
 *
 *  VALEUR
 *    - `null` / `""` / champ absent : age NON RENSEIGNE (champ facultatif).
 *    - Entier entre 0 et 130 : age accepte tel quel.
 *
 *  CEUI EST REFUSE, ET POURQUOI
 *    - Une valeur non numerique (« vingt », « 24a ») : erreur de saisie.
 *    - Un nombre decimal (24,5) : un age se compte en annees revolues.
 *    - Un negatif ou un age au-dela de la limite de plausibilite : erreur de
 *      saisie manifeste, signalee en francais plutot qu'enregistree.
 *
 *  Le message est formule pour le medecin, pas pour un developpeur : il indique
 *  ce qui est attendu, avec un exemple (voir §33 : validation lisible).
 */
export const agePatient = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((valeur) => {
    // Champ absent, vide ou null : age non renseigne.
    if (valeur === undefined || valeur === null) return null
    if (typeof valeur === 'string') {
      const nettoye = valeur.trim()
      return nettoye === '' ? null : nettoye
    }
    return valeur
  })
  .refine(
    (valeur) => {
      // Champ non renseigne : rien a verifier.
      if (valeur === null) return true
      // Nombre deja exploitable (le formulaire peut envoyer un entier).
      if (typeof valeur === 'number') return Number.isInteger(valeur) && valeur >= 0 && valeur <= 130
      // Chaine : on n'accepte qu'un entier d'annees, sans separateur ni unite.
      // Le `typeof` explicite est indispensable : apres le test ci-dessus,
      // TypeScript ne sait pas encore que la valeur est une chaine.
      return /^\d+$/.test(valeur.trim())
    },
    { message: "L'age doit etre un nombre entier d'annees, par exemple 24." },
  )
  .transform((valeur) => (valeur === null ? null : typeof valeur === 'number' ? valeur : Number.parseInt(valeur, 10)))
  .refine((valeur) => valeur === null || (Number.isInteger(valeur) && valeur >= 0 && valeur <= 130), {
    message: "L'age doit etre un nombre entier compris entre 0 et 130 ans.",
  })

/**
 * Date de naissance : doit etre dans le passe et rester plausible.
 * Une date dans le futur ou anterieure a 1900 signale une erreur de saisie.
 *
 * ATTENTION — ce validateur n'est PLUS utilise par le formulaire de patient (le
 * champ a disparu de l'interface). Il reste necessaire pour les IMPORTATIONS et
 * pour les donnees deja en base : une date de naissance correctement fournie
 * doit rester acceptee.
 */
export const dateNaissance = z
  .string()
  .trim()
  .optional()
  .transform((valeur) => (valeur === undefined || valeur === '' ? null : valeur))
  .refine((valeur) => valeur === null || !Number.isNaN(Date.parse(valeur)), {
    message: 'La date de naissance est invalide.',
  })
  .transform((valeur) => (valeur === null ? null : new Date(valeur)))
  .refine((valeur) => valeur === null || valeur.getTime() <= Date.now(), {
    message: 'La date de naissance ne peut pas etre dans le futur.',
  })
  .refine((valeur) => valeur === null || valeur.getFullYear() >= 1900, {
    message: 'La date de naissance est invalide.',
  })

/**
 * Montant saisi en DINARS -> centimes entiers.
 * Accepte « 15000 », « 15 000 », « 15000,50 ». Refuse negatif, zero, non numerique.
 *
 * POINT CRITIQUE — UNITE DE L'ENTREE
 *
 *   Ce validateur recoit des DINARS (l'utilite `parseMontantEnCentimes` fait la
 *   conversion × 100). Il ne doit donc JAMAIS etre applique a un montant deja
 *   exprime en centimes : le resultat serait multiplie par 100 en silence.
 *
 *   Les schemas destines a un corps d'API qui transporte des CENTIMES (comme
 *   `paiementCreationSchema`, dont le champ s'appelle justement
 *   `montantCentimes`) doivent utiliser `centimesEntiers` ci-dessous.
 */
export const montantCentimes = (options: { strictementPositif: boolean }) =>
  z
    .union([z.string(), z.number()])
    .transform((valeur) =>
      typeof valeur === 'number' ? valeur.toFixed(2).replace('.', ',') : valeur,
    )
    .superRefine((valeur, ctx) => {
      const centimes = parseMontantEnCentimes(valeur)
      if (centimes === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le montant saisi est invalide. Utilisez un nombre, par exemple 15000.',
        })
        return
      }
      if (options.strictementPositif && centimes <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le montant doit etre superieur a zero.',
        })
      }
      if (!options.strictementPositif && centimes < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le montant ne peut pas etre negatif.',
        })
      }
    })
    .transform((valeur) => parseMontantEnCentimes(valeur) ?? 0)

/**
 * Montant DEJA exprime en CENTIMES entiers.
 *
 * A utiliser pour tout corps d'API dont le champ transporte des centimes (par
 * exemple `montantCentimes` de la creation de paiement). Aucune conversion n'est
 * appliquee : la valeur est prise telle quelle, apres verification qu'il s'agit
 * bien d'un entier positif et raisonnable.
 *
 * POURQUOI CETTE DISTINCTION EST INDISPENSABLE
 *
 *   Le formulaire de paiement envoie `montantCentimes: "5000"`. Avec l'ancien
 *   validateur (celui des dinars), 5000 etait interprete comme 5000 DINARS puis
 *   multiplie par 100, soit 500 000 centimes. Le paiement depassait alors
 *   presque toujours le prix du traitement, et le serveur repondait
 *   « Ce paiement depasserait le prix total du traitement… » : le medecin ne
 *   pouvait plus encaisser. La borne haute ci-dessous protege en outre des
 *   saisies manifestement erronees.
 */
export const centimesEntiers = (options: { strictementPositif: boolean }) =>
  z.coerce
    .number({ invalid_type_error: 'Le montant doit etre un nombre.' })
    .refine((valeur) => Number.isInteger(valeur), {
      message: 'Le montant doit etre un nombre entier de centimes.',
    })
    .refine((valeur) => (options.strictementPositif ? valeur > 0 : valeur >= 0), {
      message: options.strictementPositif
        ? 'Le montant doit etre superieur a zero.'
        : 'Le montant ne peut pas etre negatif.',
    })
    .refine((valeur) => valeur <= 100_000_000_00, {
      message: 'Le montant saisi est trop eleve.',
    })

/** Numero de dent FDI. */
export const numeroDentFdi = z.string().trim().refine(estNumeroDentFdiValide, {
  message: 'Le numero de dent doit etre un code FDI a deux chiffres (ex. 36).',
})

/** Liste de dents FDI, dedupliquee, bornee. */
export const listeDents = z
  .array(numeroDentFdi)
  .max(32, 'Le nombre de dents ne peut pas depasser 32.')
  .transform((dents) => Array.from(new Set(dents)))

/** Identifiant interne (UUID) transmis dans une URL ou un corps de requete. */
export const identifiant = z.string().uuid("L'identifiant est invalide.")

/** Pagination (accepte chaines de requete). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  taille: z.coerce.number().int().min(1).max(100).default(25),
})

// -----------------------------------------------------------------------------
//  ENUMERATIONS (miroir du domaine — validees dans les deux environnements)
// -----------------------------------------------------------------------------
//
//  Sous PostgreSQL ces valeurs sont des types ENUM : la base refuse une valeur
//  hors domaine. Ces schemas verifient le domaine a l'entree de l'application,
//  ce qui produit un message francais clair AVANT que la base ne rejette la
//  valeur. Les deux defenser coexistent volontairement (§33).

export const sexeSchema = z.enum(['MASCULIN', 'FEMININ', 'NON_PRECISE'])
export const statutTraitementSchema = z.enum(['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'])
export const statutRendezVousSchema = z.enum([
  'PLANIFIE',
  'CONFIRME',
  'EN_ATTENTE',
  'EN_COURS',
  'TERMINE',
  'ANNULE',
  'ABSENT',
  'REPROGRAMME',
])
export const methodePaiementSchema = z.enum(['ESPECES', 'CARTE', 'VIREMENT', 'AUTRE'])
export const statutPaiementSchema = z.enum(['VALIDE', 'ANNULE'])
export const etatDentSchema = z.enum([
  'SAINE',
  'CARIE',
  'OBTUREE',
  'ABSENTE',
  'COURONNE',
  'DEVITALISEE',
  'EXTRACTION_PREVUE',
  'IMPLANT',
  'AUTRE',
])
export const typeCorrectionPaiementSchema = z.enum([
  'ANNULATION',
  'CORRECTION_MONTANT',
  'CORRECTION_ATTRIBUT',
])

// -----------------------------------------------------------------------------
//  AUTHENTIFICATION
// -----------------------------------------------------------------------------

export const connexionSchema = z.object({
  email: emailRequis,
  password: z
    .string({ required_error: 'Le mot de passe est obligatoire.' })
    .min(1, 'Le mot de passe est obligatoire.')
    .max(LONGUEUR_MAX_MOT_DE_PASSE, 'Le mot de passe est trop long.'),
})

export const changementMotDePasseSchema = z
  .object({
    ancienMotDePasse: z.string().min(1, 'Le mot de passe actuel est obligatoire.'),
    nouveauMotDePasse: z
      .string()
      .min(
        LONGUEUR_MIN_MOT_DE_PASSE,
        `Le nouveau mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caracteres.`,
      )
      .max(LONGUEUR_MAX_MOT_DE_PASSE, 'Le mot de passe est trop long.'),
    confirmation: z.string(),
  })
  .refine((data) => data.nouveauMotDePasse === data.confirmation, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmation'],
  })

// -----------------------------------------------------------------------------
//  PATIENTS (§9)
// -----------------------------------------------------------------------------

export const patientCreationSchema = z.object({
  nom: texteRequis(1, 120, 'Le nom'),
  prenom: texteRequis(1, 120, 'Le prenom'),
  /**
   * Age en annees revolues, SAISI par le medecin. C'est la donnee de reference
   * de l'age du patient (voir `agePatient`).
   */
  age: agePatient,
  /**
   * Date de naissance : CONSERVEE pour les donnees deja en base et les
   * importations, mais PLUS demandee par le formulaire.
   */
  dateNaissance,
  sexe: sexeSchema.default('NON_PRECISE'),
  telephone,
  telephoneSecondaire: telephoneOptionnel,
  adresse: texteOptionnel(300, "L'adresse"),
  email: emailOptionnel,
  allergies: texteOptionnel(2000, 'Les allergies'),
  antecedentsMedicaux: texteOptionnel(4000, 'Les antecedents medicaux'),
  medicamentsActuels: texteOptionnel(2000, 'Les medicaments actuels'),
  contactUrgence: texteOptionnel(300, "Le contact d'urgence"),
  notesGenerales: texteOptionnel(4000, 'Les notes generales'),
})

/** Modification : tous les champs sont optionnels, mais valides s'ils sont fournis. */
export const patientModificationSchema = patientCreationSchema.partial()

// -----------------------------------------------------------------------------
//  RENDEZ-VOUS (§14, §15)
// -----------------------------------------------------------------------------

export const rendezVousCreationSchema = z
  .object({
    patientId: identifiant,
    dateDebut: dateIso,
    dateFin: dateIso,
    praticienId: identifiant.optional().nullable(),
    treatmentId: identifiant.optional().nullable(),
    dents: listeDents.default([]),
    motif: texteOptionnel(300, 'Le motif'),
    notes: texteOptionnel(4000, 'Les notes'),
    statut: statutRendezVousSchema.default('PLANIFIE'),
    motifStatut: texteOptionnel(300, 'Le motif de statut'),
  })
  .refine((data) => data.dateFin.getTime() > data.dateDebut.getTime(), {
    message: "L'heure de fin doit etre posterieure a l'heure de debut.",
    path: ['dateFin'],
  })
  .refine((data) => data.dateFin.getTime() - data.dateDebut.getTime() <= 12 * 60 * 60 * 1000, {
    message: 'La duree du rendez-vous ne peut pas depasser 12 heures.',
    path: ['dateFin'],
  })

/** Payload du nouveau formulaire, sans heure ni duree saisies par le medecin. */
export const rendezVousFormCreationSchema = z
  .object({
    patientId: identifiant,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Indiquez une date valide.')
      .refine((value) => {
        const [annee, mois, jour] = value.split('-').map(Number)
        const date = new Date(annee ?? 0, (mois ?? 1) - 1, jour ?? 0)
        return date.getFullYear() === annee && date.getMonth() === (mois ?? 1) - 1 && date.getDate() === jour
      }, 'Indiquez une date valide.'),
    typeTraitement: z.enum(TYPES_TRAITEMENT_RENDEZ_VOUS),
    totalCentimes: centimesEntiers({ strictementPositif: false }),
    payeCentimes: centimesEntiers({ strictementPositif: false }),
    notes: texteOptionnel(4000, 'Les notes'),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .refine((data) => data.payeCentimes <= data.totalCentimes, {
    message: 'Le montant payé ne peut pas dépasser le total.',
    path: ['payeCentimes'],
  })

export const rendezVousModificationSchema = z
  .object({
    dateDebut: dateIso.optional(),
    dateFin: dateIso.optional(),
    praticienId: identifiant.optional().nullable(),
    treatmentId: identifiant.optional().nullable(),
    dents: listeDents.optional(),
    motif: texteOptionnel(300, 'Le motif').optional(),
    notes: texteOptionnel(4000, 'Les notes').optional(),
    statut: statutRendezVousSchema.optional(),
    motifStatut: texteOptionnel(300, 'Le motif de statut').optional(),
  })
  .refine(
    (data) =>
      data.dateDebut === undefined ||
      data.dateFin === undefined ||
      data.dateFin.getTime() > data.dateDebut.getTime(),
    { message: "L'heure de fin doit etre posterieure a l'heure de debut.", path: ['dateFin'] },
  )

/**
 * Enregistrement d'une VISITE SANS RENDEZ-VOUS.
 *
 * Le patient s'est presente au cabinet sans creneau planifie. Seuls le motif de
 * consultation et, facultativement, l'heure d'arrivee sont demandes : le reste
 * (heure de fin, statut) est determine par le service, qui applique le marqueur
 * identifiant la visite non planifiee.
 */
export const visiteSansRendezVousSchema = z.object({
  patientId: identifiant,
  motifConsultation: texteRequis(1, 250, 'Le motif de la consultation'),
  dateDebut: dateIso.optional(),
})

export const reprogrammationSchema = z
  .object({
    dateDebut: dateIso,
    dateFin: dateIso,
    motif: texteOptionnel(500, 'Le motif de la reprogrammation'),
  })
  .refine((data) => data.dateFin.getTime() > data.dateDebut.getTime(), {
    message: "L'heure de fin doit etre posterieure a l'heure de debut.",
    path: ['dateFin'],
  })

// -----------------------------------------------------------------------------
//  TRAITEMENTS (§12) ET VISITES (§13)
// -----------------------------------------------------------------------------

export const traitementCreationSchema = z.object({
  patientId: identifiant,
  typeTraitement: texteRequis(1, 160, 'Le type de traitement'),
  dents: listeDents.default([]),
  diagnostic: texteOptionnel(4000, 'Le diagnostic'),
  description: texteOptionnel(4000, 'La description'),
  prixTotalCentimes: montantCentimes({ strictementPositif: false }),
  statut: statutTraitementSchema.default('PLANIFIE'),
  dateDebut: dateIsoOptionnelle,
  dateFin: dateIsoOptionnelle,
  notes: texteOptionnel(4000, 'Les notes'),
})

export const traitementModificationSchema = traitementCreationSchema
  .omit({ patientId: true })
  .partial()
  .refine(
    (data) =>
      data.dateDebut === undefined ||
      data.dateDebut === null ||
      data.dateFin === undefined ||
      data.dateFin === null ||
      data.dateFin.getTime() >= data.dateDebut.getTime(),
    { message: 'La date de fin ne peut pas preceder la date de debut.', path: ['dateFin'] },
  )

export const visiteCreationSchema = z
  .object({
    treatmentId: identifiant,
    dateDebut: dateIso,
    dateFin: dateIsoOptionnelle,
    notes: texteOptionnel(4000, 'Les notes'),
    proceduresRealisees: texteOptionnel(4000, 'Les procedures realisees'),
    appointmentId: identifiant.optional().nullable(),
  })
  .refine((data) => data.dateFin === null || data.dateFin.getTime() > data.dateDebut.getTime(), {
    message: "L'heure de fin doit etre posterieure a l'heure de debut.",
    path: ['dateFin'],
  })

// -----------------------------------------------------------------------------
//  PAIEMENTS (§16, §17)
// -----------------------------------------------------------------------------

export const paiementCreationSchema = z.object({
  patientId: identifiant,
  treatmentId: identifiant,
  treatmentVisitId: identifiant.optional().nullable(),
  montantCentimes: centimesEntiers({ strictementPositif: true }),
  datePaiement: dateIso,
  /**
   * Methode de paiement : FACULTATIVE cote API.
   *
   * L'interface ne demande plus au medecin la methode d'encaissement (§16) : le
   * champ disparait de l'ecran. La colonne reste neanmoins presente en base avec
   * une valeur par defaut, car sa suppression constituerait une migration
   * destructrice inutile. Un client qui omet le champ recoit donc la valeur par
   * defaut du schema Prisma.
   */
  methode: methodePaiementSchema.optional(),
  notes: texteOptionnel(2000, 'Les notes'),
  /**
   * Cle d'idempotence : empeche la double soumission au niveau BASE (contrainte
   * d'unicite). Le navigateur en genere une par soumission ; un renvoi du meme
   * formulaire reutilise la meme cle et ne cree pas de doublon.
   */
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "La cle d'idempotence est invalide.")
    .max(120, "La cle d'idempotence est invalide."),
})

export const correctionPaiementSchema = z
  .object({
    type: typeCorrectionPaiementSchema,
    motif: texteRequis(3, 500, 'Le motif de la correction'),
    nouveauMontantCentimes: montantCentimes({ strictementPositif: true }).optional(),
    nouvelleMethode: methodePaiementSchema.optional(),
    nouvelleDate: dateIso.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'CORRECTION_MONTANT' && data.nouveauMontantCentimes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Le nouveau montant est obligatoire pour une correction de montant.',
        path: ['nouveauMontantCentimes'],
      })
    }
    if (
      data.type === 'CORRECTION_ATTRIBUT' &&
      data.nouvelleMethode === undefined &&
      data.nouvelleDate === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Indiquez au moins une nouvelle valeur (methode ou date) a corriger.',
        path: ['nouvelleMethode'],
      })
    }
  })

// -----------------------------------------------------------------------------
//  DOSSIER MEDICAL (§19)
// -----------------------------------------------------------------------------

export const dossierMedicalCreationSchema = z.object({
  patientId: identifiant,
  treatmentId: identifiant.optional().nullable(),
  date: dateIso,
  motifPlainte: texteOptionnel(4000, 'Le motif'),
  examen: texteOptionnel(6000, "L'examen"),
  diagnostic: texteOptionnel(6000, 'Le diagnostic'),
  traitementRealise: texteOptionnel(6000, 'Le traitement realise'),
  observations: texteOptionnel(6000, 'Les observations'),
  recommandations: texteOptionnel(6000, 'Les recommandations'),
  dateSuivi: dateIsoOptionnelle,
})

// -----------------------------------------------------------------------------
//  ORDONNANCES (§21)
// -----------------------------------------------------------------------------

export const ligneOrdonnanceSchema = z.object({
  medicament: texteRequis(1, 200, 'Le medicament'),
  dosage: texteRequis(1, 120, 'Le dosage'),
  frequence: texteRequis(1, 120, 'La frequence'),
  duree: texteRequis(1, 120, 'La duree'),
  instructions: texteOptionnel(1000, 'Les instructions'),
  notes: texteOptionnel(1000, 'Les notes'),
})

export const ordonnanceCreationSchema = z.object({
  patientId: identifiant,
  treatmentId: identifiant.optional().nullable(),
  date: dateIso,
  notes: texteOptionnel(2000, 'Les notes'),
  lignes: z
    .array(ligneOrdonnanceSchema)
    .min(1, 'Ajoutez au moins un medicament a l’ordonnance.')
    .max(30, 'Une ordonnance ne peut pas contenir plus de 30 lignes.'),
})

// -----------------------------------------------------------------------------
//  ODONTOGRAMME (§20)
// -----------------------------------------------------------------------------

export const odontogrammeEntreeSchema = z.object({
  patientId: identifiant,
  treatmentId: identifiant.optional().nullable(),
  numeroDent: numeroDentFdi,
  etat: etatDentSchema,
  commentaire: texteOptionnel(1000, 'Le commentaire'),
  date: dateIso,
})

// -----------------------------------------------------------------------------
//  PARAMETRES (§28)
// -----------------------------------------------------------------------------

export const parametresSchema = z.object({
  nomClinique: texteOptionnel(160, 'Le nom de la clinique'),
  adresseClinique: texteOptionnel(300, "L'adresse de la clinique"),
  telephoneClinique: telephoneOptionnel,
  emailClinique: emailOptionnel,
  siteWeb: texteOptionnel(300, 'Le site web'),
  nomMedecin: texteOptionnel(160, 'Le nom du medecin'),
  specialite: texteOptionnel(160, 'La specialite'),
  numeroOrdre: texteOptionnel(80, "Le numero d'ordre"),
  horaires: texteOptionnel(2000, 'Les horaires'),
})

// -----------------------------------------------------------------------------
//  UTILITAIRE : conversion des erreurs Zod en erreurs de champ francaises
// -----------------------------------------------------------------------------

export interface ErreurChamp {
  champ: string
  message: string
}

/** Transforme une erreur Zod en liste de champs, SANS exposer de details internes. */
export function versErreursChamps(error: z.ZodError): ErreurChamp[] {
  return error.issues.map((issue) => ({
    champ: issue.path.join('.') || 'general',
    message: issue.message,
  }))
}
