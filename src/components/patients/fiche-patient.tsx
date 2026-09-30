'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

import { t, contenu } from '@content/index'
import { formaterMontant } from '@backend/domain/finance'

import { BadgeSolde, BadgeStatutPaiement, BadgeStatutRendezVous } from '@/components/ui/badge-statut'
import { LienBouton } from '@/components/ui/bouton'
import { FormulairePaiementPatient } from '@/components/patients/formulaire-paiement-patient'
import { Pagination } from '@/components/patients/liste-patients'
import { formaterAgePatient } from '@/lib/age'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  FICHE PATIENT — ESPACE DE TRAVAIL CENTRAL (§10)
 * =============================================================================
 *
 *  TROIS SECTIONS :
 *
 *    1. Informations personnelles — l'identite administrative du patient ;
 *    2. Rendez-vous — l'historique des rendez-vous, chacun accompagne du
 *       traitement lie et de son solde (total, paye, reste) ;
 *    3. Paiements — l'historique FINANCIER reel du patient : chaque versement
 *       enregistre, avec le resume Total / Total paye / Reste a payer.
 *
 *  L'enregistrement d'un paiement reste disponible depuis l'en-tete : le
 *  medecin peut encaisser sans quitter la fiche, et le solde se met a jour.
 *
 *  Rappel (§48) : l'identifiant interne figure dans l'URL mais n'est JAMAIS
 *  affiche a l'ecran.
 */

interface Patient {
  id: string
  nom: string
  prenom: string
  /**
   * Age en annees revolues, saisi au cabinet. `null` si non renseigne :
   * l'affichage retombe alors sur l'age derive de la date de naissance.
   */
  age: number | null
  /**
   * Conservee pour les patients anterieurs a la saisie de l'age. Elle n'est
   * JAMAIS affichee : seul l'age qui en est derive l'est.
   */
  dateNaissance: string | null
  sexe: string
  telephone: string
  adresse: string | null
  notesGenerales: string | null
  createdAt: string
  updatedAt: string
}

interface Solde {
  totalTraitementsCentimes: number
  totalPayeCentimes: number
  resteAPayerCentimes: number
  nombreTraitements: number
  nombreTraitementsEnCours: number
}

/**
 * Un rendez-vous, tel que renvoye par l'API de la fiche patient.
 *
 * `traitement` est nul pour un rendez-vous sans traitement associe (controle,
 * consultation simple) : l'interface affiche alors un tiret, jamais un montant
 * invente.
 */
interface RendezVous {
  id: string
  dateDebut: string
  dateFin: string
  statut: string
  motif: string | null
  traitement: {
    id: string
    typeTraitement: string
    prixTotalCentimes: number
    montantPayeCentimes: number
    resteAPayerCentimes: number
    statut: string
  } | null
}

/**
 * Un versement du patient, tel que renvoye par `/api/patients/:id/payments`.
 *
 * Une ligne = UNE transaction. Les reglements successifs restent des lignes
 * distinctes : c'est ce qui permet de lire l'historique de l'encaissement
 * plutot qu'un simple solde final.
 */
interface PaiementPatient {
  id: string
  montantCentimes: number
  datePaiement: string
  statut: string
  /** Traitement rattache ; absent pour un versement libre. */
  treatment: { typeTraitement: string } | null
}

interface ReponsePaiementsPatient {
  paiements: PaiementPatient[]
  total: number
  page: number
  pages: number
}

/** Onglets de la fiche : le parcours quotidien, rien de plus. */
const ONGLETS = ['informationsPersonnelles', 'rendezVous', 'paiements'] as const

type Onglet = (typeof ONGLETS)[number]

