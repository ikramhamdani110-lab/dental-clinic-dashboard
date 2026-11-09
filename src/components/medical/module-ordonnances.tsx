'use client'

import { useSearchParams } from 'next/navigation'
import { createElement, useState } from 'react'

import { createRoot } from 'react-dom/client'

import Link from 'next/link'

import { t } from '@content/index'

import type { EnteteOrdonnance } from '@backend/validation/schemas'

import { FeuilleOrdonnance, type OrdonnanceFeuille } from '@/components/medical/feuille-ordonnance'
import { Pagination } from '@/components/patients/liste-patients'
import { Bouton } from '@/components/ui/bouton'
import { ChampTexte } from '@/components/ui/champ'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'
import { localeDates } from '@/lib/locale-dates'

/**
 * =============================================================================
 *  ORDONNANCES (§21, §35)
 * =============================================================================
 *
 *  Ordonnances numeriques conservees a vie dans l'historique du patient.
 *  L'impression est faite PAR LE NAVIGATEUR (feuille A5, media print) — aucun
 *  PDF n'est fabrique par le serveur.
 *
 *  Trois etats, selon l'URL :
 *    - sans `patientId`    : selecteur de patient (nom / prenom / telephone),
 *    - avec `patientId`    : historique pagine du patient,
 *    - avec `ordonnanceId` : feuille complete + reimpression.
 */

interface LigneOrdonnance {
  id: string
  medicament: string
  dosage: string
  frequence: string
  duree: string
  instructions: string | null
}

interface Ordonnance {
  id: string
  date: string
  notes: string | null
  auteur: string | null
  entete: EnteteOrdonnance | null
  lignes: LigneOrdonnance[]
}

