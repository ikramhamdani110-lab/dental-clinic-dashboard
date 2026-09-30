'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { t } from '@content/index'
import { formaterMontant, parseMontantEnCentimes } from '@backend/domain/finance'

import { Bouton } from '@/components/ui/bouton'
import { ChampSelection, ChampTexte } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, genererCleIdempotence, requeteApi } from '@/lib/api-client'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  ENREGISTREMENT D'UN PAIEMENT (§16, §17)
 * =============================================================================
 *
 *  DEUX PROTECTIONS CONTRE LA DOUBLE SOUMISSION :
 *
 *   1. Cote navigateur : la CLE D'IDEMPOTENCE est generee UNE FOIS par montage
 *      du formulaire (`useMemo`). Si le medecin clique deux fois, ou si la
 *      requete est rejouee, la meme cle est transmise : le serveur ne cree qu'un
 *      seul paiement.
 *
 *   2. Cote serveur : la cle est UNIQUE en base. Meme un double envoi par un
 *      autre moyen ne creera pas de second paiement (garde-fou souverain).
 *
 *  Le formulaire affiche le RESTE A PAYER du traitement, mis a jour par le
 *  serveur apres enregistrement. Le montant est valide cote serveur : il ne peut
 *  pas faire depasser le prix du traitement.
 *
 *  La METHODE de paiement n'est plus exposee : le medecin ne saisit que le
 *  montant et la date. Le champ reste en base (voir schema) mais n'apparait
 *  jamais dans l'interface.
 */

interface TraitementOption {
  id: string
  typeTraitement: string
  dents: string[]
  resteAPayerCentimes: number
  prixTotalCentimes: number
}

export function FormulairePaiement(): React.JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const notifications = useNotifications()

  const patientIdParam = params.get('patientId')
  const traitementIdParam = params.get('treatmentId')

  const [patientId, setPatientId] = useState(patientIdParam ?? '')
  const [traitementId, setTraitementId] = useState(traitementIdParam ?? '')
  const [montant, setMontant] = useState('')
  const [datePaiement, setDatePaiement] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null)

  // Cle d'idempotence : stable pour tout le cycle de vie du formulaire.
  const cleIdempotence = useMemo(() => genererCleIdempotence(), [])

  // Traitements du patient selectionne (avec leur reste a payer).
  const { donnees: traitements } = useRequete<{ traitements: TraitementOption[] }>(
    patientId ? `/api/patients/${patientId}/treatments` : null,
  )

  // Preselection : si le patient n'a qu'un seul traitement avec solde, on le
  // choisit d'office, pour eviter une saisie inutile (§10).
  useEffect(() => {
    if (traitementId || !traitements) return
    const avecSolde = traitements.traitements.filter(
      (traitement) => traitement.resteAPayerCentimes > 0,
    )
    if (avecSolde.length === 1 && avecSolde[0]) setTraitementId(avecSolde[0].id)
  }, [traitements, traitementId])

  const traitementSelectionne = traitements?.traitements.find(
    (traitement) => traitement.id === traitementId,
  )

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreurGenerale(null)
    setEnCours(true)

    try {
      // Saisie en dinars -> centimes ENTIERS. Meme regle que la fiche patient :
      // la valeur transmise est conforme au nom du champ (`montantCentimes`).
      const montantEnCentimes = parseMontantEnCentimes(montant)
      if (montantEnCentimes === null || montantEnCentimes <= 0) {
        setErreurGenerale(t('paiements.montantInvalide'))
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
          `Paiement enregistre. Reste a payer : ${formaterMontant(reponse.resteAPayerCentimes)}.`,
        )
      }

      if (patientId) router.push(`/patients/${patientId}`)
      else router.push('/paiements')
      router.refresh()
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErreurGenerale(cause.message)
      } else {
        setErreurGenerale(t('erreurs.serviceIndisponible'))
      }
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={soumettre} noValidate className="carte">
      <div
        className="carte-corps"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}
      >
        {erreurGenerale ? (
          <div className="encadre-erreur" role="alert">
            {erreurGenerale}
          </div>
        ) : null}

        {/* Le patient est choisi sur la fiche patient ; si le formulaire est
            ouvert directement, on affiche le champ de selection. */}
        {!patientIdParam ? (
          <ChampTexte
            nom="patientId"
            etiquette={t('commun.patient')}
            aide="Selectionnez d'abord un patient depuis sa fiche, ou collez son identifiant."
            value={patientId}
            onChange={(evenement) => setPatientId(evenement.target.value.trim())}
            obligatoire
          />
        ) : null}

        {traitements && traitements.traitements.length > 0 ? (
          <ChampSelection
            nom="treatmentId"
            etiquette={t('paiements.traitementAssocie')}
            obligatoire
            value={traitementId}
            placeholder="—"
            onChange={(evenement) => setTraitementId(evenement.target.value)}
            options={traitements.traitements.map((traitement) => ({
              valeur: traitement.id,
              libelle: `${traitement.typeTraitement}${
                traitement.dents.length > 0 ? ` (${traitement.dents.join(', ')})` : ''
              } — ${t('traitements.resteAPayer')} : ${formaterMontant(traitement.resteAPayerCentimes)}`,
            }))}
          />
        ) : null}

        {traitementSelectionne ? (
          <div className="encadre-information">
            {t('paiements.montantRestant').replace(
              '{{reste}}',
              formaterMontant(traitementSelectionne.resteAPayerCentimes),
            )}
          </div>
        ) : null}

        <div className="champ-grille">
          <ChampTexte
            nom="montant"
            etiquette={t('paiements.montant')}
            obligatoire
            inputMode="decimal"
            placeholder="15000"
            value={montant}
            onChange={(evenement) => setMontant(evenement.target.value)}
          />

          <ChampTexte
            nom="datePaiement"
            type="date"
            etiquette={t('paiements.datePaiement')}
            obligatoire
            value={datePaiement}
            onChange={(evenement) => setDatePaiement(evenement.target.value)}
          />
        </div>

        <ChampTexte
          nom="notes"
          etiquette={t('commun.notes')}
          value={notes}
          onChange={(evenement) => setNotes(evenement.target.value)}
        />
      </div>

      <div
        className="modale-pied"
        style={{ borderRadius: '0 0 var(--rayon-grand) var(--rayon-grand)' }}
      >
        <Bouton
          type="button"
          variante="secondaire"
          onClick={() => router.back()}
          disabled={enCours}
        >
          {t('commun.annuler')}
        </Bouton>
        <Bouton
          type="submit"
          variante="principal"
          disabled={enCours || !patientId || !traitementId || !montant}
        >
          {enCours ? t('commun.chargement') : t('paiements.enregistrerPaiement')}
        </Bouton>
      </div>
    </form>
  )
}
