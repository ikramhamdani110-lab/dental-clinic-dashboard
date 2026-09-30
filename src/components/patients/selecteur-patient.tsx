'use client'

import { useState } from 'react'

import Link from 'next/link'

import { t } from '@content/index'

import { ChampTexte } from '@/components/ui/champ'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  SELECTEUR DE PATIENT POUR LES MODULES CLINIQUES
 * =============================================================================
 *
 *  Les dossiers medicaux, ordonnances, odontogrammes et documents sont
 *  rattaches a UN PATIENT (§19, §21, §20, §22). Ces modules s'ouvrent donc par
 *  le choix d'un patient.
 *
 *  Le medecin arrive generalement depuis la fiche patient (lien direct). Quand
 *  il ouvre le module seul, ce selecteur lui permet de retrouver la fiche par
 *  NOM, PRENOM ou TELEPHONE — jamais par un identifiant patient (§48).
 */

interface PatientRecherche {
  id: string
  nom: string
  prenom: string
  telephone: string
}

export function SelecteurPatient({
  lienBase,
  titre,
}: {
  /** Segment d'URL de destination, ex. `dossiers-medicaux`. */
  lienBase: string
  titre: string
}): React.JSX.Element {
  const [recherche, setRecherche] = useState('')
  const rechercheDifferee = useDebounce(recherche, 300)

  const { donnees, chargement } = useRequete<{ elements: PatientRecherche[] }>(
    rechercheDifferee
      ? `/api/patients?recherche=${encodeURIComponent(rechercheDifferee)}&taille=10`
      : null,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="carte">
        <div className="carte-corps">
          <ChampTexte
            nom="recherche-selecteur-patient"
            etiquette={t('patients.rechercher')}
            placeholder={t('patients.placeholderRecherche')}
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
          />
        </div>
      </div>

      {chargement ? (
        <div className="etat-vide">
          <span className="rotation" aria-hidden="true" />
          <p className="etat-vide-texte">{t('recherche.rechercheEnCours')}</p>
        </div>
      ) : null}

      {donnees && donnees.elements.length > 0 ? (
        <div className="carte">
          <div className="liste-compacte">
            {donnees.elements.map((patient) => (
              <div key={patient.id} className="liste-compacte-element">
                <span className="liste-compacte-principal">
                  <span className="liste-compacte-titre">
                    {patient.prenom} {patient.nom}
                  </span>
                  <span className="liste-compacte-detail">{patient.telephone}</span>
                </span>
                <Link href={`/${lienBase}?patientId=${patient.id}`} className="bouton-lien">
                  {t('commun.voirTout')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {donnees && donnees.elements.length === 0 && rechercheDifferee ? (
        <div className="etat-vide">
          <p className="etat-vide-texte">{t('recherche.aucunResultat')}</p>
        </div>
      ) : null}

      {!rechercheDifferee ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{titre}</p>
          <p className="etat-vide-texte">{t('patients.placeholderRecherche')}</p>
        </div>
      ) : null}
    </div>
  )
}
