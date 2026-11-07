'use client'

import { useState } from 'react'

import { formaterMontant } from '@backend/domain/finance'

import type {
  LigneDepense,
  LigneDette,
  LignePaiement,
  ReponseDepenses,
  ReponseDettes,
  ReponsePaiements,
} from '@/components/finances/contrats-finances'
import { formaterDate } from '@/components/finances/contrats-finances'
import { useRequeteFinanciere } from '@/lib/hooks/use-requete-financiere'

/**
 * =============================================================================
 *  LISTE D'UNE CATÉGORIE FINANCIÈRE — REVENUS, DETTE OU DÉPENSES
 * =============================================================================
 *
 *  Une seule catégorie est affichée à la fois : celle de la boîte cliquée.
 *  Aucun onglet, aucune navigation : le retour aux trois boîtes se fait par le
 *  bouton de l'en-tête de la liste.
 *
 *    Revenus  : patient, date, prestation, montant, statut du paiement.
 *    Dette    : patient, traitement / rendez-vous, facturé, payé, reste dû.
 *    Dépenses : titre, date, montant, actions modifier / supprimer.
 *
 *  PAGINATION EN BASE : chaque page est DEMANDÉE à l'API (`page`, `taille`).
 *  Aucune liste complète n'est rapatriée puis découpée dans le navigateur :
 *  l'historique d'un cabinet se compte en milliers de lignes.
 *
 *  AUCUNE COLONNE « MOYEN DE PAIEMENT » — ni ici, ni ailleurs.
 */

export type OngletHistorique = 'revenus' | 'depenses' | 'dettes'

/** Intention demandée au formulaire de dépense (deux actions distinctes). */
export type IntentionDepense = 'modifier' | 'supprimer'

const TAILLE_PAGE = 10