interface ReponseOrdonnances {
  ordonnances: Ordonnance[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

interface PatientRecherche {
  id: string
  nom: string
  prenom: string
  telephone: string
}

export function ModuleOrdonnances(): React.JSX.Element {
  const params = useSearchParams()
  const patientId = params.get('patientId')
  const ordonnanceId = params.get('ordonnanceId')
  const [page, setPage] = useState(1)

  // ── Feuille demandee seule (visionneuse + reimpression) ───────────────────
  const { donnees: detail } = useRequete<{
    ordonnance: Ordonnance
    patient: { nom: string; prenom: string; age: number | null }
  }>(patientId && ordonnanceId ? `/api/patients/${patientId}/prescriptions/${ordonnanceId}` : null)

  if (patientId && ordonnanceId) {
    if (detail) {
      const { ordonnance, patient } = detail
      const feuille: OrdonnanceFeuille = {
        date: ordonnance.date,
        nomPatient: `${patient.prenom} ${patient.nom}`,
        agePatient: patient.age ? `${patient.age} ans` : null,
        lignes: ordonnance.lignes,
        notes: ordonnance.notes,
        entete: ordonnance.entete,
      }
      return <VisionneuseOrdonnance patientId={patientId} feuille={feuille} onFermer={() => {}} />
    }
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  // ── Historique pagine du patient (ou selecteur) ───────────────────────────
  return <HistoriqueOrdonnances patientId={patientId} page={page} setPage={setPage} />
}

function HistoriqueOrdonnances({
  patientId,
  page,
  setPage,
}: {
  patientId: string | null
  page: number
  setPage: (valeur: number) => void
}): React.JSX.Element {
  const [recherche, setRecherche] = useState('')
  const [ordonnanceOuverte, setOrdonnanceOuverte] = useState<string | null>(null)
  const rechercheDifferee = useDebounce(recherche, 300)

  const { donnees: patients, chargement: chargementPatients } = useRequete<{ elements: PatientRecherche[] }>(
    !patientId && rechercheDifferee ? `/api/patients?recherche=${encodeURIComponent(rechercheDifferee)}&taille=10` : null,
  )
  const { donnees: patientFiche } = useRequete<{
    patient: { id: string; nom: string; prenom: string; age: number | null }
  }>(patientId ? `/api/patients/${patientId}` : null)
  const historique = useRequete<ReponseOrdonnances>(
    patientId && !ordonnanceOuverte
      ? `/api/patients/${patientId}/prescriptions?page=${page}&taille=${TAILLE_PAGE}`
      : null,
  )
  const { donnees: detailOuvert } = useRequete<{
    ordonnance: Ordonnance
    patient: { nom: string; prenom: string; age: number | null }
  }>(patientId && ordonnanceOuverte ? `/api/patients/${patientId}/prescriptions/${ordonnanceOuverte}` : null)

  if (!patientId) {
    // Selecteur de patient, identique aux autres modules cliniques.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
        <div className="carte">
          <div className="carte-corps">
            <ChampTexte
              nom="recherche-selecteur-ordonnance"
              etiquette={t('patients.rechercher')}
              placeholder={t('patients.placeholderRecherche')}
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
            />
          </div>
        </div>

        {chargementPatients ? (
          <div className="etat-vide">
            <span className="rotation" aria-hidden="true" />
            <p className="etat-vide-texte">{t('recherche.rechercheEnCours')}</p>
          </div>
        ) : null}

        {patients && patients.elements.length > 0 ? (
          <div className="carte">
            <div className="liste-compacte">
              {patients.elements.map((patient) => (
                <div key={patient.id} className="liste-compacte-element">
                  <span className="liste-compacte-principal">
                    <span className="liste-compacte-titre">
                      {patient.prenom} {patient.nom}
                    </span>
                    <span className="liste-compacte-detail">{patient.telephone}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 'var(--espace-2)' }}>
                    <Link href={`/ordonnances?patientId=${patient.id}`} className="bouton-lien">
                      {t('commun.voirTout')}
                    </Link>
                    <Link href={`/ordonnances/nouvelle?patientId=${patient.id}`} className="bouton-lien">
                      {t('ordonnances.nouvelle')}
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {patients && patients.elements.length === 0 && rechercheDifferee ? (
          <div className="etat-vide">
            <p className="etat-vide-texte">{t('recherche.aucunResultat')}</p>
          </div>
        ) : null}

        {!rechercheDifferee ? (
          <div className="etat-vide">
            <p className="etat-vide-titre">{t('ordonnances.titre')}</p>
            <p className="etat-vide-texte">{t('patients.placeholderRecherche')}</p>
          </div>
        ) : null}
      </div>
    )
  }

  // Visionneuse locale : feuille complete + reimpression, sans navigation.
  if (patientId && ordonnanceOuverte) {
    if (detailOuvert) {
      const { ordonnance, patient } = detailOuvert
      const feuille: OrdonnanceFeuille = {
        date: ordonnance.date,
        nomPatient: `${patient.prenom} ${patient.nom}`,
        agePatient: patient.age ? `${patient.age} ans` : null,
        lignes: ordonnance.lignes,
        notes: ordonnance.notes,
        entete: ordonnance.entete,
      }
      return <VisionneuseOrdonnance patientId={patientId} feuille={feuille} onFermer={() => setOrdonnanceOuverte(null)} />
    }
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (historique.chargement && !historique.donnees) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (historique.erreur) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{historique.erreur}</p>
        <button type="button" className="bouton-lien" onClick={historique.recharger}>
          {t('erreurs.reessayer')}
        </button>
      </div>
    )
  }

  if (!historique.donnees || historique.donnees.ordonnances.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
        <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
          <Link href="/ordonnances">{t('ordonnances.titre')}</Link>
          <span aria-hidden="true">/</span>
          <span>{patientFiche ? `${patientFiche.patient.prenom} ${patientFiche.patient.nom}` : ''}</span>
        </nav>
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('fichePatient.aucuneOrdonnance')}</p>
          <Link href={`/ordonnances/nouvelle?patientId=${patientId}`} className="bouton-lien">
            {t('ordonnances.nouvelle')}
          </Link>
        </div>
      </div>
    )
  }

  const donnees = historique.donnees

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/ordonnances">{t('ordonnances.titre')}</Link>
        <span aria-hidden="true">/</span>
        <span>{patientFiche ? `${patientFiche.patient.prenom} ${patientFiche.patient.nom}` : ''}</span>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link href={`/ordonnances/nouvelle?patientId=${patientId}`} className="bouton bouton-principal">
          {t('ordonnances.nouvelle')}
        </Link>
      </div>

      {donnees.ordonnances.map((ordonnance) => (
        <section key={ordonnance.id} className="carte">
          <div className="carte-entete">
            <h2 className="carte-titre">{new Date(ordonnance.date).toLocaleDateString(localeDates())}</h2>
            {ordonnance.auteur ? <span className="liste-compacte-detail">{ordonnance.auteur}</span> : null}
          </div>
          <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-3)' }}>
            <div className="tableau-conteneur">
              <table className="tableau tableau-cartes">
                <thead>
                  <tr>
                    <th scope="col">{t('ordonnances.medicament')}</th>
                    <th scope="col">{t('ordonnances.dosage')}</th>
                    <th scope="col">{t('ordonnances.frequence')}</th>
                    <th scope="col">{t('ordonnances.duree')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ordonnance.lignes.map((ligne) => (
                    <tr key={ligne.id}>
                      <td data-etiquette={t('ordonnances.medicament')}>{ligne.medicament}</td>
                      <td data-etiquette={t('ordonnances.dosage')}>{ligne.dosage}</td>
                      <td data-etiquette={t('ordonnances.frequence')}>{ligne.frequence}</td>
                      <td data-etiquette={t('ordonnances.duree')}>{ligne.duree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 'var(--espace-2)' }}>
              <button
                type="button"
                className="bouton bouton-secondaire bouton-petit"
                onClick={() => setOrdonnanceOuverte(ordonnance.id)}
              >
                {t('ordonnances.voir')}
              </button>
            </div>
          </div>
        </section>
      ))}

      <Pagination page={donnees.page} pages={donnees.pages} total={donnees.total} onChangerPage={setPage} />
    </div>
  )
}

/** Feuille complete : visionneuse + reimpression navigateur (A5). */
function VisionneuseOrdonnance({
  patientId,
  feuille,
  onFermer,
}: {
  patientId: string
  feuille: OrdonnanceFeuille
  onFermer: () => void
}): React.JSX.Element {
  const [impressionEnCours, setImpressionEnCours] = useState(false)

  function reimprimer(): void {
    setImpressionEnCours(true)
    // La feuille est rendue dans un conteneur dedie, retire apres la fermeture
    // de la boite d'impression : le media print CSS n'affiche que lui.
    const conteneur = document.createElement('div')
    conteneur.className = 'impression-ordonnance'
    document.body.appendChild(conteneur)
    const racine = createRoot(conteneur)
    racine.render(createElement(FeuilleOrdonnance, { ordonnance: feuille }))
    window.setTimeout(() => {
      window.print()
      racine.unmount()
      conteneur.remove()
      setImpressionEnCours(false)
    }, 150)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/ordonnances">{t('ordonnances.titre')}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/ordonnances?patientId=${patientId}`}>{t('commun.historique')}</Link>
      </nav>

      <div style={{ display: 'flex', gap: 'var(--espace-3)' }}>
        <Bouton type="button" variante="principal" onClick={reimprimer} disabled={impressionEnCours}>
          {t('ordonnances.reimprimer')}
        </Bouton>
        <Bouton type="button" variante="discret" onClick={onFermer}>
          {t('ordonnances.fermer')}
        </Bouton>
      </div>

      <div className="zone-telechargement-ordonnance">
        <div className="feuille-ordonnance-apercu">
          <FeuilleOrdonnance ordonnance={feuille} />
        </div>
      </div>
    </div>
  )
}
