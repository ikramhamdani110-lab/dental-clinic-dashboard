'use client'

import { useEffect } from 'react'

import { t } from '@content/index'

import { formaterMontant } from '@backend/domain/finance'

import { useRequete } from '@/lib/hooks/use-requete'
import { surModification } from '@/lib/evenements-donnees'
import { TONS_STATUT_RENDEZ_VOUS } from '@/components/ui/badge-statut'

/**
 * =============================================================================
 *  TABLEAU DE BORD — LES CINQ INDICATEURS DU JOUR ET LES DEUX LISTES
 * =============================================================================
 *
 *  Contenu VOLONTAIREMENT LIMITE a ce dont le medecin a besoin au quotidien :
 *
 *    1. Rendez-vous du jour   — patients attendus sur un creneau planifie ;
 *    2. Nouveaux patients     — premieres visites enregistrees aujourd'hui ;
 *    3. Patients du jour      — TOUTES les personnes venues au cabinet ;
 *    4. Paiements du jour     — argent REELLEMENT encaisse aujourd'hui ;
 *    5. Credit a recevoir     — montants encore dus par les patients.
 *
 *  Puis deux listes :
 *    - les rendez-vous d'AUJOURD'HUI, avec leur statut lisible ;
 *    - les rendez-vous CREES AUJOURD'HUI, quelle que soit leur date.
 *
 *  CE QUI A ETE RETIRE, ET POURQUOI
 *
 *  Le medecin n'a pas besoin, sur son ecran d'accueil, d'un graphique de revenus
 *  mensuels ni d'un decompte de traitements en cours : ces informations vivent
 *  dans les sections dediees (Rapports, Patients). Un tableau de bord charge de
 *  tout devient un ecran que l'on survole au lieu d'un ecran que l'on lit.
 *
 *  AUCUNE VALEUR N'EST CODEE EN DUR : tout provient de GET /api/dashboard, qui
 *  agrege en base. L'interface ne calcule aucun total et ne telecharge aucune
 *  liste complete.
 *
 *  RAFRAICHISSEMENT APRES UN PAIEMENT
 *    Le tableau de bord s'abonne au signal `paiements` emis par la fiche patient
 *    apres un encaissement reussi, puis redemande GET /api/dashboard : le montant
 *    affiche reste celui calcule par la base, jamais un cumul local.
 */

interface RendezVousJour {
  id: string
  patient: string
  telephone: string
  dateDebut: string
  dateFin: string
  statut: string
  motif: string | null
  typeTraitement?: string | null
  /** Faux si le rendez-vous du jour est la PREMIERE visite du patient. */
  patientConnu: boolean
}

/**
 * Un rendez-vous CREE AUJOURD'HUI.
 *
 * La date affichee est `dateDebut` — le jour du rendez-vous — et non l'instant de
 * saisie : le medecin a besoin de savoir QUAND le patient viendra, la colonne
 * « cree aujourd'hui » portant deja l'information de fraicheur. Le serveur garantit
 * que la ligne est bien une creation du jour.
 */
interface RendezVousCreeAujourdhui {
  id: string
  patient: string
  telephone: string
  dateDebut: string
  dateFin: string
  statut: string
  motif: string | null
}

interface DonneesTableauBord {
  rendezVousDuJour: RendezVousJour[]
  totalPatients: number
  patientsVenusJour: number
  nouveauxPatientsJour: number
  revenusJourCentimes: number
  nombrePaiementsJour: number
  totalRestantCentimes: number
  rendezVousCreesAujourdhui: RendezVousCreeAujourdhui[]
}