export function FichePatient({ patientId }: { patientId: string }): React.JSX.Element {
  const [ongletActif, setOngletActif] = useState<Onglet>('informationsPersonnelles')
  /**
   * Incremente apres chaque « Ajouter un paiement » pour que l'onglet
   * Paiements recharge sa liste. La fiche elle-meme est rechargee par le meme
   * gesture (`recharger`), donc le resume et les versements restent alignes.
   */
  const [rafraichissementPaiements, setRafraichissementPaiements] = useState(0)

  const { donnees, chargement, erreur, recharger } = useRequete<{ patient: Patient; solde: Solde }>(
    `/api/patients/${patientId}`,
  )

  /**
   * Appele apres un « Ajouter un paiement » : la fiche se recharge (nouveau
   * solde) ET l'onglet Paiements recharge sa liste. Les deux vont ensemble,
   * sinon le resume et les versements afficheraient deux etats differents.
   */
  const rafraichirApresPaiement = useCallback(() => {
    recharger()
    setRafraichissementPaiements((valeur) => valeur + 1)
  }, [recharger])

  if (chargement) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (erreur || !donnees) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{erreur ?? t('erreurs.introuvable')}</p>
        <Link href="/patients" className="bouton-lien">
          {t('commun.retour')}
        </Link>
      </div>
    )
  }

  const { patient, solde } = donnees

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/patients">{t('patients.titre')}</Link>
        <span aria-hidden="true">/</span>
        <span>
          {patient.prenom} {patient.nom}
        </span>
      </nav>

      {/* En-tete de fiche : identite + solde + actions rapides */}
      <section className="carte">
        <div className="carte-corps">
          <div className="en-tete-fiche">
            <div className="en-tete-fiche-identite">
              <h2 className="en-tete-fiche-nom">
                {patient.prenom} {patient.nom}
              </h2>
              <div className="en-tete-fiche-meta">
                <span>{patient.telephone}</span>
                <span>{formaterAgePatient(patient)}</span>
              </div>
            </div>

            {solde.resteAPayerCentimes > 0 ? (
              <div className="encadre-avertissement">
                {t('traitements.resteAPayer')} : {formaterMontant(solde.resteAPayerCentimes)}
              </div>
            ) : (
              <BadgeSolde resteCentimes={solde.resteAPayerCentimes} />
            )}
          </div>

          {/* Resume financier : calcule en base, jamais stocke (§12) */}
          <div className="grille-solde" style={{ marginTop: 'var(--espace-5)' }}>
            <div className="solde-element">
              <span className="solde-etiquette">{t('patients.totalTraitements')}</span>
              <span className="solde-valeur">
                {formaterMontant(solde.totalTraitementsCentimes)}
              </span>
            </div>
            <div className="solde-element">
              <span className="solde-etiquette">{t('patients.totalPaye')}</span>
              <span className="solde-valeur solde-valeur-solde">
                {formaterMontant(solde.totalPayeCentimes)}
              </span>
            </div>
            <div className="solde-element">
              <span className="solde-etiquette">{t('patients.resteAPayer')}</span>
              <span
                className={`solde-valeur ${solde.resteAPayerCentimes > 0 ? 'solde-valeur-attention' : 'solde-valeur-solde'}`}
              >
                {formaterMontant(solde.resteAPayerCentimes)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Actions rapides (§10) : pre-remplissent le patient pour eviter la double saisie */}
      <section aria-label={t('fichePatient.actionsRapides')}>
        <div className="actions-rapides">
          <LienBouton
            href={`/rendez-vous/nouveau?patientId=${patient.id}`}
            variante="principal"
            taille="petite"
          >
            {t('fichePatient.nouveauRendezVous')}
          </LienBouton>
          {/* Le reglement se fait ICI, depuis la fiche du patient (§16). */}
          <FormulairePaiementPatient patientId={patient.id} onPaiementEnregistre={rafraichirApresPaiement} />
          <LienBouton href={`/patients/${patient.id}/modifier`} variante="discret" taille="petite">
            {t('commun.modifier')}
          </LienBouton>
        </div>
      </section>

      {/* Onglets : deux sections seulement */}
      <div className="onglets" role="tablist" aria-label={t('patients.fiche')}>
        {ONGLETS.map((onglet) => (
          <button
            key={onglet}
            type="button"
            role="tab"
            id={`onglet-${onglet}`}
            aria-selected={ongletActif === onglet}
            aria-controls={`panneau-${onglet}`}
            tabIndex={ongletActif === onglet ? 0 : -1}
            className="onglet"
            onClick={() => setOngletActif(onglet)}
          >
            {t(`fichePatient.${onglet}`)}
          </button>
        ))}
      </div>

      <section
        role="tabpanel"
        id={`panneau-${ongletActif}`}
        aria-labelledby={`onglet-${ongletActif}`}
        className="carte"
      >
        <div className="carte-corps">
          {ongletActif === 'informationsPersonnelles' ? (
            <InformationsPersonnelles patient={patient} />
          ) : ongletActif === 'rendezVous' ? (
            <OngletRendezVous patientId={patient.id} />
          ) : (
            <OngletPaiements
              patientId={patient.id}
              solde={solde}
              rafraichissement={rafraichissementPaiements}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function InformationsPersonnelles({ patient }: { patient: Patient }): React.JSX.Element {
  //
  // SECTION « INFORMATIONS PERSONNELLES » — PERIMETRE VOLONTAIREMENT RESTREINT.
  //
  //  Nom, prenom, age, sexe, telephone, adresse (facultative) et notes
  //  generales. C'est tout.
  //
  //  La DATE DE NAISSANCE n'apparait nulle part : l'age qui en est derive la
  //  remplace, et reste la seule donnee affichee.
  //
  //  EMAIL : retire de l'interface. La colonne existe toujours en base et est
  //  conservee pour les patients qui en ont un.
  //
  //  ANTECEDENTS MEDICAUX (allergies, antecedents, medicaments actuels, contact
  //  d'urgence) : section retiree de la fiche. Les donnees deja saisies restent
  //  en base, intactes.
  //
  const champs: Array<{ terme: string; valeur: string | null }> = [
    { terme: t('patients.nom'), valeur: patient.nom },
    { terme: t('patients.prenom'), valeur: patient.prenom },
    { terme: t('patients.age'), valeur: formaterAgePatient(patient) },
    {
      terme: t('patients.sexe'),
      valeur: contenu.patients.sexes[patient.sexe as keyof typeof contenu.patients.sexes] ?? null,
    },
    { terme: t('patients.telephone'), valeur: patient.telephone },
    { terme: t('patients.adresse'), valeur: patient.adresse },
    { terme: t('patients.notesGenerales'), valeur: patient.notesGenerales },
  ]

  return (
    <dl className="liste-definitions">
      {champs.map((champ) => (
        <div key={champ.terme} className="liste-definitions-item">
          <dt className="liste-definitions-terme">{champ.terme}</dt>
          <dd
            className={
              champ.valeur
                ? 'liste-definitions-valeur'
                : 'liste-definitions-valeur liste-definitions-valeur-vide'
            }
          >
            {champ.valeur ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Rendez-vous du patient, avec le traitement lie et son solde.
 *
 * CHAQUE LIGNE REPOND A LA QUESTION DU MEDECIN : « qu'a-t-on fait ce jour-la,
 * et ou en est le paiement ? »
 *
 *   Date · Traitement · Total · Paye · Reste
 *
 * Le NUMERO DE DENT n'est pas affiche : il alourdissait la lecture sans servir
 * a la conversation avec le patient.
 *
 * Les montants proviennent des PAIEMENTS REELS, agreges cote service par le
 * meme helper que la liste des traitements. Le reste a payer est CALCULE, jamais
 * stocke (§12).
 */
function OngletRendezVous({ patientId }: { patientId: string }): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { donnees, chargement, erreur, recharger } = useRequete<{
    rendezVous: RendezVous[]
    total: number
    page: number
    pages: number
  }>(`/api/patients/${patientId}/appointments?page=${page}&taille=25`)

  if (chargement && !donnees) return <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
  if (erreur) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{erreur}</p>
        <button type="button" className="bouton-lien" onClick={recharger}>
          {t('erreurs.reessayer')}
        </button>
      </div>
    )
  }
  if (!donnees || donnees.rendezVous.length === 0) {
    return <p className="etat-vide-texte">{t('fichePatient.aucunRendezVous')}</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="tableau-conteneur">
        <table className="tableau tableau-cartes">
          <thead>
            <tr>
              <th scope="col">{t('commun.date')}</th>
              <th scope="col">{t('rendezVous.traitement')}</th>
              <th scope="col" className="tableau-numerique">
                {t('paiements.total')}
              </th>
              <th scope="col" className="tableau-numerique">
                {t('patients.totalPaye')}
              </th>
              <th scope="col" className="tableau-numerique">
                {t('patients.resteAPayer')}
              </th>
              <th scope="col">{t('commun.statut')}</th>
            </tr>
          </thead>
          <tbody>
            {donnees.rendezVous.map((rdv) => (
              <tr key={rdv.id}>
                <td data-etiquette={t('commun.date')}>{dateLongue(rdv.dateDebut)}</td>
                <td data-etiquette={t('rendezVous.traitement')}>
                  {rdv.traitement ? rdv.traitement.typeTraitement : (rdv.motif ?? '—')}
                </td>
                <td data-etiquette={t('paiements.total')} className="tableau-numerique">
                  {rdv.traitement ? formaterMontant(rdv.traitement.prixTotalCentimes) : '—'}
                </td>
                <td data-etiquette={t('patients.totalPaye')} className="tableau-numerique">
                  {rdv.traitement ? formaterMontant(rdv.traitement.montantPayeCentimes) : '—'}
                </td>
                <td
                  data-etiquette={t('patients.resteAPayer')}
                  className={
                    rdv.traitement && rdv.traitement.resteAPayerCentimes > 0
                      ? 'tableau-numerique solde-valeur-attention'
                      : 'tableau-numerique'
                  }
                >
                  {rdv.traitement ? formaterMontant(rdv.traitement.resteAPayerCentimes) : '—'}
                </td>
                <td data-etiquette={t('commun.statut')}>
                  <BadgeStatutRendezVous statut={rdv.statut} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={donnees.page}
        pages={donnees.pages}
        total={donnees.total}
        onChangerPage={setPage}
      />
    </div>
  )
}

/** Date en clair : « 24 septembre 2026 ». */
function dateLongue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Paiements du patient — l'historique financier REEL.
 *
 * SECTION « PAIEMENTS » (§16) :
 *   Les paiements sont lus depuis `/api/patients/:id/payments`, c'est-a-dire la
 *   table `payments` elle-meme. Un versement par ligne : un patient qui regle en
 *   trois fois voit TROIS lignes, pas une seule ligne cumulee et jamais un
 *   ecrasement du precedent.
 *
 * RESUME FINANCIER :
 *   Total / Total paye / Reste a payer sont REPRIS du calcul fait en base par
 *   `/api/patients/:id` et transmis par la fiche — la meme agregation que le
 *   reste de l'application, donc une seule source de verite :
 *
 *       Total       = somme des prix des traitements
 *       Total paye  = somme des paiements de statut VALIDE
 *       Reste       = Total − paiements VALIDE
 *
 *   Ce composant ne RECALCULE rien : s'il recomputait le reste, il pourrait
 *   diverger de l'en-tete affiche au-dessus (meme ecran, deux chiffres
 *   differents). Seul le serveur decide (§12).
 *
 * Les paiements ANNULES restent visibles avec leur statut : l'historique
 * financier n'est jamais efface (§17), mais ils n'entrent pas dans le total
 * paye — seul le resume calcule en base en tient compte.
 *
 * AUCUNE METHODE DE PAIEMENT n'est affichee : le medecin raisonne en montants
 * et en dates. Ce n'est pas une contrainte de ce chantier, c'est l'etat
 * volontaire de l'ecran « Paiements » general.
 */
function OngletPaiements({
  patientId,
  solde,
  rafraichissement,
}: {
  patientId: string
  /** Resume financier deja calcule en base par la fiche : une seule source. */
  solde: Solde
  /**
   * Compteur change par la fiche apres un « Ajouter un paiement » : c'est ce
   * qui relance la liste des versements. Il n'est PAS incremente au montage,
   * pour ne pas doubler la requete initiale de l'onglet.
   */
  rafraichissement: number
}): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { donnees, chargement, erreur, recharger } = useRequete<ReponsePaiementsPatient>(
    `/api/patients/${patientId}/payments?page=${page}&taille=25&v=${rafraichissement}`,
  )

  if (erreur) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{erreur}</p>
        <button type="button" className="bouton-lien" onClick={recharger}>
          {t('erreurs.reessayer')}
        </button>
      </div>
    )
  }

  if (chargement && !donnees) return <p className="etat-vide-texte">{t('tableaux.chargement')}</p>

  if (!donnees || donnees.paiements.length === 0) {
    return <p className="etat-vide-texte">{t('fichePatient.aucunPaiement')}</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="grille-solde">
        <div className="solde-element">
          <span className="solde-etiquette">{t('paiements.total')}</span>
          <span className="solde-valeur">{formaterMontant(solde.totalTraitementsCentimes)}</span>
        </div>
        <div className="solde-element">
          <span className="solde-etiquette">{t('patients.totalPaye')}</span>
          <span className="solde-valeur solde-valeur-solde">
            {formaterMontant(solde.totalPayeCentimes)}
          </span>
        </div>
        <div className="solde-element">
          <span className="solde-etiquette">{t('patients.resteAPayer')}</span>
          <span
            className={`solde-valeur ${solde.resteAPayerCentimes > 0 ? 'solde-valeur-attention' : 'solde-valeur-solde'}`}
          >
            {formaterMontant(solde.resteAPayerCentimes)}
          </span>
        </div>
      </div>

      <div className="tableau-conteneur">
        <table className="tableau tableau-cartes">
          <thead>
            <tr>
              <th scope="col">{t('paiements.datePaiement')}</th>
              <th scope="col">{t('paiements.traitementAssocie')}</th>
              <th scope="col" className="tableau-numerique">
                {t('paiements.montant')}
              </th>
              <th scope="col">{t('commun.statut')}</th>
            </tr>
          </thead>
          <tbody>
            {donnees.paiements.map((paiement) => (
              <tr key={paiement.id}>
                <td data-etiquette={t('paiements.datePaiement')}>
                  {new Date(paiement.datePaiement).toLocaleDateString('fr-FR')}
                </td>
                <td data-etiquette={t('paiements.traitementAssocie')}>
                  {paiement.treatment?.typeTraitement ?? '—'}
                </td>
                <td data-etiquette={t('paiements.montant')} className="tableau-numerique">
                  {formaterMontant(paiement.montantCentimes)}
                </td>
                <td data-etiquette={t('commun.statut')}>
                  <BadgeStatutPaiement statut={paiement.statut} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={donnees.page}
        pages={donnees.pages}
        total={donnees.total}
        onChangerPage={setPage}
      />
    </div>
  )
}
