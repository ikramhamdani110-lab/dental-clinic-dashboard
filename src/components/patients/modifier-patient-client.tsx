'use client'

import Link from 'next/link'

import { t } from '@content/index'

import { FormulairePatient, type ValeursPatient } from '@/components/patients/formulaire-patient'
import { ageDuPatient, formaterAgePatient } from '@/lib/age'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * Chargement du patient puis formulaire pre-rempli (composant client).
 *
 * La page serveur fournit le cadre ; ce composant va chercher la fiche et la
 * place dans le formulaire. Les valeurs du formulaire sont en chaines de
 * caracteres (etat d'edition) ; la conversion vers le format serveur est faite
 * a l'envoi.
 *
 * La DATE DE NAISSANCE n'est plus un champ de saisie et n'est jamais affichee.
 * Elle n'est ni modifiable, ni envoyee lors de l'enregistrement, donc conservee
 * telle quelle en base ; elle sert uniquement de REPLI pour l'age lorsqu'aucun
 * age n'a ete saisi (voir `lib/age`).
 */
export function ModifierPatientClient({ patientId }: { patientId: string }): React.JSX.Element {
  const { donnees, chargement, erreur } = useRequete<{
    patient: {
      nom: string
      prenom: string
      age: number | null
      dateNaissance: string | null
      sexe: string
      telephone: string
      adresse: string | null
      notesGenerales: string | null
    }
  }>(`/api/patients/${patientId}`)

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
        <Link href="/patients" className="bouton-lien">
          {t('commun.retour')}
        </Link>
      </div>
    )
  }

  const valeursInitiales: ValeursPatient = {
    nom: donnees.patient.nom,
    prenom: donnees.patient.prenom,
    // L'age deja enregistre est propose a la modification. A defaut, il est
    // deduit de la date de naissance lorsqu'elle existe : le medecin voit donc
    // toujours un age exploitable, sans qu'aucune donnee ne soit inventee.
    age: formaterAgePatient(donnees.patient) === '—' ? '' : String(ageDuPatient(donnees.patient)),
    sexe: donnees.patient.sexe,
    telephone: donnees.patient.telephone,
    adresse: donnees.patient.adresse ?? '',
    // `email` reste dans le type (conserve en base) mais n'est plus saisi ni
    // affiche : il n'est donc pas transmis a l'enregistrement.
    email: '',
    notesGenerales: donnees.patient.notesGenerales ?? '',
  }

  return <FormulairePatient valeursInitiales={valeursInitiales} patientId={patientId} />
}