export function DonneesTableauBord(): React.JSX.Element {
  const { donnees, chargement, erreur, recharger } =
    useRequete<DonneesTableauBord>('/api/dashboard')

  // Relit les indicateurs des qu'un paiement est enregistre ailleurs dans
  // l'application, sans action du medecin ni rechargement de page.
  useEffect(() => surModification('paiements', recharger), [recharger])

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
        <p>{erreur ?? t('erreurs.erreurInterne')}</p>
        <button type="button" className="bouton-lien" onClick={recharger}>
          {t('erreurs.reessayer')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="tableau-bord-donnees"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}
    >
      {/* ── 1. LES CINQ INDICATEURS ──────────────────────────────────────────── */}
      <section className="grille-statistiques" aria-label={t('tableauDeBord.patientsDuJour')}>
        <Statistique
          etiquette={t('tableauDeBord.rendezVousDuJourBoite')}
          valeur={String(donnees.rendezVousDuJour.length)}
          detail={t('tableauDeBord.rendezVousDuJourAide')}
        />
        <Statistique
          etiquette={t('tableauDeBord.nouveauxPatients')}
          valeur={String(donnees.nouveauxPatientsJour)}
          detail={t('tableauDeBord.nouveauxPatientsAide')}
        />
        <Statistique
          etiquette={t('tableauDeBord.patientsDuJour')}
          valeur={String(donnees.patientsVenusJour)}
          detail={t('tableauDeBord.patientsDuJourAide')}
        />
        <Statistique
          etiquette={t('tableauDeBord.paiementsDuJour')}
          valeur={formaterMontant(donnees.revenusJourCentimes)}
          detail={`${donnees.nombrePaiementsJour} ${t('tableauDeBord.paiementsRecus').toLowerCase()}`}
        />
        <Statistique
          etiquette={t('tableauDeBord.creditARecevoir')}
          valeur={formaterMontant(donnees.totalRestantCentimes)}
          detail={t('tableauDeBord.creditARecevoirAide')}
          attention={donnees.totalRestantCentimes > 0}
        />
      </section>

      {/* ── 2. RENDEZ-VOUS D'AUJOURD'HUI ─────────────────────────────────────── */}
      <section className="carte" aria-labelledby="titre-rdv-jour">
        <div className="carte-entete">
          <h2 className="carte-titre" id="titre-rdv-jour">
            {t('tableauDeBord.listeRendezVousJour')} — {donnees.rendezVousDuJour.length}
          </h2>
        </div>

        {donnees.rendezVousDuJour.length === 0 ? (
          <div className="etat-vide">
            <p className="etat-vide-texte">{t('tableauDeBord.aucunRendezVousJour')}</p>
          </div>
        ) : (
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  {/*
                    L'HEURE N'EST PLUS AFFICHEE : la colonne « Heure » est
                    remplacee par la DATE du rendez-vous, qui reste affichee. Le
                    changement est purement visuel — la date et l'heure stockees
                    en base sont inchangees.
                  */}
                  <th scope="col">{t('rendezVous.date')}</th>
                  <th scope="col">{t('rendezVous.patient')}</th>
                  <th scope="col">{t('rendezVous.traitement')}</th>
                  <th scope="col">{t('rendezVous.statut')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.rendezVousDuJour.map((rdv) => (
                  <tr key={rdv.id}>
                    <td data-etiquette={t('rendezVous.date')}>
                      {new Date(rdv.dateDebut).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td data-etiquette={t('rendezVous.patient')}>
                      <span className="liste-compacte-principal">
                        <span className="liste-compacte-titre">{rdv.patient}</span>
                        <span className="liste-compacte-detail">{rdv.telephone}</span>
                      </span>
                    </td>
                    <td data-etiquette={t('rendezVous.traitement')}>
                      {rdv.typeTraitement ?? rdv.motif ?? '—'}
                    </td>
                    <td data-etiquette={t('rendezVous.statut')}>
                      <StatutRendezVousJour statut={rdv.statut} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. NOUVEAUX RENDEZ-VOUS (CREES AUJOURD'HUI) ───────────────────────── */}
      {/*
        * SECTION BASEE SUR LA DATE DE CREATION, PAS SUR LA DATE DU RENDEZ-VOUS.
        *
        * Elle repond a la question que le medecin se pose en arrivant le matin :
        * « qu'est-ce qui m'a ete demande aujourd'hui ? ». Le nombre annonce est
        * donc la sortie de la base, jamais une valeur figee dans l'interface.
        *
        * Elle remplace l'ancienne section « patients sans rendez-vous », qui
        * melangeait deux notions sans rapport entre elles : le mode de venue
        * d'une part, et l'age d'une saisie d'autre part. Le nombre d'urgentistes
        * etait un indicateur de flux, pas un indicateur d'activite du jour.
        */}
      <section className="carte" aria-labelledby="titre-nouveaux-rdv">
        <div className="carte-entete">
          <h2 className="carte-titre" id="titre-nouveaux-rdv">
            {t('tableauDeBord.nouveauxRendezVousCrees')} —{' '}
            {donnees.rendezVousCreesAujourdhui.length}
          </h2>
        </div>

        {donnees.rendezVousCreesAujourdhui.length === 0 ? (
          <div className="etat-vide">
            <p className="etat-vide-texte">{t('tableauDeBord.aucunNouveauRendezVousCree')}</p>
          </div>
        ) : (
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('rendezVous.patient')}</th>
                  <th scope="col">{t('rendezVous.date')}</th>
                  <th scope="col">{t('rendezVous.traitement')}</th>
                  <th scope="col">{t('rendezVous.statut')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.rendezVousCreesAujourdhui.map((rdv) => (
                  <tr key={rdv.id}>
                    <td data-etiquette={t('rendezVous.patient')}>
                      <span className="liste-compacte-principal">
                        <span className="liste-compacte-titre">{rdv.patient}</span>
                        <span className="liste-compacte-detail">{rdv.telephone}</span>
                      </span>
                    </td>
                    <td data-etiquette={t('rendezVous.date')}>
                      {new Date(rdv.dateDebut).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td data-etiquette={t('rendezVous.traitement')}>
                      {rdv.motif ?? '—'}
                    </td>
                    <td data-etiquette={t('rendezVous.statut')}>
                      <StatutRendezVousJour statut={rdv.statut} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Une boite d'indicateur.
 * `attention` met la valeur en evidence (credit a recevoir non nul).
 */
function Statistique({
  etiquette,
  valeur,
  detail,
  attention = false,
}: {
  etiquette: string
  valeur: string
  detail?: string
  attention?: boolean
}): React.JSX.Element {
  return (
    <div className="statistique">
      <span className="statistique-etiquette">{etiquette}</span>
      <span
        className="statistique-valeur"
        style={attention ? { color: 'var(--avertissement-texte)' } : undefined}
      >
        {valeur}
      </span>
      {detail ? <span className="statistique-detail">{detail}</span> : null}
    </div>
  )
}

/**
 * Statut d'un rendez-vous, affiche tel que le medecin l'a laisse.
 *
 * Le tableau de bord ne CONCLUT RIEN a partir de la date. Affiche, il pourrait
 * ecran « Fait » a la seule raison que l'heure est passee, ou « Absent » parce
 * que le creneau s'est acheve — deux affirmations qu'il n'a jamais faites et que
 * rien ne permet d'affirmer a sa place. Un rendez-vous passe sans intervention
 * de sa part reste donc « Planifie », indefinitely.
 *
 * L'etat affiche est donc celui stocke, traduit par la meme table que le reste
 * de l'application (`rendezVous.statuts`) : un seul vocabulaire sur tous les
 * ecrans. Les valeurs d'organisation historiques (`CONFIRME`, `EN_ATTENTE`,
 * `EN_COURS`, `ANNULE`) y trouvent une traduction, ce qui evite d'afficher un
 * code brut sur un rendez-vous ancien — et « ANNULE » se lit « Fait », conformement
 * au vocabulaire demande.
 *
 * `dateFin` n'est plus consulte : c'est volontairement le parametre
 * `maintenant` qui a disparu du raisonnement, pas l'affichage.
 */
function StatutRendezVousJour({ statut }: { statut: string }): React.JSX.Element {
  const libelle = libelleStatutJour(statut)
  return (
    <span className={`badge badge-${TONS_STATUT_RENDEZ_VOUS[statut] ?? 'neutre'}`}>
      {t(`rendezVous.statuts.${libelle}`)}
    </span>
  )
}

/**
 * Valeur de statut a afficher sur le tableau de bord.
 *
 * Une seule regle : on affiche l'etat ENREGISTRE. Aucune comparaison a la date
 * du jour n'est faite, nulle part, pour quelque raison que ce soit.
 *
 * Une valeur inconnue (donnee historique, evolution du schema) est renvoyee telle
 * quelle : l'affichage retombe alors sur une traduction ou, a defaut, sur le
 * code brut plutot que d'inventer un etat que le medecin n'a pas choisi.
 */
export function libelleStatutJour(statut: string): string {
  return statut
}

/*
 * L'ancien helper `heure()` n'est plus utilise : l'heure du rendez-vous n'est
 * plus affichee nulle part dans le tableau de bord. Les dates et heures stockees
 * restent intactes et servent toujours a la planification et aux calculs.
 */
