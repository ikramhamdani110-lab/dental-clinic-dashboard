'use client'

import Link from 'next/link'
import { useState } from 'react'

import { t, contenu } from '@content/index'
import { formaterMontant } from '@backend/domain/finance'

import { BadgeStatutTraitement } from '@/components/ui/badge-statut'
import { ChampSelection, ChampTexte } from '@/components/ui/champ'
import { Pagination } from '@/components/patients/liste-patients'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

/**
 * Liste des traitements (§12, §26).
 * Filtres : recherche patient, statut. Pagination serveur.
 * Le reste a payer est calcule en base, jamais stocke (§12).
 */

interface Traitement {
  id: string
  patientId: string
  typeTraitement: string
  dents: string[]
  prixTotalCentimes: number
  montantPayeCentimes: number
  resteAPayerCentimes: number
  statut: string
  nombreVisites: number
}

interface ReponseTraitements {
  elements: Traitement[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

export function ListeTraitements(): React.JSX.Element {
  const [recherche, setRecherche] = useState('')
  const [statut, setStatut] = useState('')
  const [page, setPage] = useState(1)
  const rechercheDifferee = useDebounce(recherche, 300)

  const parametres = new URLSearchParams({ page: String(page), taille: String(TAILLE_PAGE) })
  if (rechercheDifferee) parametres.set('recherche', rechercheDifferee)
  if (statut) parametres.set('statut', statut)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseTraitements>(
    `/api/treatments?${parametres.toString()}`,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="barre-outils">
        <div className="barre-outils-groupe" style={{ flex: 1 }}>
          <div style={{ minWidth: '16rem', flex: 1 }}>
            <ChampTexte
              nom="recherche-traitement"
              etiquette={t('patients.rechercher')}
              placeholder={t('patients.placeholderRecherche')}
              value={recherche}
              onChange={(evenement) => {
                setRecherche(evenement.target.value)
                setPage(1)
              }}
            />
          </div>
          <div style={{ minWidth: '12rem' }}>
            <ChampSelection
              nom="statut"
              etiquette={t('commun.statut')}
              value={statut}
              placeholder={t('recherche.tousLesStatuts')}
              onChange={(evenement) => {
                setStatut(evenement.target.value)
                setPage(1)
              }}
              options={Object.entries(contenu.traitements.statuts).map(([valeur, libelle]) => ({
                valeur,
                libelle,
              }))}
            />
          </div>
        </div>
      </div>

      {chargement && !donnees ? (
        <div className="etat-vide">
          <span className="rotation" aria-hidden="true" />
          <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
        </div>
      ) : null}

      {erreur ? (
        <div className="encadre-erreur" role="alert">
          <p>{erreur}</p>
          <button type="button" className="bouton-lien" onClick={recharger}>
            {t('erreurs.reessayer')}
          </button>
        </div>
      ) : null}

      {donnees && donnees.elements.length === 0 ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('traitements.aucunResultat')}</p>
        </div>
      ) : null}

      {donnees && donnees.elements.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('traitements.typeTraitement')}</th>
                  <th scope="col">{t('traitements.dents')}</th>
                  <th scope="col" className="tableau-numerique">
                    {t('traitements.prixTotal')}
                  </th>
                  <th scope="col" className="tableau-numerique">
                    {t('traitements.montantPaye')}
                  </th>
                  <th scope="col" className="tableau-numerique">
                    {t('traitements.resteAPayer')}
                  </th>
                  <th scope="col">{t('commun.statut')}</th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.elements.map((traitement) => (
                  <tr key={traitement.id}>
                    <td data-etiquette={t('traitements.typeTraitement')}>
                      {traitement.typeTraitement}
                    </td>
                    <td data-etiquette={t('traitements.dents')}>
                      {traitement.dents.length > 0 ? traitement.dents.join(', ') : '—'}
                    </td>
                    <td data-etiquette={t('traitements.prixTotal')} className="tableau-numerique">
                      {formaterMontant(traitement.prixTotalCentimes)}
                    </td>
                    <td data-etiquette={t('traitements.montantPaye')} className="tableau-numerique">
                      {formaterMontant(traitement.montantPayeCentimes)}
                    </td>
                    <td data-etiquette={t('traitements.resteAPayer')} className="tableau-numerique">
                      {formaterMontant(traitement.resteAPayerCentimes)}
                    </td>
                    <td data-etiquette={t('commun.statut')}>
                      <BadgeStatutTraitement statut={traitement.statut} />
                    </td>
                    <td data-etiquette={t('commun.actions')}>
                      <Link href={`/traitements/${traitement.id}`} className="bouton-lien">
                        {t('commun.details')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={donnees.page}
            pages={donnees.pages}
            total={donnees.total}
            onChangerPage={setPage}
          />
        </>
      ) : null}
    </div>
  )
}
