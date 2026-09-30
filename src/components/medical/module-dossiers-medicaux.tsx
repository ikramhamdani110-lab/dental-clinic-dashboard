'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

import { SelecteurPatient } from '@/components/patients/selecteur-patient'
import { Pagination } from '@/components/patients/liste-patients'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  DOSSIERS MEDICAUX D'UN PATIENT (§19, §35)
 * =============================================================================
 *
 *  Chaque entree est une observation datee, jamais un champ de notes unique.
 *  L'historique d'un patient suivi des annees peut devenir long : la liste est
 *  donc PAGINEE COTE SERVEUR. Le navigateur ne recoit qu'une page.
 */

interface EntreeMedicale {
  id: string
  date: string
  motifPlainte: string | null
  diagnostic: string | null
  traitementRealise: string | null
  auteur: string | null
}

interface ReponseDossiers {
  dossiers: EntreeMedicale[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

export function ModuleDossiersMedicaux(): React.JSX.Element {
  const params = useSearchParams()
  const patientId = params.get('patientId')
  const [page, setPage] = useState(1)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseDossiers>(
    patientId
      ? `/api/patients/${patientId}/medical-records?page=${page}&taille=${TAILLE_PAGE}`
      : null,
  )

  if (!patientId) {
    return (
      <SelecteurPatient
        lienBase="dossiers-medicaux"
        titre={t('fichePatient.ajouterDossierMedical')}
      />
    )
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

  if (!donnees || donnees.dossiers.length === 0) {
    return (
      <div className="etat-vide">
        <p className="etat-vide-titre">{t('fichePatient.aucunDossierMedical')}</p>
        <p className="etat-vide-texte">{t('dossiersMedicaux.chaqueEntreeHistorique')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="carte">
        <div className="tableau-conteneur">
          <table className="tableau tableau-cartes">
            <thead>
              <tr>
                <th scope="col">{t('commun.date')}</th>
                <th scope="col">{t('dossiersMedicaux.motifPlainte')}</th>
                <th scope="col">{t('dossiersMedicaux.diagnostic')}</th>
                <th scope="col">{t('dossiersMedicaux.traitementRealise')}</th>
              </tr>
            </thead>
            <tbody>
              {donnees.dossiers.map((dossier) => (
                <tr key={dossier.id}>
                  <td data-etiquette={t('commun.date')}>
                    {new Date(dossier.date).toLocaleDateString('fr-FR')}
                  </td>
                  <td data-etiquette={t('dossiersMedicaux.motifPlainte')}>
                    {dossier.motifPlainte ?? '—'}
                  </td>
                  <td data-etiquette={t('dossiersMedicaux.diagnostic')}>
                    {dossier.diagnostic ?? '—'}
                  </td>
                  <td data-etiquette={t('dossiersMedicaux.traitementRealise')}>
                    {dossier.traitementRealise ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
