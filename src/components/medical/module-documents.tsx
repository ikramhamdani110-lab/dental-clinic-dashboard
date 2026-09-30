'use client'

import { useSearchParams } from 'next/navigation'
import { useRef, useState } from 'react'

import { t, contenu } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampSelection, ChampTexte } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { SelecteurPatient } from '@/components/patients/selecteur-patient'
import { Pagination } from '@/components/patients/liste-patients'
import { messageErreur, requeteApi } from '@/lib/api-client'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  DOCUMENTS DU PATIENT (§22, §35)
 * =============================================================================
 *
 *  Televersement d'un document vers un stockage PRIVE. Le type reel du fichier
 *  est verifie cote serveur (signature binaire), la taille est bornee, et
 *  l'acces est authentifie. Aucune URL publique n'existe.
 *
 *  Le lien de telechargement passe par une route API privee : le fichier n'est
 *  jamais servi directement.
 *
 *  La liste est PAGINEE COTE SERVEUR : les documents s'accumulent avec les
 *  annees ; seule la page demandee est lue en base.
 */

interface DocumentListe {
  id: string
  nomOriginal: string
  mimeType: string
  tailleOctets: number
  categorie: string | null
  description: string | null
  createdAt: string
}

interface ReponseDocuments {
  documents: DocumentListe[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

export function ModuleDocuments(): React.JSX.Element {
  const params = useSearchParams()
  const patientId = params.get('patientId')
  const notifications = useNotifications()
  const refFichier = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseDocuments>(
    patientId ? `/api/patients/${patientId}/documents?page=${page}&taille=${TAILLE_PAGE}` : null,
  )

  const [categorie, setCategorie] = useState('RADIOGRAPHIE')
  const [description, setDescription] = useState('')
  const [enCours, setEnCours] = useState(false)

  if (!patientId) {
    return <SelecteurPatient lienBase="documents" titre={t('fichePatient.ajouterDocument')} />
  }

  async function televerser(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    const fichier = refFichier.current?.files?.[0]
    if (!fichier) {
      notifications.erreur(t('documents.aucun'))
      return
    }

    setEnCours(true)
    const formulaire = new FormData()
    formulaire.append('fichier', fichier)
    formulaire.append('categorie', categorie)
    formulaire.append('description', description)

    try {
      await requeteApi(`/api/patients/${patientId}/documents`, {
        methode: 'POST',
        formData: formulaire,
      })
      notifications.succes(t('documents.ajoutReussie'))
      setDescription('')
      if (refFichier.current) refFichier.current.value = ''
      // Un nouvel ajout revient a la premiere page (la plus recente).
      setPage(1)
      recharger()
    } catch (cause) {
      notifications.erreur(messageErreur(cause))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}>
      <form onSubmit={televerser} className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('documents.nouveau')}</h2>
        </div>
        <div className="carte-corps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
          <div className="champ">
            <label className="champ-etiquette champ-obligatoire" htmlFor="fichier-document">
              {t('documents.nomFichier')}
            </label>
            <input
              id="fichier-document"
              ref={refFichier}
              type="file"
              className="champ-controle"
              accept="image/*,application/pdf"
              required
            />
            <span className="champ-aide">
              Images (JPEG, PNG, WebP, GIF, TIFF, BMP) et PDF. Taille maximale : 20 Mo.
            </span>
          </div>

          <div className="champ-grille">
            <ChampSelection
              nom="categorie-document"
              etiquette={t('documents.categorie')}
              value={categorie}
              onChange={(evenement) => setCategorie(evenement.target.value)}
              options={Object.entries(contenu.documents.categories).map(([valeur, libelle]) => ({
                valeur,
                libelle,
              }))}
            />
            <ChampTexte
              nom="description-document"
              etiquette={t('documents.description')}
              value={description}
              onChange={(evenement) => setDescription(evenement.target.value)}
            />
          </div>

          <div className="encadre-information">{t('documents.stockagePrive')}</div>
        </div>
        <div className="modale-pied" style={{ borderRadius: '0 0 var(--rayon-grand) var(--rayon-grand)' }}>
          <Bouton type="submit" variante="principal" disabled={enCours}>
            {enCours ? t('commun.chargement') : t('documents.ajouter')}
          </Bouton>
        </div>
      </form>

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

      {donnees && donnees.documents.length === 0 ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('documents.aucun')}</p>
        </div>
      ) : null}

      {donnees && donnees.documents.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('documents.nomFichier')}</th>
                  <th scope="col">{t('documents.categorie')}</th>
                  <th scope="col">{t('documents.taille')}</th>
                  <th scope="col">{t('commun.date')}</th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.documents.map((document) => (
                  <tr key={document.id}>
                    <td data-etiquette={t('documents.nomFichier')}>{document.nomOriginal}</td>
                    <td data-etiquette={t('documents.categorie')}>
                      {document.categorie
                        ? (contenu.documents.categories[
                          document.categorie as keyof typeof contenu.documents.categories
                        ] ?? document.categorie)
                        : '—'}
                    </td>
                    <td data-etiquette={t('documents.taille')}>
                      {(document.tailleOctets / 1024).toFixed(0)} Ko
                    </td>
                    <td data-etiquette={t('commun.date')}>
                      {new Date(document.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                    <td data-etiquette={t('commun.actions')}>
                      {/* Lien de telechargement authentifie : le fichier n'est
                          jamais accessible directement. */}
                      <a
                        href={`/api/documents/${document.id}/download`}
                        className="bouton-lien"
                        download
                      >
                        {t('documents.telecharger')}
                      </a>
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
