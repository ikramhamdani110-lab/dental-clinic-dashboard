import { NextResponse } from 'next/server'

import { responseErreur, routePrivee } from '@backend/http/route-handler'
import { pdfTableauDeBord } from '@backend/pdf/tableau-de-bord-pdf'

/**
 * GET /api/dashboard/pdf — export PDF du tableau de bord (§25, §45).
 *
 * ROUTE PRIVÉE : la session médecin est vérifiée par `routePrivee`, comme pour
 * toute l'API. Aucun accès anonyme, aucune URL publique.
 *
 * Les valeurs imprimées proviennent du MÊME service que GET /api/dashboard
 * (`donneesTableauBord`), donc elles ne peuvent pas diverger de l'écran.
 * Le PDF est généré à la demande et renvoyé en mémoire : rien n'est écrit
 * sur le disque, rien n'est stocké.
 *
 * EXIGENCE PRODUIT : tout PDF est imprime en FRANCAIS, quelle que soit la
 * langue affichee dans l'interface. Le document n'est JAMAIS genere en arabe.
 */
export const GET = routePrivee(async (): Promise<NextResponse> => {
  try {
    const pdf = await pdfTableauDeBord('fr')
    const aujourdhui = new Date().toISOString().slice(0, 10)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tableau-de-bord-sahed-dental-clinic-${aujourdhui}.pdf"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return responseErreur(error)
  }
})
