'use client'

import { useEffect } from 'react'

import { t } from '@content/index'

import type { OrdonnanceComplete } from '@backend/services/prescriptions.service'

import { FeuilleOrdonnance, type OrdonnanceFeuille } from '@/components/medical/feuille-ordonnance'

interface PatientImpression {
  nom: string
  prenom: string
  age: number | null
  sexe: string
}

/**
 * =============================================================================
 *  PAGE D'IMPRESSION (§21) — lance la boite de dialogue du navigateur.
 * =============================================================================
 *
 *  La feuille est deja rendue cote serveur par la page parente ; ce composant
 *  client se contente d'ouvrir la boite d'impression une fois la page prete,
 *  puis de proposer le retour a la fiche. Aucune logique metier : tout vient
 *  de la base via la page serveur.
 */
export function ImpressionOrdonnance({
  ordonnance,
  patient,
}: {
  ordonnance: OrdonnanceComplete
  patient: PatientImpression
}): React.JSX.Element {
  useEffect(() => {
    window.setTimeout(() => window.print(), 400)
  }, [])

  const feuille: OrdonnanceFeuille = {
    date: ordonnance.date,
    nomPatient: `${patient.nom} ${patient.prenom}`.trim(),
    agePatient: patient.age !== null ? `${patient.age} ans` : null,
    lignes: ordonnance.lignes.map((l) => ({
      medicament: l.medicament,
      dosage: l.dosage,
      frequence: l.frequence,
      duree: l.duree,
      instructions: l.instructions,
    })),
    notes: ordonnance.notes,
    entete: ordonnance.entete,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="impression-actions">
        <a href={`/patients/${ordonnance.patientId}`} className="bouton-lien">
          {t('commun.retour')}
        </a>
      </div>
      <FeuilleOrdonnance ordonnance={feuille} />
    </div>
  )
}
