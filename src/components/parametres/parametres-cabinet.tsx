'use client'

import { useEffect, useState } from 'react'

import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampTexte, ChampZone } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { ApiError, messageErreur, requeteApi } from '@/lib/api-client'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  PARAMETRES (§28)
 * =============================================================================
 *
 *  Informations d'affichage du cabinet et du medecin. AUCUN secret technique
 *  n'est presente ici : ni mot de passe, ni cle d'API, ni chaine de connexion.
 *  Ces elements vivent uniquement dans l'environnement du serveur (§28, §38).
 *
 *  L'etat des sauvegardes est indique : la specification demande de ne PAS
 *  pretendre qu'une sauvegarde existe si elle n'est pas reellement configuree.
 */

interface Parametres {
  nomClinique?: string
  adresseClinique?: string
  telephoneClinique?: string
  emailClinique?: string
  siteWeb?: string
  nomMedecin?: string
  specialite?: string
  numeroOrdre?: string
  horaires?: string
}

export function ParametresCabinet(): React.JSX.Element {
  const notifications = useNotifications()
  const { donnees, chargement } = useRequete<{ parametres: Parametres }>('/api/settings')

  const [valeurs, setValeurs] = useState<Parametres>({})
  const [enCours, setEnCours] = useState(false)

  // Charge les valeurs existantes une fois la lecture terminee.
  useEffect(() => {
    if (donnees?.parametres) setValeurs(donnees.parametres)
  }, [donnees])

  function modifier(champ: keyof Parametres, valeur: string): void {
    setValeurs((precedentes) => ({ ...precedentes, [champ]: valeur }))
  }

  async function enregistrer(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setEnCours(true)
    try {
      await requeteApi('/api/settings', { methode: 'PUT', corps: valeurs })
      notifications.succes(t('parametres.enregistrerReussie'))
    } catch (cause) {
      notifications.erreur(cause instanceof ApiError ? cause.message : messageErreur(cause))
    } finally {
      setEnCours(false)
    }
  }

  if (chargement) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={enregistrer}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}
    >
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('parametres.informationsClinique')}</h2>
        </div>
        <div className="carte-corps">
          <div className="champ-grille">
            <ChampTexte
              nom="nomClinique"
              etiquette={t('parametres.nomClinique')}
              value={valeurs.nomClinique ?? ''}
              onChange={(evenement) => modifier('nomClinique', evenement.target.value)}
            />
            <ChampTexte
              nom="telephoneClinique"
              etiquette={t('parametres.telephone')}
              value={valeurs.telephoneClinique ?? ''}
              onChange={(evenement) => modifier('telephoneClinique', evenement.target.value)}
            />
            <ChampTexte
              nom="emailClinique"
              etiquette={t('parametres.email')}
              value={valeurs.emailClinique ?? ''}
              onChange={(evenement) => modifier('emailClinique', evenement.target.value)}
            />
            <ChampTexte
              nom="siteWeb"
              etiquette={t('parametres.siteWeb')}
              value={valeurs.siteWeb ?? ''}
              onChange={(evenement) => modifier('siteWeb', evenement.target.value)}
            />
            <ChampZone
              nom="adresseClinique"
              etiquette={t('parametres.adresse')}
              value={valeurs.adresseClinique ?? ''}
              onChange={(evenement) => modifier('adresseClinique', evenement.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('parametres.informationsMedecin')}</h2>
        </div>
        <div className="carte-corps">
          <div className="champ-grille">
            <ChampTexte
              nom="nomMedecin"
              etiquette={t('parametres.nomMedecin')}
              value={valeurs.nomMedecin ?? ''}
              onChange={(evenement) => modifier('nomMedecin', evenement.target.value)}
            />
            <ChampTexte
              nom="specialite"
              etiquette={t('parametres.specialite')}
              value={valeurs.specialite ?? ''}
              onChange={(evenement) => modifier('specialite', evenement.target.value)}
            />
            <ChampTexte
              nom="numeroOrdre"
              etiquette={t('parametres.numeroOrdre')}
              value={valeurs.numeroOrdre ?? ''}
              onChange={(evenement) => modifier('numeroOrdre', evenement.target.value)}
            />
            <ChampZone
              nom="horaires"
              etiquette={t('parametres.horaires')}
              value={valeurs.horaires ?? ''}
              onChange={(evenement) => modifier('horaires', evenement.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Securite : informations, PAS de secret affiche */}
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('parametres.securite')}</h2>
        </div>
        <div className="carte-corps">
          <p className="champ-aide">{t('parametres.securiteAide')}</p>
        </div>
      </section>

      {/* Etat des sauvegardes : message honnete, jamais une fausse assurance */}
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('parametres.sauvegardes')}</h2>
        </div>
        <div className="carte-corps">
          <div className="encadre-avertissement">{t('parametres.sauvegardeNonConfiguree')}</div>
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Bouton type="submit" variante="principal" disabled={enCours}>
          {enCours ? t('commun.chargement') : t('commun.enregistrer')}
        </Bouton>
      </div>
    </form>
  )
}
