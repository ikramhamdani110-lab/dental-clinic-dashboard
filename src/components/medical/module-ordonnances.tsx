'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

import { SelecteurPatient } from '@/components/patients/selecteur-patient'
import { Pagination } from '@/components/patients/liste-patients'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  ORDONNANCES (§21, §35)
 * =============================================================================
 *
 *  Ordonnances NUMERIQUES uniquement : aucun PDF n'est genere (§45). Chaque
 *  ordonnance reste dans l'historique du patient.
 *
 *  L'historique etant conserve a vie, la liste est PAGINEE COTE SERVEUR : seule
 *  la page demandee est lue en base.
 */

interface LigneOrdonnance {
  id: string
  medicament: string
  dosage: string
  frequence: string
  duree: string
}

interface Ordonnance {
  id: string
  date: string
  notes: string | null
  auteur: string | null
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

export function ModuleOrdonnances(): React.JSX.Element {
  const params = useSearchParams()
  const patientId = params.get('patientId')
  const [page, setPage] = useState(1)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseOrdonnances>(
    patientId ? `/api/patients/${patientId}/prescriptions?page=${page}&taille=${TAILLE_PAGE}` : null,
  )

  if (!patientId) {
    return <SelecteurPatient lienBase="ordonnances" titre={t('fichePatient.nouvelleOrdonnance')} />
  }

  if (chargement && !donnees) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

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

  if (!donnees || donnees.ordonnances.length === 0) {
    return (
      <div className="etat-vide">
        <p className="etat-vide-titre">{t('fichePatient.aucuneOrdonnance')}</p>
        <p className="etat-vide-texte">{t('ordonnances.numeriqueUniquement')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <p className="champ-aide">{t('ordonnances.numeriqueUniquement')}</p>
      {donnees.ordonnances.map((ordonnance) => (
        <section key={ordonnance.id} className="carte">
          <div className="carte-entete">
            <h2 className="carte-titre">{new Date(ordonnance.date).toLocaleDateString('fr-FR')}</h2>
            {ordonnance.auteur ? (
              <span className="liste-compacte-detail">{ordonnance.auteur}</span>
            ) : null}
          </div>
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
        </section>
      ))}

      <Pagination
        page={donnees.page}
        pages={donnees.pages}
        total={donnees.total}
        onChangerPage={setPage}
      />
    </div>
  )
}
