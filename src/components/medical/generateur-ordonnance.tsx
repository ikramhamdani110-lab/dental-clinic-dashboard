'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { useEffect, useState } from 'react'

import { t } from '@content/index'

import type { EnteteOrdonnance } from '@backend/validation/schemas'

import { ChampTexte } from '@/components/ui/champ'
import { Bouton, LienBouton } from '@/components/ui/bouton'
import { FeuilleOrdonnance, ENTETE_DEFAUT, type OrdonnanceFeuille } from '@/components/medical/feuille-ordonnance'
import { genererCleIdempotence, messageErreur, requeteApi } from '@/lib/api-client'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  GENERATEUR D'ORDONNANCE (§21)
 * =============================================================================
 *
 *  Atelier en DEUX COLONNES, dans le vocabulaire visuel du tableau de bord :
 *  cartes, champs et boutons du systeme existant — rien d'exotique.
 *
 *    gauche : choix du patient, date, lignes de medicaments, en-tete clinique
 *    droite : apercu A5 temps reel de la feuille qui sera imprimee
 *
 *  L'ENREGISTREMENT PRECEDE L'IMPRESSION : « Enregistrer et imprimer »
 *  envoie d'abord la prescription a l'API (POST /api/patients/:id/prescriptions,
 *  protegee par cle d'idempotence), et n'ouvre la boite d'impression du
 *  navigateur QUE si la sauvegarde a reussi. Une ordonnance jamais imprimee
 *  sans etre enregistree.
 */

/** Seul le nom du medicament est saisi : la posologie n'est plus demandee. */
interface LigneSaisie {
  medicament: string}

interface PagePatients {
  elements: Array<{ id: string; nom: string; prenom: string; age: number | null }>
}

function dateDuJour(): string {
  const maintenant = new Date()
  const decalage = maintenant.getTimezoneOffset() * 60_000
  return new Date(maintenant.getTime() - decalage).toISOString().slice(0, 10)
}

const LIGNE_VIDE: LigneSaisie = { medicament: '' }

export function GenerateurOrdonnance(): React.JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const patientIdParam = params.get('patientId')

  // ── Patient ────────────────────────────────────────────────────────────────
  const [patientId, setPatientId] = useState(patientIdParam ?? '')
  const [nomPatient, setNomPatient] = useState('')
  // Identite du patient recuperee DIRECTEMENT de la base de donnees : la
  // secretaire ne saisit jamais nom/prenom/age a la main.
  const [recherchePatient, setRecherchePatient] = useState('')
  const [listeOuverte, setListeOuverte] = useState(false)

  const rechercheDifferee = useDebounce(recherchePatient.trim(), 250)
  const patientsUrl = listeOuverte
    ? rechercheDifferee.length > 0
      ? `/api/patients?taille=100&prefix=${encodeURIComponent(rechercheDifferee)}`
      : '/api/patients?taille=20&tri=recent&ordre=desc'
    : null
  const { donnees: patients, chargement: chargementPatients } = useRequete<PagePatients>(patientsUrl)
  // Patient selectionne (parametre d'URL ou choix dans la liste) : fiche lue
  // en direct dans la base -> Nom / Prenom / Age remplis AUTOMATIQUEMENT.
  const { donnees: patientChoisi } = useRequete<{
    patient: { id: string; nom: string; prenom: string; age: number | null }
  }>(patientId ? `/api/patients/${patientId}` : null)

  useEffect(() => {
    if (patientChoisi) setNomPatient(`${patientChoisi.patient.prenom} ${patientChoisi.patient.nom}`)
  }, [patientChoisi])

  // ── Contenu de l'ordonnance ───────────────────────────────────────────────
  const [date, setDate] = useState(dateDuJour())
  const [lignes, setLignes] = useState<LigneSaisie[]>([{ ...LIGNE_VIDE }])
  const [entete, setEntete] = useState<EnteteOrdonnance>({ ...ENTETE_DEFAUT })

  // ── Soumission ────────────────────────────────────────────────────────────
  const [idempotencyKey] = useState(() => genererCleIdempotence())
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)

  // ── Apercu live ───────────────────────────────────────────────────────────
  const feuille: OrdonnanceFeuille = {
    date,
    nom: patientChoisi?.patient.nom ?? '',
    prenom: patientChoisi?.patient.prenom ?? '',
    agePatient: patientChoisi?.patient.age ? `${patientChoisi.patient.age} ans` : null,
      lignes: lignes
      .filter((ligne) => ligne.medicament.trim())
      .map((ligne) => ({
        medicament: ligne.medicament.trim(),
        dosage: '',
        frequence: '',
        duree: '',
        instructions: null,
      })),
    notes: null,
    entete,
  }

  function modifierLigne(index: number, champ: keyof LigneSaisie, valeur: string): void {
    setLignes((anciennes) => anciennes.map((ligne, i) => (i === index ? { ...ligne, [champ]: valeur } : ligne)))
  }

  function ajouterLigne(): void {
    setLignes((anciennes) => [...anciennes, { ...LIGNE_VIDE }])
  }

  function retirerLigne(index: number): void {
    setLignes((anciennes) => (anciennes.length === 1 ? [{ ...LIGNE_VIDE }] : anciennes.filter((_, i) => i !== index)))
  }

  /**
   * ENREGISTRER PUIS IMPRIMER — dans cet ordre, jamais l'inverse.
   * La feuille imprimee est rendue dans un conteneur dedie monte juste avant
   * l'appel a `window.print()` ; le media print CSS n'affiche que lui.
   */
  async function enregistrerEtImprimer(): Promise<void> {
    setErreur(null)
    setSucces(null)

    if (!patientId) {
      setErreur('Sélectionnez un patient existant.')
      return
    }
    const lignesValides = lignes.filter((ligne) => ligne.medicament.trim().length > 0)
    if (lignesValides.length === 0) {
      setErreur(t('ordonnances.aucunMedicament'))
      return
    }

    setEnCours(true)
    try {
      const reponse = await requeteApi<{ ordonnance: { id: string }; dejaEnregistre?: boolean }>(
        `/api/patients/${patientId}/prescriptions`,
        {
          methode: 'POST',
            corps: {
            patientId,
            date,
            notes: '',
            idempotencyKey,
            entete,
            lignes: lignesValides.map((ligne) => ({
              medicament: ligne.medicament.trim(),
              dosage: '',
              frequence: '',
              duree: '',
              instructions: '',
              notes: '',
            })),
          },
        },
      )

      // La sauvegarde a reussi : confirmation, puis impression.
      setSucces(t('ordonnances.creerReussie'))

      const conteneur = document.createElement('div')
      conteneur.className = 'impression-ordonnance'
      conteneur.setAttribute('data-ordonnance-id', reponse.ordonnance.id)
      document.body.appendChild(conteneur)

      // Rendu React de la feuille dans le conteneur d'impression.
      const { createRoot } = await import('react-dom/client')
      const racine = createRoot(conteneur)
      // Les lignes sont des donnees simples (strings) : serialize en JSX direct.
      racine.render(
        <FeuilleOrdonnance
          ordonnance={{
            ...feuille,
            lignes: lignesValides.map((ligne) => ({
              medicament: ligne.medicament.trim(),
              dosage: '',
              frequence: '',
              duree: '',
              instructions: null,
            })),
          }}
        />,
      )

      // Laisse le navigateur peindre la feuille avant d'ouvrir la boite.
      await new Promise((resoudre) => setTimeout(resoudre, 150))
      window.print()

      racine.unmount()
      conteneur.remove()

      router.push(`/patients/${patientId}`)
      router.refresh()
    } catch (cause) {
      setErreur(messageErreur(cause))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="atelier-ordonnance">
      {/* ── Colonne formulaire ──────────────────────────────────────────────── */}
      <form
        onSubmit={(evenement) => {
          evenement.preventDefault()
          void enregistrerEtImprimer()
        }}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}
      >
        <section className="carte">
          <div className="carte-entete">
            <h2 className="carte-titre">{t('ordonnances.nouvelle')}</h2>
          </div>
          <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
            {erreur ? (
              <div className="encadre-erreur" role="alert">
                {erreur}
              </div>
            ) : null}
            {succes ? (
              <div className="encadre-succes" role="status">
                {succes}
              </div>
            ) : null}

            {/* Patient : combobox identique au formulaire de rendez-vous. */}
            <div className="champ" style={{ position: 'relative' }}>
              <label htmlFor="nom-patient-ordonnance" className="champ-etiquette champ-obligatoire">
                Nom du patient
              </label>
              <input
                id="nom-patient-ordonnance"
                className="champ-controle"
                role="combobox"
                autoComplete="off"
                placeholder={t('patients.placeholderRecherche')}
                value={nomPatient}
                readOnly={Boolean(patientIdParam)}
                aria-expanded={listeOuverte && !patientIdParam}
                aria-autocomplete="list"
                aria-controls="suggestions-patients-ordonnance"
                onFocus={() => {
                  if (!patientIdParam) setListeOuverte(true)
                }}
                onChange={(evenement) => {
                  setNomPatient(evenement.target.value)
                  setRecherchePatient(evenement.target.value)
                  setPatientId('')
                  setListeOuverte(true)
                }}
                onBlur={() => window.setTimeout(() => setListeOuverte(false), 150)}
              />
              {listeOuverte && !patientIdParam ? (
                <div
                  id="suggestions-patients-ordonnance"
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
                      {t('recherche.aucunResultat')}
                    </p>
                  ) : null}
                  {patients?.elements.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      role="option"
                      aria-selected={patientId === patient.id}
                      className="bouton-discret"
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: 'var(--espace-2) var(--espace-3)',
                        borderBottom: '1px solid var(--bordure-douce)',
                        textAlign: 'left',
                      }}
                      onMouseDown={(evenement) => evenement.preventDefault()}
                      onClick={() => {
                        setPatientId(patient.id)
                        setNomPatient(`${patient.prenom} ${patient.nom}`)
                        setRecherchePatient('')
                        setListeOuverte(false)
                      }}
                    >
                      {patient.prenom} {patient.nom}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <ChampTexte nom="date-ordonnance" type="date" etiquette={t('commun.date')} obligatoire value={date} onChange={(evenement) => setDate(evenement.target.value)} />
          </div>
        </section>

        {/* Lignes de médicaments */}
        <section className="carte">
          <div className="carte-entete">
            <h2 className="carte-titre">{t('ordonnances.lignes')}</h2>
          </div>
          <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
            <div className="lignes-ordonnance">
              {lignes.map((ligne, index) => (
                <div key={index} className="ligne-ordonnance">
                  <div className="ligne-ordonnance-entete">
                    <span className="ligne-ordonnance-numero">
                      {t('ordonnances.medicament')} {index + 1}
                    </span>
                    <button
                      type="button"
                      className="bouton bouton-discret bouton-petit"
                      onClick={() => retirerLigne(index)}
                      aria-label={`${t('ordonnances.retirerMedicament')} ${index + 1}`}
                    >
                      {t('ordonnances.retirerMedicament')}
                    </button>
                  </div>
                  <ChampTexte
                    nom={`medicament-${index}`}
                    etiquette={t('ordonnances.medicament')}
                    obligatoire
                    value={ligne.medicament}
                    onChange={(evenement) => modifierLigne(index, 'medicament', evenement.target.value)}
                  />
                </div>
              ))}
            </div>

            <Bouton type="button" variante="secondaire" onClick={ajouterLigne}>
              {t('ordonnances.ajouterMedicament')}
            </Bouton>
          </div>
        </section>

        {/* En-tête clinique (repliable) */}
        <section className="carte">
          <div className="carte-entete">
            <h2 className="carte-titre">{t('ordonnances.enteteClinique')}</h2>
          </div>
          <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
            <ChampTexte nom="titre-arabe" etiquette={t('ordonnances.titreArabe')} value={entete.titreArabe} onChange={(evenement) => setEntete({ ...entete, titreArabe: evenement.target.value })} />
            <ChampTexte nom="nom-clinique" etiquette={t('ordonnances.nomClinique')} value={entete.nomClinique} onChange={(evenement) => setEntete({ ...entete, nomClinique: evenement.target.value })} />
            <ChampTexte nom="nom-praticien" etiquette={t('ordonnances.nomPraticien')} value={entete.nomPraticien} onChange={(evenement) => setEntete({ ...entete, nomPraticien: evenement.target.value })} />
            <div className="champ">
              <label htmlFor="adresse-ordonnance" className="champ-etiquette">
                {t('ordonnances.adresse')}
              </label>
              <textarea
                id="adresse-ordonnance"
                className="champ-controle"
                rows={2}
                dir="auto"
                value={entete.adresse}
                onChange={(evenement) => setEntete({ ...entete, adresse: evenement.target.value })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--espace-3)' }}>
              <ChampTexte nom="telephone-ordonnance" etiquette={t('ordonnances.telephone')} value={entete.telephone} onChange={(evenement) => setEntete({ ...entete, telephone: evenement.target.value })} />
              <ChampTexte nom="horaires-ordonnance" etiquette={t('ordonnances.horaires')} value={entete.horaires} onChange={(evenement) => setEntete({ ...entete, horaires: evenement.target.value })} />
            </div>
            <ChampTexte nom="ville-ordonnance" etiquette={t('ordonnances.ville')} value={entete.ville} onChange={(evenement) => setEntete({ ...entete, ville: evenement.target.value })} />
            <ChampTexte nom="conseil-ordonnance" etiquette={t('ordonnances.conseil')} value={entete.conseil} onChange={(evenement) => setEntete({ ...entete, conseil: evenement.target.value })} />
          </div>
        </section>

        {/* Action principale : enregistrer AVANT d'imprimer. */}
        <div style={{ display: 'flex', gap: 'var(--espace-3)', alignItems: 'center' }}>
          <Bouton type="submit" variante="principal" disabled={enCours}>
            {enCours ? t('commun.chargement') : t('ordonnances.enregistrerEtImprimer')}
          </Bouton>
          <LienBouton href="/ordonnances" variante="discret">
            {t('commun.retour')}
          </LienBouton>
        </div>
      </form>

      {/* ── Colonne aperçu ──────────────────────────────────────────────────── */}
      <section aria-label={t('ordonnances.apercu')} className="zone-telechargement-ordonnance">
        <FeuilleOrdonnance ordonnance={feuille} />
      </section>
    </div>
  )
}
