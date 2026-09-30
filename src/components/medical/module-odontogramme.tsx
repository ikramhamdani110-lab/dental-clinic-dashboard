'use client'

import { useSearchParams } from 'next/navigation'

import { t, contenu } from '@content/index'

import { SelecteurPatient } from '@/components/patients/selecteur-patient'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  ODONTOGRAMME FDI (§20)
 * =============================================================================
 *
 *  Denture permanente (11..48) et temporaire (51..85). Chaque dent affiche son
 *  etat COURANT ; l'historique complet est conserve (une dent peut avoir
 *  plusieurs traitements dans le temps).
 *
 *  L'etat n'est jamais ecrase : le serveur AJOUTE une entree a chaque
 *  changement. La couleur d'une dent reflete sa derniere entree connue.
 */

interface EtatCourant {
  etat: string
  date: string
  commentaire: string | null
}

interface EntreeOdontogramme {
  id: string
  numeroDent: string
  etat: string
  commentaire: string | null
  date: string
}

interface Odontogramme {
  etatCourant: Record<string, EtatCourant>
  historiqueParDent: Record<string, EntreeOdontogramme[]>
  dentsPermanentes: string[]
  dentsTemporaires: string[]
}

/** Classe CSS de couleur selon l'etat de la dent. */
function classeEtat(etat: string | undefined): string {
  if (!etat) return 'dent'
  const suffixes: Record<string, string> = {
    SAINE: 'dent-saine',
    CARIE: 'dent-carie',
    OBTUREE: 'dent-obturee',
    ABSENTE: 'dent-absente',
    COURONNE: 'dent-couronne',
    DEVITALISEE: 'dent-devitalisee',
    EXTRACTION_PREVUE: 'dent-extraction-prevue',
    IMPLANT: 'dent-implant',
    AUTRE: 'dent-autre',
  }
  return `dent ${suffixes[etat] ?? 'dent-autre'}`
}

export function ModuleOdontogramme(): React.JSX.Element {
  const params = useSearchParams()
  const patientId = params.get('patientId')

  const { donnees, chargement } = useRequete<Odontogramme>(
    patientId ? `/api/patients/${patientId}/odontogram` : null,
  )

  if (!patientId) {
    return <SelecteurPatient lienBase="odontogramme" titre={t('fichePatient.odontogramme')} />
  }

  if (chargement) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (!donnees) {
    return (
      <div className="etat-vide">
        <p className="etat-vide-titre">{t('odontogramme.aideSelection')}</p>
      </div>
    )
  }

  // Repartition en quadrants pour un affichage lisible, comme au cabinet.
  const hautDroit = ['18', '17', '16', '15', '14', '13', '12', '11']
  const hautGauche = ['21', '22', '23', '24', '25', '26', '27', '28']
  const basGauche = ['31', '32', '33', '34', '35', '36', '37', '38']
  const basDroit = ['48', '47', '46', '45', '44', '43', '42', '41']

  return (
    <div className="odontogramme">
      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('odontogramme.denturePermanente')}</h2>
        </div>
        <div
          className="carte-corps"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-3)' }}
        >
          <RangeeDents numeros={hautDroit} etiquette="Haut droit" odontogramme={donnees} />
          <RangeeDents numeros={hautGauche} etiquette="Haut gauche" odontogramme={donnees} />
          <RangeeDents numeros={basGauche} etiquette="Bas gauche" odontogramme={donnees} />
          <RangeeDents numeros={basDroit} etiquette="Bas droit" odontogramme={donnees} />
        </div>
      </section>

      <section className="carte">
        <div className="carte-entete">
          <h2 className="carte-titre">{t('odontogramme.legende')}</h2>
        </div>
        <div className="carte-corps">
          <div className="legende">
            {Object.entries(contenu.odontogramme.etats).map(([cle, libelle]) => (
              <span key={cle} className="legende-element">
                <span
                  className="legende-pastille"
                  style={{ background: `var(--dent-${cle.toLowerCase().replace(/_/g, '-')})` }}
                  aria-hidden="true"
                />
                {libelle}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function RangeeDents({
  numeros,
  etiquette,
  odontogramme,
}: {
  numeros: string[]
  etiquette: string
  odontogramme: Odontogramme
}): React.JSX.Element {
  return (
    <div className="arcade">
      <span className="arcade-titre">{etiquette}</span>
      <div className="arcade-rangee">
        {numeros.map((numero) => {
          const courant = odontogramme.etatCourant[numero]
          const libelleEtat = courant
            ? (contenu.odontogramme.etats[
                courant.etat as keyof typeof contenu.odontogramme.etats
              ] ?? courant.etat)
            : t('odontogramme.aucunEtat')
          return (
            <div
              key={numero}
              className={classeEtat(courant?.etat)}
              title={`${t('odontogramme.dent')} ${numero} — ${libelleEtat}`}
            >
              <span className="dent-numero">{numero}</span>
              <span className="dent-marque" aria-hidden="true" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
