'use client'

import { useEffect, useState } from 'react'

import { t } from '@content/index'
import { formaterMontant, parseMontantEnCentimes } from '@backend/domain/finance'

import { Bouton } from '@/components/ui/bouton'
import { ChampSelection, ChampTexte } from '@/components/ui/champ'
import { Modale } from '@/components/ui/modale'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, genererCleIdempotence, requeteApi } from '@/lib/api-client'
import { signalerModification } from '@/lib/evenements-donnees'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  AJOUTER UN PAIEMENT DEPUIS LA FICHE PATIENT (§16)
 * =============================================================================
 *
 *  Le paiement se cree DESORMAIS depuis la fiche du patient : c'est le seul
 *  point d'entree du reglement dans l'interface. Il n'existe PAS de second
 *  systeme de paiement : ce composant appelle la MEME API securisee
 *  (`POST /api/payments`) que disposait l'ancienne page autonome.
 *
 *  Le medecin choisit le traitement concerne (dont le reste a payer est affiche),
 *  saisit un montant et une date. La METHODE de paiement n'est plus demandee.
 *
 *  PROTECTION CONTRE LA DOUBLE SOUMISSION : la cle d'idempotence est generee une
 *  fois par ouverture et envoyee a chaque tentative ; le serveur ne creera jamais
 *  deux paiements pour la meme soumission (§17).
 */

interface TraitementSolder {
  id: string
  typeTraitement: string
  dents: string[]
  resteAPayerCentimes: number
  prixTotalCentimes: number
  montantPayeCentimes: number
}

interface PatientResume {
  id: string
  nom: string
  prenom: string
}

