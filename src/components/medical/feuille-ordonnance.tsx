'use client'

import type { EnteteOrdonnance } from '@backend/validation/schemas'

import { localeDates } from '@/lib/locale-dates'

/**
 * =============================================================================
 *  FEUILLE D'ORDONNANCE A5 (aperçu écran + impression)
 * =============================================================================
 *
 *  Une SEULE feuille pour tous les usages :
 *    - aperçu dans le générateur (classe `feuille-ordonnance-apercu`),
 *    - réimpression depuis le dossier du patient,
 *    - impression navigateur (media print + `@page size: A5`).
 *
 *  L'AFEUTAGE est volontairement FIGÉ en clair : une ordonnance est un
 *  document médical imprimé, elle ne suit pas le thème de l'interface
 *  (une feuille sombre ne se imprimable pas). Les couleurs de la feuille
 *  sont donc des valeurs fixes, pas des variables de thème.
 *
 *  Ligne de médicament du modèle de données :
 *    medicament  -> nom imprimé en gras
 *    dosage      -> posologie
 *    frequence   -> fréquence de prise
 *    duree       -> durée du traitement
 *    instructions-> consignes complémentaires (facultatif)
 */

export interface LigneFeuilleOrdonnance {
  medicament: string
  dosage: string
  frequence: string
  duree: string
  instructions: string | null
}

export interface OrdonnanceFeuille {
  date: string | Date
  nomPatient: string
  agePatient: string | null
  lignes: LigneFeuilleOrdonnance[]
  notes?: string | null
  entete?: EnteteOrdonnance | null
}

/** Valeurs par défaut de l'en-tête clinique (celles du cabinet). */
export const ENTETE_DEFAUT: EnteteOrdonnance = {
  titreArabe: 'عيادة طب وجراحة الأسنان',
  nomClinique: 'Sahed Dental Clinic',
  nomPraticien: 'Dr. Sahed',
  adresse: 'Ouled Fares, près de l’université',
  telephone: '06.58.03.95.21 / 07.99.49.49.65',
  horaires: 'Ouvert 7J/7 de 8h00 à 22h00',
  conseil: 'نظف أسنانك بعد كل وجبة غذائية',
  ville: 'Ouled Fares',
}

function dateCourte(valeur: string | Date): string {
  const d = typeof valeur === 'string' ? new Date(valeur) : valeur
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(localeDates())
}

/**
 * Vue feuille. Aucune logique ici : le composant est PUR, ce qui permet au
 * même rendu d'être utilisé pour l'aperçu live, la visionneuse du dossier et
 * l'impression — une seule source de vérité visuelle.
 */
export function FeuilleOrdonnance({ ordonnance }: { ordonnance: OrdonnanceFeuille }): React.JSX.Element {
  const entete = ordonnance.entete ?? ENTETE_DEFAUT

  return (
    <article className="feuille-ordonnance" aria-label="Ordonnance">
      {/* Filigrane dent (décoratif, très discret, ne gêne pas la lecture). */}
      <svg className="feuille-ordonnance-filigrane" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3c-3 0-4 1-6 1S3 5 3 8c0 2 1 3 1.5 5S5 21 7 21s2-4 2.5-6S11 13 12 13s2 0 2.5 2S15 21 17 21s2-6 2.5-8S21 10 21 8c0-3-1-4-3-4s-3-1-6-1z" />
      </svg>

      {/* En-tête clinique + bloc patient */}
      <header className="feuille-ordonnance-entete">
        <div className="feuille-ordonnance-clinique">
          <svg className="feuille-ordonnance-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3c-3 0-4 1-6 1S3 5 3 8c0 2 1 3 1.5 5S5 21 7 21s2-4 2.5-6S11 13 12 13s2 0 2.5 2S15 21 17 21s2-6 2.5-8S21 10 21 8c0-3-1-4-3-4s-3-1-6-1z" />
          </svg>
          <div>
            <p lang="ar" dir="rtl" className="feuille-ordonnance-titre-arabe">
              {entete.titreArabe}
            </p>
            <p className="feuille-ordonnance-nom-clinique">{entete.nomClinique}</p>
            <p className="feuille-ordonnance-praticien">{entete.nomPraticien}</p>
            <p lang="ar" dir="rtl" className="feuille-ordonnance-adresse feuille-ordonnance-adresse-ar">
              {entete.adresse}
            </p>
            <p className="feuille-ordonnance-telephone">{entete.telephone}</p>
            <span className="feuille-ordonnance-horaires">{entete.horaires}</span>
          </div>
        </div>

        <div className="feuille-ordonnance-patient">
          <p className="feuille-ordonnance-lieu-date">
            {entete.ville}, le <span className="feuille-ordonnance-date">{dateCourte(ordonnance.date)}</span>
          </p>
          <dl className="feuille-ordonnance-identite">
            <div>
              <dt>Nom&nbsp;:</dt>
              <dd>{ordonnance.nomPatient.split(' ').slice(-1)[0] ?? ''}</dd>
            </div>
            <div>
              <dt>Prénom&nbsp;:</dt>
              <dd>{ordonnance.nomPatient.split(' ').slice(0, -1).join(' ')}</dd>
            </div>
            {ordonnance.agePatient ? (
              <div>
                <dt>Âge&nbsp;:</dt>
                <dd>{ordonnance.agePatient}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </header>

      <h1 className="feuille-ordonnance-titre">Ordonnance</h1>

      <div className="feuille-ordonnance-corps">
        {ordonnance.lignes.length === 0 ? (
          <p className="feuille-ordonnance-vide">Aucun médicament n’a encore été ajouté.</p>
        ) : (
          <ol className="feuille-ordonnance-liste">
            {ordonnance.lignes.map((ligne, index) => (
              <li key={`${ligne.medicament}-${index}`} className="feuille-ordonnance-medicament">
                <p className="feuille-ordonnance-med-nom">
                  <span className="feuille-ordonnance-med-numero">{index + 1}.</span> {ligne.medicament}
                </p>
                <p className="feuille-ordonnance-med-posologie">
                  {ligne.dosage} — {ligne.frequence} — {ligne.duree}
                </p>
                {ligne.instructions ? (
                  <p className="feuille-ordonnance-med-instructions">{ligne.instructions}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {ordonnance.notes ? <p className="feuille-ordonnance-notes">{ordonnance.notes}</p> : null}
      </div>

      <footer className="feuille-ordonnance-pied">
        <p lang="ar" dir="rtl">
          {entete.conseil}
        </p>
      </footer>
    </article>
  )
}
