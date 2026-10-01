'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampSelection, ChampTexte, ChampZone, GrilleChamps } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, requeteApi } from '@/lib/api-client'

/**
 * Formulaire de patient (§9).
 *
 * Utilise pour la CREATION et la MODIFICATION. Le formulaire envoie les champs
 * au serveur qui les revalide integralement : la validation navigateur n'est
 * qu'un confort (§33).
 *
 * Les erreurs de champ renvoyees par le serveur (422) sont affichees sous le
 * champ concerne, en francais.
 *
 * PERIMETRE DES CHAMPS
 *
 *  Nom, prenom, AGE, sexe, telephone, adresse (facultative) et notes generales.
 *
 *  La DATE DE NAISSANCE n'est pas demandee et n'apparait NULLE PART a l'ecran.
 *  Elle n'est pas supprimee pour autant : elle reste en base pour les patients
 *  deja enregistres, et sert de repli a l'affichage lorsque l'age n'a pas ete
 *  saisi (voir `lib/age`).
 */

export interface ValeursPatient {
  nom: string
  prenom: string
  /** Age en annees revolues, saisi au clavier. Chaine vide = non renseigne. */
  age: string
  sexe: string
  telephone: string
  adresse: string
  email: string
  notesGenerales: string
}

export const VALEURS_PATIENT_VIDES: ValeursPatient = {
  nom: '',
  prenom: '',
  age: '',
  sexe: 'NON_PRECISE',
  telephone: '',
  adresse: '',
  email: '',
  notesGenerales: '',
}

