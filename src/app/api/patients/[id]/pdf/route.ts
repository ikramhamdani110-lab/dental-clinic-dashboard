import { type NextRequest, NextResponse } from 'next/server'

import { responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { pdfDossierPatient } from '@backend/pdf/dossier-patient-pdf'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/pdf — export PDF du dossier patient (§10, §45).
 *
 * SÉCURITÉ (§39, §45) :
 *   1. session médecin vérifiée par `routePriveeAvecId` (cookie HttpOnly) ;
 *   2. identifiant validé comme UUID AVANT tout accès base ;
 *   3. le patient est validé PAR LE SERVICE (`obtenirPatient` lève INTROUVABLE
 *      si absent ou en corbeille) — connaître un identifiant ne suffit pas ;
 *   4. seules les données DE CE patient sont lues, filtrées par le serveur ;
 *   5. le PDF est composé cote serveur et renvoyé en mémoire : rien n'est
 *      écrit sur le disque, rien n'est stocké, aucun fichier public.
 *
  * Aucune donnée patient n'apparaît dans l'URL ni dans les journaux : seul
  * l'identifiant interne (déjà présent dans l'URL de la fiche) transite.
  *
  * EXIGENCE PRODUIT : tout PDF est imprime en FRANCAIS, quelle que soit la
  * langue affichee dans l'interface. Le document n'est JAMAIS genere en arabe.
  */
 export const GET = routePriveeAvecId(
   async (_request: NextRequest, id: string): Promise<NextResponse> => {
     try {
       const patientId = valider(identifiant, id)
       // Le nom de fichier est construit cote PDF, APRES validation du patient.
       const { pdf, nomFichier } = await pdfDossierPatient(patientId, 'fr')

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${nomFichier}"`,
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      return responseErreur(error)
    }
  },
)
