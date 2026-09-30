'use client'

import Link from 'next/link'

import { t } from '@content/index'
import { formaterMontant } from '@backend/domain/finance'

import { BadgeStatutTraitement } from '@/components/ui/badge-statut'
import { LienBouton } from '@/components/ui/bouton'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * Detail d'un traitement (§12, §13).
 *
 * Affiche le prix total, le montant deja paye et le reste a payer (tous
 * CALCULES cote serveur a partir des paiements valides), puis la liste des
 * visites (seances) du traitement.
 */

interface Traitement {
  id: string
  patientId: string
  typeTraitement: string
  dents: string[]
  diagnostic: string | null
  description: string | null
  prixTotalCentimes: number
  montantPayeCentimes: number
  resteAPayerCentimes: number
  statut: string
  dateDebut: string | null
  dateFin: string | null
}

interface Visite {
  id: string
  numeroSeance: number
  dateDebut: string
  dateFin: string | null
  notes: string | null
  proceduresRealisees: string | null
  montantPayeCentimes: number
}

export function DetailTraitement({ traitementId }: { traitementId: string }): React.JSX.Element {
  const { donnees, chargement, erreur } = useRequete<{
    traitement: Traitement
    visites: Visite[]
  }>(`/api/treatments/${traitementId}`)

  if (chargement) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (erreur || !donnees) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{erreur ?? t('erreurs.introuvable')}</p>
        <Link href="/traitements" className="bouton-lien">
          {t('commun.retour')}
        </Link>
      </div>
    )
  }

  const { traitement, visites } = donnees

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/traitements">{t('traitements.titre')}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/patients/${traitement.patientId}`}>{t('patients.fiche')}</Link>
        <span aria-hidden="true">/</span>
        <span>{traitement.typeTraitement}</span>
      </nav>

      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{traitement.typeTraitement}</h2>
          <BadgeStatutTraitement statut={traitement.statut} />
        </div>
        <div
          className="carte-corps"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}
        >
          <div className="grille-solde">
            <div className="solde-element">
              <span className="solde-etiquette">{t('traitements.prixTotal')}</span>
              <span className="solde-valeur">{formaterMontant(traitement.prixTotalCentimes)}</span>
            </div>
            <div className="solde-element">
              <span className="solde-etiquette">{t('traitements.montantPaye')}</span>
              <span className="solde-valeur solde-valeur-solde">
                {formaterMontant(traitement.montantPayeCentimes)}
              </span>
            </div>
            <div className="solde-element">
              <span className="solde-etiquette">{t('traitements.resteAPayer')}</span>
              <span
                className={`solde-valeur ${traitement.resteAPayerCentimes > 0 ? 'solde-valeur-attention' : 'solde-valeur-solde'}`}
              >
                {formaterMontant(traitement.resteAPayerCentimes)}
              </span>
            </div>
          </div>

          <dl className="liste-definitions">
            <div className="liste-definitions-item">
              <dt className="liste-definitions-terme">{t('traitements.dents')}</dt>
              <dd className="liste-definitions-valeur">
                {traitement.dents.length > 0 ? traitement.dents.join(', ') : '—'}
              </dd>
            </div>
            <div className="liste-definitions-item">
              <dt className="liste-definitions-terme">{t('traitements.diagnostic')}</dt>
              <dd className="liste-definitions-valeur">{traitement.diagnostic ?? '—'}</dd>
            </div>
            <div className="liste-definitions-item">
              <dt className="liste-definitions-terme">{t('traitements.description')}</dt>
              <dd className="liste-definitions-valeur">{traitement.description ?? '—'}</dd>
            </div>
          </dl>

          <div className="actions-rapides">
            <LienBouton
              href={`/paiements/nouveau?patientId=${traitement.patientId}&treatmentId=${traitement.id}`}
              variante="principal"
              taille="petite"
            >
              {t('fichePatient.ajouterPaiement')}
            </LienBouton>
            <LienBouton
              href={`/rendez-vous/nouveau?patientId=${traitement.patientId}&treatmentId=${traitement.id}`}
              variante="secondaire"
              taille="petite"
            >
              {t('traitements.nouveauRendezVousDepuisTraitement')}
            </LienBouton>
            <LienBouton
              href={`/patients/${traitement.patientId}`}
              variante="discret"
              taille="petite"
            >
              {t('patients.fiche')}
            </LienBouton>
          </div>
        </div>
      </section>

      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('traitements.visites')}</h2>
        </div>
        {visites.length === 0 ? (
          <div className="etat-vide">
            <p className="etat-vide-texte">{t('traitements.aucuneVisite')}</p>
          </div>
        ) : (
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('traitements.numeroSeance')}</th>
                  <th scope="col">{t('commun.date')}</th>
                  <th scope="col">{t('traitements.proceduresRealisees')}</th>
                  <th scope="col" className="tableau-numerique">
                    {t('traitements.montantPaye')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visites.map((visite) => (
                  <tr key={visite.id}>
                    <td data-etiquette={t('traitements.numeroSeance')}>{visite.numeroSeance}</td>
                    <td data-etiquette={t('commun.date')}>
                      {new Date(visite.dateDebut).toLocaleDateString('fr-FR')}
                    </td>
                    <td data-etiquette={t('traitements.proceduresRealisees')}>
                      {visite.proceduresRealisees ?? '—'}
                    </td>
                    <td data-etiquette={t('traitements.montantPaye')} className="tableau-numerique">
                      {formaterMontant(visite.montantPayeCentimes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
