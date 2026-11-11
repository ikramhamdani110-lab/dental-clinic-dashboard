'use client'

import { createRoot } from 'react-dom/client'

import Link from 'next/link'
import { createElement, useState } from 'react'

import { t } from '@content/index'

import type { EnteteOrdonnance } from '@backend/validation/schemas'

import { FeuilleOrdonnance, type OrdonnanceFeuille } from '@/components/medical/feuille-ordonnance'
import { Bouton } from '@/components/ui/bouton'
import { Pagination } from '@/components/patients/liste-patients'
import { useRequete } from '@/lib/hooks/use-requete'
import { localeDates } from '@/lib/locale-dates'

/**
 * =============================================================================
 *  ONGLET ORDONNANCES DE LA FICHE PATIENT (§21)
 * =============================================================================
 *
 *  Historique complet des prescriptions du patient, directement dans son
 *  dossier. Chaque carte propose la feuille complete et la reimpression
 *  navigateur (A5) — les donnees viennent TOUJOURS de la base, jamais d'un
 *  stockage local.
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

const TAILLE_PAGE = 10

export function OngletOrdonnances({ patientId }: { patientId: string }): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [ordonnanceOuverte, setOrdonnanceOuverte] = useState<string | null>(null)

  const historique = useRequete<ReponseOrdonnances>(
    `/api/patients/${patientId}/prescriptions?page=${page}&taille=${TAILLE_PAGE}`,
  )

  // Feuille demandee : une seule ordonnance lue en entier.
  const { donnees: detail } = useRequete<{
    ordonnance: Ordonnance
    patient: { nom: string; prenom: string; age: number | null }
  }>(ordonnanceOuverte ? `/api/patients/${patientId}/prescriptions/${ordonnanceOuverte}` : null)

  if (ordonnanceOuverte) {
    if (detail) {
      const { ordonnance, patient } = detail
      const feuille: OrdonnanceFeuille = {
        date: ordonnance.date,
        nom: patient.nom,
        prenom: patient.prenom,
        agePatient: patient.age ? `${patient.age} ans` : null,
        lignes: ordonnance.lignes,
        notes: ordonnance.notes,
        entete: ordonnance.entete,
      }
      return <Visionneuse feuille={feuille} onFermer={() => setOrdonnanceOuverte(null)} />
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
      <div className="etat-vide">
        <p className="etat-vide-titre">{t('fichePatient.aucuneOrdonnance')}</p>
        <Link href={`/ordonnances/nouvelle?patientId=${patientId}`} className="bouton-lien">
          {t('ordonnances.nouvelle')}
        </Link>
      </div>
    )
  }

  const donnees = historique.donnees

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      {donnees.ordonnances.map((ordonnance) => (
        <section key={ordonnance.id} className="carte">
          <div className="carte-entete">
            <h3 className="carte-titre">{new Date(ordonnance.date).toLocaleDateString(localeDates())}</h3>
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
              <Link
                href={`/ordonnances?patientId=${patientId}&ordonnanceId=${ordonnance.id}`}
                className="bouton bouton-discret bouton-petit"
              >
                {t('ordonnances.reimprimer')}
              </Link>
            </div>
          </div>
        </section>
      ))}

      <Pagination page={donnees.page} pages={donnees.pages} total={donnees.total} onChangerPage={setPage} />
    </div>
  )
}

/** Feuille complete + reimpression, a l'interieur de l'onglet. */
function Visionneuse({
  feuille,
  onFermer,
}: {
  feuille: OrdonnanceFeuille
  onFermer: () => void
}): React.JSX.Element {
  const [impressionEnCours, setImpressionEnCours] = useState(false)

  function reimprimer(): void {
    setImpressionEnCours(true)
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
      <div style={{ display: 'flex', gap: 'var(--espace-2)' }}>
        <Bouton type="button" variante="principal" taille="petite" onClick={reimprimer} disabled={impressionEnCours}>
          {t('ordonnances.reimprimer')}
        </Bouton>
        <Bouton type="button" variante="discret" taille="petite" onClick={onFermer}>
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
