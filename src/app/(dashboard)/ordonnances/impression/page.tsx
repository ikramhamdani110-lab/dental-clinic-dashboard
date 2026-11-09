import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { t } from '@content/index'

import { obtenirOrdonnance } from '@backend/services/prescriptions.service'
import { prisma } from '@backend/database/prisma'

import { PagePrivee } from '@/components/layout/page-privee'
import { ImpressionOrdonnance } from '@/components/medical/impression-ordonnance'

/**
 * IMPRESSION D'UNE ORDONNANCE (§21).
 *
 * Page ENTIEREMENT rendue cote serveur : la feuille A5 est dans le HTML initial
 * et ne depend d'aucune hydratation pour etre imprimable. Un petit composant
 * client lance la boite de dialogue d'impression du navigateur des que la page
 * est prete.
 */
export const metadata: Metadata = {
  title: t('ordonnances.titre'),
  robots: { index: false, follow: false },
}

export default async function PageImpressionOrdonnance({
  searchParams,
}: {
  searchParams: Promise<{ ordonnanceId?: string }>
}): Promise<React.JSX.Element> {
  const { ordonnanceId } = await searchParams
  const donnees = await obtenirOrdonnanceAvecPatient(ordonnanceId ?? '')
  if (!donnees) notFound()

  return (
    <PagePrivee cleTitre="ordonnances.titre">
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <ImpressionOrdonnance ordonnance={donnees.ordonnance} patient={donnees.patient} />
      </Suspense>
    </PagePrivee>
  )
}

async function obtenirOrdonnanceAvecPatient(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const ordonnance = await obtenirOrdonnance(id)
    const patient = await prisma.patient.findUnique({
      where: { id: ordonnance.patientId },
      select: { nom: true, prenom: true, age: true, sexe: true },
    })
    if (!patient) return null
    return { ordonnance, patient }
  } catch {
    return null
  }
}