export function HistoriqueFinancier({
  onglet,
  periode,
  version,
  onOuvrirDepense,
}: {
  onglet: OngletHistorique
  /** Paramètres de période déjà encodés (`periode=…&annee=…`). */
  periode: string
  /** Incrémenté après chaque écriture : force le rechargement. */
  version: number
  onOuvrirDepense: (depense: LigneDepense, intention: IntentionDepense) => void
}): React.JSX.Element {
  const [pageRevenus, setPageRevenus] = useState(1)
  const [pageDettes, setPageDettes] = useState(1)
  const [pageDepenses, setPageDepenses] = useState(1)

  return (
    <div className="finances-liste">
      {onglet === 'revenus' ? (
        <TableRevenus
          key={`rev-${version}-${periode}`}
          periode={periode}
          page={pageRevenus}
          onPage={setPageRevenus}
        />
      ) : null}
      {onglet === 'depenses' ? (
        <TableDepenses
          key={`dep-${version}-${periode}`}
          periode={periode}
          page={pageDepenses}
          onPage={setPageDepenses}
          onOuvrir={onOuvrirDepense}
        />
      ) : null}
      {onglet === 'dettes' ? (
        <TableDettes key={`det-${version}`} page={pageDettes} onPage={setPageDettes} />
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
//  REVENUS
// -----------------------------------------------------------------------------

function TableRevenus({
  periode,
  page,
  onPage,
}: {
  periode: string
  page: number
  onPage: (page: number) => void
}): React.JSX.Element {
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<ReponsePaiements>(
    `/api/finances/details?boite=paiements&page=${page}&taille=${TAILLE_PAGE}&${periode}`,
  )

  if (erreur) return <EtatErreur message={erreur} onReessayer={recharger} />
  if (chargement && !donnees) return <Squelette lignes={5} />
  if (donnees && donnees.elements.length === 0) {
    return (
      <EtatVide
        titre="Aucun revenu sur cette période"
        texte="Les encaissements enregistrés au secrétariat apparaîtront ici dès le premier paiement validé."
      />
    )
  }
  if (!donnees) return <Squelette lignes={5} />

  return (
    <>
      <div className="finances-table-enveloppe">
        <table className="finances-tableau">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Date</th>
              <th scope="col">Prestation</th>
              <th scope="col" className="finances-col-montant">
                Montant
              </th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            {donnees.elements.map((ligne: LignePaiement) => (
              <tr key={ligne.id}>
                <td className="finances-cellule-nom">{ligne.patient}</td>
                <td className="finances-cellule-date">{formaterDate(ligne.date)}</td>
                <td className="finances-cellule-texte">{ligne.description ?? '—'}</td>
                <td className="finances-col-montant finances-montant-cellule finances-montant--revenu">
                  + {formaterMontant(ligne.montantCentimes)}
                </td>
                <td>
                  <span className="finances-badge finances-badge--valide">Encaissé</span>
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
        taille={donnees.taille}
        libelle="paiement"
        onPage={onPage}
        enChargement={chargement}
      />
    </>
  )
}

// -----------------------------------------------------------------------------
//  DÉPENSES
// -----------------------------------------------------------------------------

function TableDepenses({
  periode,
  page,
  onPage,
  onOuvrir,
}: {
  periode: string
  page: number
  onPage: (page: number) => void
  onOuvrir: (depense: LigneDepense, intention: IntentionDepense) => void
}): React.JSX.Element {
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<ReponseDepenses>(
    `/api/finances/expenses?page=${page}&taille=${TAILLE_PAGE}&${parametresFiltre(periode)}`,
  )

  if (erreur) return <EtatErreur message={erreur} onReessayer={recharger} />
  if (chargement && !donnees) return <Squelette lignes={5} />
  if (donnees && donnees.elements.length === 0) {
    return (
      <EtatVide
        titre="Aucune dépense sur cette période"
        texte="Ajoutez une dépense (loyer, électricité, matériel…) avec le bouton « Nouvelle dépense »."
      />
    )
  }
  if (!donnees) return <Squelette lignes={5} />

  return (
    <>
      <div className="finances-table-enveloppe">
        <table className="finances-tableau">
          <thead>
            <tr>
              <th scope="col">Titre</th>
              <th scope="col">Date</th>
              <th scope="col" className="finances-col-montant">
                Montant
              </th>
              <th scope="col" className="finances-col-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {donnees.elements.map((ligne) => (
              <tr key={ligne.id}>
                <td className="finances-cellule-nom">{ligne.titre}</td>
                <td className="finances-cellule-date">{formaterDate(ligne.date)}</td>
                <td className="finances-col-montant finances-montant-cellule finances-montant--depense">
                  − {formaterMontant(ligne.montantCentimes)}
                </td>
                <td className="finances-col-actions">
                  <div className="finances-actions-ligne">
                    <button type="button" className="finances-lien-action" onClick={() => onOuvrir(ligne, 'modifier')}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      className="finances-lien-action finances-lien-action--danger"
                      onClick={() => onOuvrir(ligne, 'supprimer')}
                    >
                      Supprimer
                    </button>
                  </div>
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
        taille={donnees.taille}
        libelle="dépense"
        onPage={onPage}
        enChargement={chargement}
      />
    </>
  )
}

// -----------------------------------------------------------------------------
//  DETTES
// -----------------------------------------------------------------------------

function TableDettes({
  page,
  onPage,
}: {
  page: number
  onPage: (page: number) => void
}): React.JSX.Element {
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<ReponseDettes>(
    `/api/finances/details?boite=dettes&page=${page}&taille=${TAILLE_PAGE}`,
  )

  if (erreur) return <EtatErreur message={erreur} onReessayer={recharger} />
  if (chargement && !donnees) return <Squelette lignes={5} />
  if (donnees && donnees.elements.length === 0) {
    return (
      <EtatVide
        titre="Aucune dette en cours"
        texte="Tous les patients ont soldé leurs traitements. Les soldes restants apparaîtront ici dès qu’un traitement sera facturé sans être entièrement réglé."
      />
    )
  }
  if (!donnees) return <Squelette lignes={5} />

  return (
    <>
      <p className="finances-note-perimetre">
        Le solde d’un patient est GLOBAL (facturé − encaissé) : il ne dépend pas de la période
        affichée, contrairement aux revenus et aux dépenses.
      </p>
      <div className="finances-table-enveloppe">
        <table className="finances-tableau">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Traitement / rendez-vous</th>
              <th scope="col" className="finances-col-montant">
                Facturé
              </th>
              <th scope="col" className="finances-col-montant">
                Payé
              </th>
              <th scope="col" className="finances-col-montant">
                Reste dû
              </th>
              <th scope="col">Paiement</th>
            </tr>
          </thead>
          <tbody>
            {donnees.elements.map((ligne: LigneDette) => (
              <tr key={ligne.patientId}>
                <td className="finances-cellule-nom">{ligne.patient}</td>
                <td className="finances-cellule-texte">
                  {ligne.traitement ?? '—'}
                  {ligne.rendezVous ? (
                    <span className="finances-cellule-sous">{formaterDate(ligne.rendezVous)}</span>
                  ) : null}
                </td>
                <td className="finances-col-montant finances-montant-cellule">
                  {formaterMontant(ligne.totalDuCentimes)}
                </td>
                <td className="finances-col-montant finances-montant-cellule finances-montant--paye">
                  {formaterMontant(ligne.payeCentimes)}
                </td>
                <td className="finances-col-montant finances-montant-cellule finances-montant--dette">
                  {formaterMontant(ligne.resteAPayerCentimes)}
                </td>
                <td>
                  <span
                    className={`finances-badge ${
                      ligne.statutPaiement === 'NON_PAYE' ? 'finances-badge--non-paye' : 'finances-badge--partiel'
                    }`}
                  >
                    {ligne.statutPaiement === 'NON_PAYE' ? 'Non payé' : 'Partiellement payé'}
                  </span>
                  {ligne.dernierPaiement ? (
                    <span className="finances-cellule-sous">
                      Dernier paiement : {formaterDate(ligne.dernierPaiement)}
                    </span>
                  ) : null}
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
        taille={donnees.taille}
        libelle="patient"
        onPage={onPage}
        enChargement={chargement}
      />
    </>
  )
}

// -----------------------------------------------------------------------------
//  PAGINATION — SERVEUR
// -----------------------------------------------------------------------------

function Pagination({
  page,
  pages,
  total,
  taille,
  libelle,
  onPage,
  enChargement,
}: {
  page: number
  pages: number
  total: number
  taille: number
  libelle: string
  onPage: (page: number) => void
  enChargement: boolean
}): React.JSX.Element {
  const premier = total === 0 ? 0 : (page - 1) * taille + 1
  const dernier = Math.min(page * taille, total)
  const debut = Math.max(1, Math.min(page - 2, pages - 4))
  const fin = Math.min(pages, debut + 4)
  const numeros: number[] = []
  for (let n = debut; n <= fin; n++) numeros.push(n)

  return (
    <div className="finances-pagination">
      <p className="finances-pagination-info">
        {premier}–{dernier} sur {total} {libelle}
        {total > 1 ? 's' : ''}
      </p>
      <div className="finances-pagination-controles">
        <button
          type="button"
          className="finances-bouton finances-bouton-page"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1 || enChargement}
        >
          Précédent
        </button>
        {numeros.map((n) => (
          <button
            key={n}
            type="button"
            className="finances-bouton finances-bouton-page"
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
            disabled={enChargement}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="finances-bouton finances-bouton-page"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages || enChargement}
        >
          Suivant
        </button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
//  ÉTATS
// -----------------------------------------------------------------------------

function EtatVide({ titre, texte }: { titre: string; texte: string }): React.JSX.Element {
  return (
    <div className="finances-etat-vide">
      <p className="finances-etat-vide-titre">{titre}</p>
      <p className="finances-etat-vide-texte">{texte}</p>
    </div>
  )
}

function EtatErreur({ message, onReessayer }: { message: string; onReessayer: () => void }): React.JSX.Element {
  return (
    <div className="finances-etat-vide finances-etat-vide--erreur" role="alert">
      <p className="finances-etat-vide-titre">La liste n’a pas pu être chargée</p>
      <p className="finances-etat-vide-texte">{message}</p>
      <button type="button" className="finances-bouton" onClick={onReessayer}>
        Réessayer
      </button>
    </div>
  )
}

function Squelette({ lignes }: { lignes: number }): React.JSX.Element {
  return (
    <div className="finances-squelette" aria-hidden="true">
      {Array.from({ length: lignes }).map((_, index) => (
        <div key={index} className="finances-squelette-ligne">
          <span className="finances-squelette-bloc finances-squelette-bloc--large" />
          <span className="finances-squelette-bloc" />
          <span className="finances-squelette-bloc" />
          <span className="finances-squelette-bloc finances-squelette-bloc--court" />
        </div>
      ))}
    </div>
  )
}

/** L'API des dépenses attend `du`/`au`, pas `periode` : on traduit. */
function parametresFiltre(periode: string): string {
  const p = new URLSearchParams(periode)
  const annee = p.get('annee')
  const maintenant = new Date().getFullYear()
  const choix = p.get('periode')

  if (choix === 'annee') {
    const a = Number.parseInt(annee ?? String(maintenant), 10) || maintenant
    return `du=${a}-01-01&au=${a}-12-31`
  }
  if (choix === 'annee-precedente') {
    const a = maintenant - 1
    return `du=${a}-01-01&au=${a}-12-31`
  }
  if (choix === 'personnalisee') {
    return `du=${p.get('du')}&au=${p.get('au')}`
  }
  if (choix === 'mois') {
    const debut = new Date()
    debut.setDate(1)
    return `du=${iso(debut)}&au=${iso(new Date())}`
  }
  if (choix === 'trimestre') {
    const fin = new Date()
    const debut = new Date(fin.getFullYear(), Math.floor(fin.getMonth() / 3) * 3, 1)
    return `du=${iso(debut)}&au=${iso(fin)}`
  }
  const fin = new Date()
  const debut = new Date(fin)
  debut.setDate(debut.getDate() - (choix === '7-jours' ? 6 : 29))
  return `du=${iso(debut)}&au=${iso(fin)}`
}

function iso(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mois}-${jour}`
}
