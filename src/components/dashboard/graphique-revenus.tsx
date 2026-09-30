'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formaterMontant } from '@backend/domain/finance'
import { t } from '@content/index'

/**
 * =============================================================================
 *  GRAPHIQUE DES REVENUS MENSUELS (§18, §25)
 * =============================================================================
 *
 *  Les valeurs proviennent des PAIEMENTS REELS agreges en base : le graphique ne
 *  calcule rien et ne telecharge jamais l'ensemble des paiements.
 *
 *  Presentation sobre : barres bleu medical, grille discrete, infobulle lisible.
 *  Un seul graphique sur le tableau de bord (§25 : « ne pas surcharger »).
 */

interface PointRevenus {
  mois: number
  annee: number
  totalCentimes: number
}

export function CarteGraphiqueRevenus({
  donnees,
  nomsMois,
}: {
  donnees: PointRevenus[]
  nomsMois: string[]
}): React.JSX.Element {
  const points = donnees.map((point) => ({
    etiquette: `${nomsMois[point.mois]?.slice(0, 3) ?? ''} ${String(point.annee).slice(2)}`,
    total: point.totalCentimes,
  }))

  const aucunRevenu = points.every((point) => point.total === 0)

  if (aucunRevenu) {
    return (
      <div className="etat-vide">
        <p className="etat-vide-texte">{t('rapports.aucuneDonnee')}</p>
      </div>
    )
  }

  return (
    <div className="graphique-conteneur">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--bordure)" vertical={false} />
          <XAxis
            dataKey="etiquette"
            tick={{ fill: 'var(--texte-tertiaire)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--bordure)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--texte-tertiaire)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={70}
            // Les montants sont en centimes : les graduations affichent des dinars.
            tickFormatter={(valeur: number) => `${Math.round(valeur / 100)}`}
          />
          <Tooltip
            cursor={{ fill: 'var(--fond-surface-douce)' }}
            contentStyle={{
              background: 'var(--fond-surface-eleve)',
              border: '1px solid var(--bordure)',
              borderRadius: 'var(--rayon-moyen)',
              color: 'var(--texte-principal)',
              fontSize: 13,
            }}
            formatter={(valeur: number) => [formaterMontant(valeur), t('rapports.revenus')]}
          />
          <Bar dataKey="total" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