export function FormulairePatient({
  valeursInitiales,
  patientId,
}: {
  valeursInitiales?: ValeursPatient
  /** Renseigne en modification. Absent en creation. */
  patientId?: string
}): React.JSX.Element {
  const router = useRouter()
  const notifications = useNotifications()

  const [valeurs, setValeurs] = useState<ValeursPatient>(valeursInitiales ?? VALEURS_PATIENT_VIDES)
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({})
  const [enCours, setEnCours] = useState(false)

  function modifier(champ: keyof ValeursPatient, valeur: string): void {
    setValeurs((precedentes) => ({ ...precedentes, [champ]: valeur }))
    // Efface l'erreur du champ des qu'il est retouche.
    setErreursChamps((precedentes) => {
      if (!precedentes[champ]) return precedentes
      const suivantes = { ...precedentes }
      delete suivantes[champ]
      return suivantes
    })
  }

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setEnCours(true)
    setErreursChamps({})

    // Les chaines vides sont converties en `null` cote serveur (champs optionnels).
    //
    //  `dateNaissance` n'est VOLONTAIREMENT pas transmise : le champ n'existe
    //  pas dans l'interface. Le serveur conserve donc la date deja enregistree
    //  (la mise a jour ne touche que les champs fournis).
    //
    //  `age` est transmis TEL QU'IL A ETE SAISI : c'est le serveur qui valide
    //  (entier entre 0 et 130, ou vide). Le champ vide devient `null`, ce qui
    //  signifie « age non renseigne » et non « age egal a zero ».
    const corps = {
      nom: valeurs.nom,
      prenom: valeurs.prenom,
      age: valeurs.age.trim() === '' ? null : valeurs.age.trim(),
      sexe: valeurs.sexe,
      telephone: valeurs.telephone,
      adresse: valeurs.adresse,
      notesGenerales: valeurs.notesGenerales,
    }

    try {
      if (patientId) {
        await requeteApi(`/api/patients/${patientId}`, { methode: 'PUT', corps })
        notifications.succes(t('patients.modifierReussie'))
        router.push(`/patients/${patientId}`)
      } else {
        const reponse = await requeteApi<{ patient: { id: string } }>('/api/patients', {
          methode: 'POST',
          corps,
        })
        notifications.succes(t('patients.creerReussie'))
        router.push(`/patients/${reponse.patient.id}`)
      }
      router.refresh()
    } catch (cause) {
      if (cause instanceof ApiError && cause.champs) {
        const map: Record<string, string> = {}
        for (const champ of cause.champs) map[champ.champ] = champ.message
        setErreursChamps(map)
        notifications.erreur(cause.message)
      } else if (cause instanceof ApiError) {
        notifications.erreur(cause.message)
      } else {
        notifications.erreur(t('erreurs.serviceIndisponible'))
      }
      setEnCours(false)
    }
  }

  return (
    <form
      onSubmit={soumettre}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}
    >
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('fichePatient.informationsPersonnelles')}</h2>
        </div>
        <div className="carte-corps">
          <GrilleChamps>
            <ChampTexte
              nom="nom"
              etiquette={t('patients.nom')}
              obligatoire
              value={valeurs.nom}
              onChange={(evenement) => modifier('nom', evenement.target.value)}
              {...(erreursChamps.nom ? { erreur: erreursChamps.nom } : {})}
            />
            <ChampTexte
              nom="prenom"
              etiquette={t('patients.prenom')}
              obligatoire
              value={valeurs.prenom}
              onChange={(evenement) => modifier('prenom', evenement.target.value)}
              {...(erreursChamps.prenom ? { erreur: erreursChamps.prenom } : {})}
            />
            {/*
              AGE — champ SAISISSABLE.

              Le medecin tape l'age en annees revolues (« 24 »). Aucune date de
              naissance n'est demandee.

              CE QUI ETAIT CASSE, ET POURQUOI
                Le champ etait `readOnly` ET `disabled`, et sa valeur etait
                CALCULEE depuis la date de naissance. Or la date de naissance
                n'etait plus saisissable : pour un nouveau patient, la valeur
                valait donc toujours le tiret, et le champ etant desactive, il
                etait IMPOSSIBLE de saisir un age. La creation d'un patient
                aboutissait a une fiche sans age.

              `inputMode="numeric"` ouvre le pave numerique sur mobile sans
              interdire la frappe au clavier. Le type reste `text` : `type=number`
              afficherait des flechettes et refuserait la saisie de certains
              caracteres sans message clair (le serveur, lui, valide).

              AUCUN EXEMPLE CHIFFRE DANS LE PLACEHOLDER : « 24 » se lisait comme
              une valeur deja saisie, et le medecin le prenait pour l'age du
              patient. Le champ demarre donc VIDE, sans même une suggestion
              numérique : l'age est une information a RDC, pas un exemple.
            */}
            <ChampTexte
              nom="age"
              etiquette={t('patients.age')}
              inputMode="numeric"
              autoComplete="off"
              value={valeurs.age}
              onChange={(evenement) => modifier('age', evenement.target.value)}
              {...(erreursChamps.age ? { erreur: erreursChamps.age } : {})}
            />
            <ChampSelection
              nom="sexe"
              etiquette={t('patients.sexe')}
              value={valeurs.sexe}
              onChange={(evenement) => modifier('sexe', evenement.target.value)}
              options={[
                { valeur: 'NON_PRECISE', libelle: t('patients.sexes.NON_PRECISE') },
                { valeur: 'MASCULIN', libelle: t('patients.sexes.MASCULIN') },
                { valeur: 'FEMININ', libelle: t('patients.sexes.FEMININ') },
              ]}
            />
            <ChampTexte
              nom="telephone"
              type="tel"
              etiquette={t('patients.telephone')}
              obligatoire
              value={valeurs.telephone}
              onChange={(evenement) => modifier('telephone', evenement.target.value)}
              {...(erreursChamps.telephone ? { erreur: erreursChamps.telephone } : {})}
            />
            <ChampTexte
              nom="adresse"
              etiquette={t('patients.adresse')}
              value={valeurs.adresse}
              onChange={(evenement) => modifier('adresse', evenement.target.value)}
            />
            <ChampZone
              nom="notesGenerales"
              etiquette={t('patients.notesGenerales')}
              value={valeurs.notesGenerales}
              onChange={(evenement) => modifier('notesGenerales', evenement.target.value)}
            />
          </GrilleChamps>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 'var(--espace-3)', justifyContent: 'flex-end' }}>
        <Bouton
          type="button"
          variante="secondaire"
          onClick={() => router.back()}
          disabled={enCours}
        >
          {t('commun.annuler')}
        </Bouton>
        <Bouton type="submit" variante="principal" disabled={enCours}>
          {enCours
            ? t('commun.chargement')
            : patientId
              ? t('commun.enregistrer')
              : t('patients.creer')}
        </Bouton>
      </div>
    </form>
  )
}
