'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { TYPES_TRAITEMENT_RENDEZ_VOUS } from '@backend/domain/constants'
import { formaterMontant, parseMontantEnCentimes } from '@backend/domain/finance'
import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampSelection, ChampTexte, ChampZone, GrilleChamps } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, genererCleIdempotence, requeteApi } from '@/lib/api-client'
import { signalerModification } from '@/lib/evenements-donnees'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

interface PatientOption {
  id: string
  nom: string
  prenom: string
  telephone: string
}

interface PagePatients {
  elements: PatientOption[]
}

export function FormulaireRendezVous(): React.JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const notifications = useNotifications()
  const patientIdParam = params.get('patientId')
  const dateParam = params.get('date')

  const [patientId, setPatientId] = useState(patientIdParam ?? '')
  const [nomPatient, setNomPatient] = useState('')
  const [recherchePatient, setRecherchePatient] = useState('')
  const [listeOuverte, setListeOuverte] = useState(false)
  const [date, setDate] = useState(dateParam ?? dateLocale())
  const [typeTraitement, setTypeTraitement] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [total, setTotal] = useState('')
  const [paye, setPaye] = useState('0')
  const [idempotencyKey] = useState(() => genererCleIdempotence())
  const [enCours, setEnCours] = useState(false)
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({})
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null)

  const rechercheDifferee = useDebounce(recherchePatient.trim(), 250)
  const patientsUrl = listeOuverte
    ? rechercheDifferee.length > 0
      ? `/api/patients?taille=100&prefix=${encodeURIComponent(rechercheDifferee)}`
      : '/api/patients?taille=20&tri=recent&ordre=desc'
    : null
  const { donnees: patients, chargement: chargementPatients } = useRequete<PagePatients>(patientsUrl)
  const { donnees: patientPrefill } = useRequete<{ patient: PatientOption }>(
    patientIdParam ? `/api/patients/${patientIdParam}` : null,
  )

  useEffect(() => {
    if (!patientPrefill?.patient) return
    setPatientId(patientPrefill.patient.id)
    setNomPatient(`${patientPrefill.patient.prenom} ${patientPrefill.patient.nom}`)
  }, [patientPrefill])

  const totalCentimes = total.trim() === '' ? null : parseMontantEnCentimes(total)
  const payeCentimes = paye.trim() === '' ? null : parseMontantEnCentimes(paye)
  const resteCentimes =
    totalCentimes !== null && payeCentimes !== null && totalCentimes >= payeCentimes
      ? totalCentimes - payeCentimes
      : null

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreursChamps({})
    setErreurGenerale(null)

    if (!patientId) {
      setErreursChamps({ patientId: 'Selectionnez un patient existant.' })
      return
    }
    if (totalCentimes === null || payeCentimes === null || totalCentimes < 0 || payeCentimes < 0) {
      setErreursChamps({ total: 'Indiquez des montants numeriques valides et positifs.' })
      return
    }
    if (payeCentimes > totalCentimes) {
      setErreursChamps({ paye: 'Le montant payé ne peut pas dépasser le total.' })
      return
    }
    if (!typeTraitement) {
      setErreursChamps({ typeTraitement: 'Selectionnez un traitement.' })
      return
    }

    setEnCours(true)
    try {
      await requeteApi('/api/appointments', {
        methode: 'POST',
        corps: {
          patientId,
          date,
          typeTraitement,
          totalCentimes,
          payeCentimes,
          notes,
          idempotencyKey,
        },
      })

      notifications.succes(t('rendezVous.creerReussie'))
      signalerModification('rendezVous')
      if (payeCentimes > 0) signalerModification('paiements')
      router.push(patientId ? `/patients/${patientId}` : '/rendez-vous')
      router.refresh()
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.champs?.length) {
          const map: Record<string, string> = {}
          for (const champ of cause.champs) map[champ.champ] = champ.message
          setErreursChamps(map)
        }
        setErreurGenerale(cause.message)
      } else {
        setErreurGenerale(t('erreurs.serviceIndisponible'))
      }
      setEnCours(false)
    }
  }

  return (
    <form
      onSubmit={soumettre}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}
    >
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('rendezVous.nouveau')}</h2>
        </div>
        <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
          {erreurGenerale ? <div className="encadre-erreur" role="alert">{erreurGenerale}</div> : null}

          <div className="champ" style={{ position: 'relative' }}>
            <label htmlFor="nom-patient-rendez-vous" className="champ-etiquette champ-obligatoire">
              Nom du patient
            </label>
            <input
              id="nom-patient-rendez-vous"
              className="champ-controle"
              role="combobox"
              autoComplete="off"
              placeholder="Rechercher un patient"
              value={nomPatient}
              readOnly={Boolean(patientIdParam)}
              aria-expanded={listeOuverte && !patientIdParam}
              aria-autocomplete="list"
              aria-controls="suggestions-patients-rendez-vous"
              onFocus={() => {
                if (!patientIdParam) setListeOuverte(true)
              }}
              onChange={(event) => {
                setNomPatient(event.target.value)
                setRecherchePatient(event.target.value)
                setPatientId('')
                setListeOuverte(true)
              }}
              onBlur={() => window.setTimeout(() => setListeOuverte(false), 150)}
              aria-invalid={erreursChamps.patientId ? 'true' : undefined}
            />
            {listeOuverte && !patientIdParam ? (
              <div
                id="suggestions-patients-rendez-vous"
                role="listbox"
                className="carte"
                style={{
                  position: 'absolute',
                  insetInline: 0,
                  top: '100%',
                  zIndex: 'var(--z-dessus)',
                  maxHeight: '16rem',
                  overflowY: 'auto',
                  background: 'var(--fond-surface-eleve)',
                  boxShadow: 'var(--ombre-moyenne)',
                }}
              >
                {chargementPatients ? <p className="etat-vide-texte">{t('commun.chargement')}</p> : null}
                {!chargementPatients && (patients?.elements.length ?? 0) === 0 ? (
                  <p className="etat-vide-texte" style={{ padding: 'var(--espace-3)' }}>
                    Aucun patient correspondant.
                  </p>
                ) : null}
                {patients?.elements.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    role="option"
                    aria-selected={patientId === patient.id}
                    className="bouton-discret"
                    style={{ display: 'block', width: '100%', padding: 'var(--espace-2) var(--espace-3)', borderBottom: '1px solid var(--bordure-douce)', textAlign: 'left' }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setPatientId(patient.id)
                      setNomPatient(`${patient.prenom} ${patient.nom}`)
                      setRecherchePatient('')
                      setListeOuverte(false)
                    }}
                  >
                    {/*
                      * SUGGESTION : LE NOM, ET C'EST TOUT.
                      *
                      * Ni l'age, ni le telephone, ni aucune autre fiche ne
                      * doivent apparaitre ici. La liste sert a choisir un patient,
                      * pas a le decrire : un detail supplementaire allonge chaque
                      * ligne, noie le nom dans le bruit et donne l impression qu
                      * il y a plusieurs personnes du meme nom — ce qui est
                      * exactement le cas ici, et rend un doublon impossible a
                      * distinguer.
                      *
                      * Pour lever le doute sur une homonymie, le medecin ouvre la
                      * fiche apres avoir choisi : la date de naissance et le
                      * telephone y figurent.
                      */}
                    {patient.prenom} {patient.nom}
                  </button>
                ))}
              </div>
            ) : null}
            {erreursChamps.patientId ? <span className="champ-erreur">{erreursChamps.patientId}</span> : null}
          </div>

          <GrilleChamps>
            <ChampTexte nom="date-rendez-vous" type="date" etiquette="Date" obligatoire value={date} onChange={(event) => setDate(event.target.value)} />
            <ChampSelection
              nom="traitement-rendez-vous"
              etiquette="Traitement"
              obligatoire
              value={typeTraitement}
              placeholder="Selectionner un traitement"
              onChange={(event) => setTypeTraitement(event.target.value)}
              options={TYPES_TRAITEMENT_RENDEZ_VOUS.map((value) => ({ valeur: value, libelle: value }))}
              {...(erreursChamps.typeTraitement ? { erreur: erreursChamps.typeTraitement } : {})}
            />
            <ChampTexte
              nom="total-rendez-vous"
              etiquette="Total (DA)"
              obligatoire
              inputMode="decimal"
              placeholder="20000"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              {...(erreursChamps.total ? { erreur: erreursChamps.total } : {})}
            />
            <ChampTexte
              nom="paye-rendez-vous"
              etiquette="Payé (DA)"
              obligatoire
              inputMode="decimal"
              placeholder="0"
              value={paye}
              onChange={(event) => setPaye(event.target.value)}
              {...(erreursChamps.paye ? { erreur: erreursChamps.paye } : {})}
            />
            <div className="champ">
              <span className="champ-etiquette">Reste (DA)</span>
              <output className="champ-controle" aria-live="polite">
                {resteCentimes === null ? '—' : formaterMontant(resteCentimes)}
              </output>
            </div>
          </GrilleChamps>

          <ChampZone nom="notes-rendez-vous" etiquette="Note (facultatif)" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </section>

      <div style={{ display: 'flex', gap: 'var(--espace-3)', justifyContent: 'flex-end' }}>
        <Bouton type="button" variante="secondaire" onClick={() => router.back()} disabled={enCours}>
          {t('commun.annuler')}
        </Bouton>
        <Bouton type="submit" variante="principal" disabled={enCours}>
          {enCours ? t('commun.chargement') : t('rendezVous.creer')}
        </Bouton>
      </div>
    </form>
  )
}

function dateLocale(): string {
  const maintenant = new Date()
  const decalage = maintenant.getTimezoneOffset() * 60_000
  return new Date(maintenant.getTime() - decalage).toISOString().slice(0, 10)
}