export function FormulairePaiementPatient({
  patientId,
  onPaiementEnregistre,
}: {
  patientId: string
  /** Appele apres un enregistrement reussi : permet a la fiche de se rafraichir. */
  onPaiementEnregistre: () => void
}): React.JSX.Element {
  const notifications = useNotifications()

  const [ouverte, setOuverte] = useState(false)
  const [traitementId, setTraitementId] = useState('')
  const [montant, setMontant] = useState('')
  const [datePaiement, setDatePaiement] = useState(dateLocale)
  const [notes, setNotes] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null)
  // Cle d'idempotence : regeneree a chaque OUVERTURE de la modale, puis stable
  // pendant toute la duree d'une soumission. Rejouer la meme soumission ne cree
  // jamais un second paiement (§17).
  const [cleIdempotence, setCleIdempotence] = useState(() => genererCleIdempotence())

  // Traitements du patient, charges a l'ouverture de la modale.
  const { donnees, chargement } = useRequete<{ traitements: TraitementSolder[] }>(
    ouverte ? `/api/patients/${patientId}/treatments` : null,
  )
  const { donnees: donneesPatient } = useRequete<{ patient: PatientResume }>(
    ouverte ? `/api/patients/${patientId}` : null,
  )

  // Seuls les traitements presentant un solde peuvent recevoir un paiement :
  // le serveur refuserait un depassement de toute facon (§17).
  const traitementsASolder = (donnees?.traitements ?? []).filter(
    (traitement) => traitement.resteAPayerCentimes > 0,
  )

  // Cle d'idempotence : stable tant que la modale reste ouverte.

  // Preselection : un seul traitement a solder -> on le choisit d'office (§10).
  useEffect(() => {
    if (!ouverte) return
    if (traitementId && traitementsASolder.some((tr) => tr.id === traitementId)) return
    if (traitementsASolder[0]) {
      setTraitementId(traitementsASolder[0].id)
    }
  }, [ouverte, traitementsASolder, traitementId])

  const traitementSelectionne = traitementsASolder.find(
    (traitement) => traitement.id === traitementId,
  )

  function ouvrir(): void {
    setOuverte(true)
    setCleIdempotence(genererCleIdempotence())
    setTraitementId('')
    setMontant('')
    setDatePaiement(dateLocale())
    setNotes('')
    setErreurGenerale(null)
  }

  function fermer(): void {
    if (enCours) return
    setOuverte(false)
  }

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreurGenerale(null)
    setEnCours(true)

    try {
      // Saisie en dinars -> centimes ENTIERS. Un montant illisible est signale
      // avant l'envoi, avec le meme message que le serveur.
      const montantEnCentimes = parseMontantEnCentimes(montant)
      if (montantEnCentimes === null || montantEnCentimes <= 0) {
        setErreurGenerale(t('paiements.montantInvalide'))
        setEnCours(false)
        return
      }
      if (traitementSelectionne && montantEnCentimes > traitementSelectionne.resteAPayerCentimes) {
        setErreurGenerale('Le montant payé ne peut pas dépasser le reste à payer.')
        setEnCours(false)
        return
      }

      const reponse = await requeteApi<{
        resteAPayerCentimes: number
        dejaEnregistre: boolean
      }>('/api/payments', {
        methode: 'POST',
        corps: {
          patientId,
          treatmentId: traitementId,
          montantCentimes: montantEnCentimes,
          datePaiement: new Date(datePaiement).toISOString(),
          notes,
          idempotencyKey: cleIdempotence,
        },
      })

      if (reponse.dejaEnregistre) {
        notifications.information(t('paiements.doublon'))
      } else {
        notifications.succes(
          t('paiements.creerReussieReste').replace(
            '{{reste}}',
            formaterMontant(reponse.resteAPayerCentimes),
          ),
        )
      }

      setEnCours(false)
      setOuverte(false)
      // La fiche recharge ses totaux et son historique de paiements.
      onPaiementEnregistre()
      //
      // LE TABLEAU DE BORD EST PREVENU.
      //
      //  « Revenus du jour » doit refleter immediatement l'encaissement sans
      //  que le medecin ait a recharger la page. Le signal ne transporte AUCUN
      //  montant : le tableau de bord redemande `GET /api/dashboard`, dont le
      //  total reste agrege par la base (une seule source de verite).
      //
      //  Un doublon (cle d'idempotence deja utilisee) n'a rien cree : aucun
      //  signal n'est emis, puisque les totaux n'ont pas change.
      //
      if (!reponse.dejaEnregistre) signalerModification('paiements')
    } catch (cause) {
      setErreurGenerale(cause instanceof ApiError ? cause.message : t('erreurs.serviceIndisponible'))
      setEnCours(false)
    }
  }

  return (
    <>
      <Bouton variante="secondaire" taille="petite" onClick={ouvrir}>
        {t('fichePatient.ajouterPaiement')}
      </Bouton>

      <Modale
        ouverte={ouverte}
        titre={t('fichePatient.paiementTitre')}
        description={t('fichePatient.paiementAide')}
        onFermer={fermer}
        pied={
          <>
            <Bouton variante="secondaire" onClick={fermer} disabled={enCours}>
              {t('commun.annuler')}
            </Bouton>
            <Bouton
              type="submit"
              form="formulaire-paiement-patient"
              variante="principal"
              disabled={
                enCours || !traitementId || !montant || traitementsASolder.length === 0
              }
            >
              {enCours ? t('commun.chargement') : t('paiements.enregistrerPaiement')}
            </Bouton>
          </>
        }
      >
        <form
          id="formulaire-paiement-patient"
          onSubmit={soumettre}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}
        >
          {erreurGenerale ? (
            <div className="encadre-erreur" role="alert">
              {erreurGenerale}
            </div>
          ) : null}

          {chargement ? <p className="etat-vide-texte">{t('tableaux.chargement')}</p> : null}

          {!chargement && traitementsASolder.length === 0 ? (
            <p className="encadre-information">{t('fichePatient.aucunTraitementASolder')}</p>
          ) : null}

          {traitementsASolder.length > 0 ? (
            <>
              <ChampTexte
                nom="patient-paiement"
                etiquette="Nom du patient"
                value={donneesPatient?.patient
                  ? `${donneesPatient.patient.prenom} ${donneesPatient.patient.nom}`
                  : ''}
                readOnly
              />

              <ChampSelection
                nom="treatmentId"
                etiquette={t('paiements.traitementAssocie')}
                obligatoire
                value={traitementId}
                placeholder="—"
                onChange={(evenement) => setTraitementId(evenement.target.value)}
                options={traitementsASolder.map((traitement) => ({
                  valeur: traitement.id,
                  libelle: `${traitement.typeTraitement}${
                    traitement.dents.length > 0 ? ` (${traitement.dents.join(', ')})` : ''
                  } — ${t('traitements.resteAPayer')} : ${formaterMontant(
                    traitement.resteAPayerCentimes,
                  )}`,
                }))}
              />

              {traitementSelectionne ? (
                <div className="grille-solde">
                  <div className="solde-element">
                    <span className="solde-etiquette">Total</span>
                    <span className="solde-valeur">{formaterMontant(traitementSelectionne.prixTotalCentimes)}</span>
                  </div>
                  <div className="solde-element">
                    <span className="solde-etiquette">Payé</span>
                    <span className="solde-valeur">{formaterMontant(traitementSelectionne.montantPayeCentimes)}</span>
                  </div>
                  <div className="solde-element">
                    <span className="solde-etiquette">Reste</span>
                    <span className="solde-valeur solde-valeur-attention">{formaterMontant(traitementSelectionne.resteAPayerCentimes)}</span>
                  </div>
                </div>
              ) : null}

              <div className="champ-grille">
                {/*
                  MONTANT — saisi en DINARS, puis converti en centimes a l'envoi.

                  CE QUI ETAIT CASSE
                    Le champ envoyait la valeur brute dans un parametre nomme
                    `montantCentimes`, alors que le serveur, sous ce nom, attendait
                    des CENTIMES. « 5000 » (dinars) partait donc comme 5000
                    centimes, et le schema multipliait encore par 100 : le serveur
                    enregistrait 500 000 centimes. Le paiement depassait le prix du
                    traitement et etait refuse — le medecin ne pouvait plus
                    encaisser.

                  La conversion est desormais FAITE ICI, une seule fois, avec
                  l'utilitaire du domaine financier : la valeur transmise est bien
                  un nombre de centimes, conforme au nom du champ.
                */}
                <ChampTexte
                  nom="montant"
                  etiquette="Combien le patient paie aujourd'hui (DA)"
                  obligatoire
                  inputMode="decimal"
                  placeholder="10000"
                  value={montant}
                  onChange={(evenement) => setMontant(evenement.target.value)}
                />
                <ChampTexte
                  nom="datePaiement"
                  type="date"
                  etiquette={t('paiements.datePaiement')}
                  value={datePaiement}
                  readOnly
                />
              </div>

              <ChampTexte
                nom="notes"
                etiquette={t('commun.notes')}
                value={notes}
                onChange={(evenement) => setNotes(evenement.target.value)}
              />
            </>
          ) : null}
        </form>
      </Modale>
    </>
  )
}

function dateLocale(): string {
  const maintenant = new Date()
  const decalage = maintenant.getTimezoneOffset() * 60_000
  return new Date(maintenant.getTime() - decalage).toISOString().slice(0, 10)
}