'use client'

import { useState } from 'react'

import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampTexte } from '@/components/ui/champ'
import { Modale } from '@/components/ui/modale'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, requeteApi } from '@/lib/api-client'
import { useRequete } from '@/lib/hooks/use-requete'
import { signalerModification } from '@/lib/evenements-donnees'

/**
 * =============================================================================
 *  ENREGISTRER UN PATIENT SANS RENDEZ-VOUS
 * =============================================================================
 *
 *  Le patient se presente au cabinet SANS creneau planifie (premiere visite
 *  spontanee, patient connu venu a l'improviste, extraction en une seance...).
 *  Le medecin le retrouve par nom, prenom ou telephone, puis saisit le motif de
 *  la consultation.
 *
 *  L'ANCIENNETE DU PATIENT N'INTERVIENT PAS : le medecin peut choisir un patient
 *  deja enregistre comme un patient tout juste cree. C'est le fait d'arriver
 *  SANS rendez-vous qui classe la visite, jamais le fait d'etre nouveau.
 *
 *  La consultation est consignee dans la table des rendez-vous avec le marqueur
 *  « Sans rendez-vous », puis le tableau de bord est prevenu afin que la section
 *  se rafraichisse immediatement.
 */

interface PatientTrouve {
  id: string
  nom: string
  prenom: string
  telephone: string
}

/**
 * Motifs courants proposes en un clic. Le champ reste LIBRE : le medecin peut
 * toujours decrire une situation qui ne figure pas dans cette liste.
 */
const MOTIFS_COURANTS = [
  'Consultation',
  'Premiere consultation',
  'Extraction dentaire',
  'Soin de carie',
  'Detartrage',
  'Urgence dentaire',
] as const

export function FormulaireSansRendezVous({
  onEnregistre,
}: {
  /** Appele apres un enregistrement reussi. */
  onEnregistre: () => void
}): React.JSX.Element {
  const notifications = useNotifications()

  const [ouverte, setOuverte] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [patientId, setPatientId] = useState('')
  const [motif, setMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null)

  // Recherche serveur : la liste complete des patients n'est jamais telechargee.
  // Un terme vide renvoie les premiers patients, ce qui evite un ecran vide a
  // l'ouverture de la modale.
  const { donnees, chargement } = useRequete<{ elements: PatientTrouve[] }>(
    ouverte ? `/api/patients?recherche=${encodeURIComponent(recherche)}&taille=10` : null,
  )

  const patients = donnees?.elements ?? []
  const patientSelectionne = patients.find((patient) => patient.id === patientId)

  function ouvrir(): void {
    setOuverte(true)
    setRecherche('')
    setPatientId('')
    setMotif('')
    setErreurGenerale(null)
  }

  function fermer(): void {
    if (enCours) return
    setOuverte(false)
  }

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreurGenerale(null)

    if (!patientId) {
      setErreurGenerale(t('tableauDeBord.aucunPatientSelectionne'))
      return
    }
    if (motif.trim().length === 0) {
      setErreurGenerale(t('tableauDeBord.motifConsultationRequis'))
      return
    }

    setEnCours(true)

    try {
      await requeteApi<{ visite: { id: string } }>('/api/appointments/sans-rendez-vous', {
        methode: 'POST',
        corps: { patientId, motifConsultation: motif.trim() },
      })

      notifications.succes(t('tableauDeBord.patientSansRendezVousEnregistre'))
      setEnCours(false)
      setOuverte(false)
      // La section « Patients sans rendez-vous » du tableau de bord se recharge.
      signalerModification('rendezVous')
      onEnregistre()
    } catch (cause) {
      setErreurGenerale(
        cause instanceof ApiError ? cause.message : t('erreurs.serviceIndisponible'),
      )
      setEnCours(false)
    }
  }

  return (
    <>
      <Bouton variante="secondaire" taille="petite" onClick={ouvrir}>
        {t('tableauDeBord.enregistrerSansRendezVous')}
      </Bouton>

      <Modale
        ouverte={ouverte}
        titre={t('tableauDeBord.enregistrerSansRendezVous')}
        description={t('tableauDeBord.motifConsultationAide')}
        onFermer={fermer}
        pied={
          <>
            <Bouton variante="secondaire" onClick={fermer} disabled={enCours}>
              {t('commun.annuler')}
            </Bouton>
            <Bouton
              type="submit"
              form="formulaire-sans-rendez-vous"
              variante="principal"
              disabled={enCours || !patientId || motif.trim().length === 0}
            >
              {enCours ? t('commun.chargement') : t('commun.enregistrer')}
            </Bouton>
          </>
        }
      >
        <form
          id="formulaire-sans-rendez-vous"
          onSubmit={soumettre}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}
        >
          {erreurGenerale ? (
            <div className="encadre-erreur" role="alert">
              {erreurGenerale}
            </div>
          ) : null}

          <ChampTexte
            nom="recherchePatient"
            etiquette={t('tableauDeBord.selectionnerPatient')}
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
          />

          {chargement ? <p className="etat-vide-texte">{t('tableaux.chargement')}</p> : null}

          {!chargement && patients.length === 0 ? (
            <p className="encadre-information">{t('tableauDeBord.aucunPatientSelectionne')}</p>
          ) : null}

          {patients.length > 0 ? (
            <div className="champ">
              <span className="champ-etiquette">{t('patients.titre')}</span>
              <div className="liste-compacte" role="radiogroup" aria-label={t('patients.titre')}>
                {patients.map((patient) => (
                  <label key={patient.id} className="liste-compacte-element">
                    <span className="liste-compacte-principal">
                      <span className="liste-compacte-titre">
                        {patient.prenom} {patient.nom}
                      </span>
                      <span className="liste-compacte-detail">{patient.telephone}</span>
                    </span>
                    <input
                      type="radio"
                      name="patientId"
                      value={patient.id}
                      checked={patientId === patient.id}
                      onChange={() => setPatientId(patient.id)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {patientSelectionne ? (
            <p className="encadre-information">
              {patientSelectionne.prenom} {patientSelectionne.nom} — {patientSelectionne.telephone}
            </p>
          ) : null}

          <ChampTexte
            nom="motifConsultation"
            etiquette={t('tableauDeBord.motifConsultation')}
            obligatoire
            placeholder={t('tableauDeBord.premiereConsultation')}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--espace-2)' }}>
            {MOTIFS_COURANTS.map((motifCourant) => (
              <Bouton
                key={motifCourant}
                variante="secondaire"
                taille="petite"
                onClick={() => setMotif(motifCourant)}
              >
                {motifCourant}
              </Bouton>
            ))}
          </div>
        </form>
      </Modale>
    </>
  )
}