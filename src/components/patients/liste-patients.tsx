'use client'

import Link from 'next/link'
import { useState } from 'react'

import { t } from '@content/index'

import { Bouton, LienBouton } from '@/components/ui/bouton'
import { ChampTexte } from '@/components/ui/champ'
import { formaterAgePatient } from '@/lib/age'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  LISTE DES PATIENTS (§9, §26)
 * =============================================================================
 *
 *  - La recherche est DEBOUNCEE : une requete par frappe sature inutilement la
 *    base (§26, §35).
 *  - La pagination est SERVEUR : aucune liste complete n'est telechargee.
 *  - L'identifiant interne n'est JAMAIS affiche (§48) : la ligne montre nom,
 *    prenom, telephone et age.
 *  - La DATE DE NAISSANCE n'est JAMAIS affichee : la colonne montre l'AGE,
 *    derive de cette date (voir `lib/age`).
 */

interface PatientListe {
  id: string
  nom: string
  prenom: string
  telephone: string
  /** Age saisi au cabinet ; repli sur la date de naissance a l'affichage. */
  age: number | null
  dateNaissance: string | null
  sexe: string
  createdAt: string
}

interface ReponsePatients {
  elements: PatientListe[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

export function ListePatients(): React.JSX.Element {
  const [recherche, setRecherche] = useState('')
  const [page, setPage] = useState(1)
  const rechercheDifferee = useDebounce(recherche, 300)

  const chemin = `/api/patients?page=${page}&taille=${TAILLE_PAGE}${
    rechercheDifferee ? `&recherche=${encodeURIComponent(rechercheDifferee)}` : ''
  }`

  const { donnees, chargement, erreur, recharger } = useRequete<ReponsePatients>(chemin)

  // Une nouvelle recherche ramene toujours a la premiere page.
  function changerRecherche(valeur: string): void {
    setRecherche(valeur)
    setPage(1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="barre-outils">
        <div className="barre-outils-groupe" style={{ flex: 1, maxWidth: '24rem' }}>
          <ChampTexte
            nom="recherche-patient"
            etiquette={t('patients.rechercher')}
            placeholder={t('patients.placeholderRecherche')}
            value={recherche}
            onChange={(evenement) => changerRecherche(evenement.target.value)}
          />
        </div>
        <LienBouton href="/patients/nouveau" variante="principal">
          {t('patients.nouveau')}
        </LienBouton>
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
          <p className="etat-vide-titre">
            {rechercheDifferee ? t('patients.aucunResultat') : t('patients.aucun')}
          </p>
          {!rechercheDifferee ? (
            <LienBouton href="/patients/nouveau" variante="principal">
              {t('patients.nouveau')}
            </LienBouton>
          ) : null}
        </div>
      ) : null}

      {donnees && donnees.elements.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <caption>
                {donnees.total} {donnees.total > 1 ? t('commun.resultats') : t('commun.resultat')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('patients.nom')}</th>
                  <th scope="col">{t('patients.prenom')}</th>
                  <th scope="col">{t('patients.age')}</th>
                  <th scope="col">{t('patients.telephone')}</th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.elements.map((patient) => (
                  <tr key={patient.id}>
                    <td data-etiquette={t('patients.nom')}>{patient.nom}</td>
                    <td data-etiquette={t('patients.prenom')}>{patient.prenom}</td>
                    <td data-etiquette={t('patients.age')}>{formaterAgePatient(patient)}</td>
                    <td data-etiquette={t('patients.telephone')}>{patient.telephone}</td>
                    <td data-etiquette={t('commun.actions')}>
                      {/* La fiche est atteinte par l'identifiant interne dans l'URL,
                          mais cet identifiant n'est pas AFFICHE (§48). */}
                      <Link href={`/patients/${patient.id}`} className="bouton-lien">
                        {t('patients.fiche')}
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

/** Controles de pagination, accessibles au clavier. */export function Pagination({
  page,
  pages,
  total,
  onChangerPage,
}: {
  page: number
  pages: number
  total: number
  onChangerPage: (page: number) => void
}): React.JSX.Element {
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {t('tableaux.page')} {page} {t('tableaux.sur')} {pages} — {total}
      </span>
      <div className="pagination-controles">
        <Bouton
          variante="secondaire"
          taille="petite"
          onClick={() => onChangerPage(1)}
          disabled={page <= 1}
          aria-label={t('tableaux.premierePage')}
        >
          «
        </Bouton>
        <Bouton
          variante="secondaire"
          taille="petite"
          onClick={() => onChangerPage(page - 1)}
          disabled={page <= 1}
        >
          {t('commun.precedent')}
        </Bouton>
        <Bouton
          variante="secondaire"
          taille="petite"
          onClick={() => onChangerPage(page + 1)}
          disabled={page >= pages}
        >
          {t('commun.suivant')}
        </Bouton>
        <Bouton
          variante="secondaire"
          taille="petite"
          onClick={() => onChangerPage(pages)}
          disabled={page >= pages}
          aria-label={t('tableaux.dernierePage')}
        >
          »
        </Bouton>
      </div>
    </nav>
  )
}
