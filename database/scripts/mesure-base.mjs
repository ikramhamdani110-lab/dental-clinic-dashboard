#!/usr/bin/env node
/**
 * =============================================================================
 *  MESURE BASE — TEMPS D'EXECUTION REELS DES REQUETES DES RAPPORTS
 * =============================================================================
 *
 *  `pg_stat_statements` ne peut pas etre charge sur cette machine (le DLL plante
 *  au demarrage du postmaster). On mesure donc le temps d'execution COTE BASE
 *  autrement, et de maniere tout aussi reelle : `EXPLAIN (ANALYZE, BUFFERS)` sur
 *  les requetes REELLES, contre le jeu de donnees REELLEMENT charge.
 *
 *  On y ajoute le nombre d'appels Prisma par endpoint, compte en instrumentant
 *  un `PrismaClient` avec l'evenement `query` (mode debug Prisma).
 *
 *  Aucun chiffre n'est invente : chaque mesure provient d'EXPLAIN ANALYZE ou de
 *  l'horloge de la base.
 */

import { PrismaClient } from '@prisma/client'

const URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/sahed_load_test?schema=public'

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } })

  process.stdout.write('Mesures EXPLAIN (ANALYZE, BUFFERS) — base de charge reelle\n\n')

  const exigences = [
    [
      'revenusParMois (12 mois) — DATE_TRUNC + GROUP BY',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING) 
      SELECT
        EXTRACT(YEAR FROM DATE_TRUNC('month', "datePaiement"))::int AS annee,
        (EXTRACT(MONTH FROM DATE_TRUNC('month', "datePaiement"))::int - 1) AS mois,
        SUM("montantCentimes")::bigint AS total_centimes
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
        AND "datePaiement" >= '2026-02-01 00:00:00'::timestamp
      GROUP BY DATE_TRUNC('month', "datePaiement")
      ORDER BY DATE_TRUNC('month', "datePaiement") ASC
      `,
    ],
    [
      'rapportSoldesPatients — COUNT (CTE + filtre reste > 0)',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING)
      WITH facturation AS (
        SELECT "patientId", SUM("prixTotalCentimes")::bigint AS facture
        FROM "treatments" WHERE "statut" <> 'ANNULE'::"StatutTraitement" GROUP BY "patientId"
      ), encaissement AS (
        SELECT "patientId", SUM("montantCentimes")::bigint AS paye
        FROM "payments" WHERE "statut" = 'VALIDE'::"StatutPaiement" GROUP BY "patientId"
      ), soldes AS (
        SELECT f."patientId", f.facture, COALESCE(e.paye,0)::bigint AS paye,
               (f.facture - COALESCE(e.paye,0))::bigint AS reste
        FROM facturation f LEFT JOIN encaissement e ON e."patientId" = f."patientId"
      )
      SELECT COUNT(*)::bigint FROM soldes WHERE reste > 0
      `,
    ],
    [
      'rapportSoldesPatients — page (ORDER BY + LIMIT/OFFSET)',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING)
      WITH facturation AS (
        SELECT "patientId", SUM("prixTotalCentimes")::bigint AS facture
        FROM "treatments" WHERE "statut" <> 'ANNULE'::"StatutTraitement" GROUP BY "patientId"
      ), encaissement AS (
        SELECT "patientId", SUM("montantCentimes")::bigint AS paye
        FROM "payments" WHERE "statut" = 'VALIDE'::"StatutPaiement" GROUP BY "patientId"
      ), soldes AS (
        SELECT f."patientId", f.facture, COALESCE(e.paye,0)::bigint AS paye,
               (f.facture - COALESCE(e.paye,0))::bigint AS reste
        FROM facturation f LEFT JOIN encaissement e ON e."patientId" = f."patientId"
      )
      SELECT "patientId", facture, paye, reste FROM soldes
      WHERE reste > 0 ORDER BY reste DESC, "patientId" ASC LIMIT 25 OFFSET 0
      `,
    ],
    [
      'Liste patients — page 1 (LIMIT/OFFSET)',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING)
      SELECT * FROM "patients" ORDER BY "createdAt" DESC LIMIT 25 OFFSET 0
      `,
    ],
    [
      'Liste paiements — page 1 (tri par date)',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING)
      SELECT id, "montantCentimes", "datePaiement" FROM "payments"
      ORDER BY "datePaiement" DESC LIMIT 25 OFFSET 0
      `,
    ],
    [
      'Journal d’activite — page 1',
      `
      EXPLAIN (ANALYZE, BUFFERS, TIMING)
      SELECT id FROM "activity_logs" ORDER BY "createdAt" DESC LIMIT 25 OFFSET 0
      `,
    ],
  ]

  for (const [label, sql] of exigences) {
    const lignes = await prisma.$queryRawUnsafe(sql)
    const texte = lignes.map((l) => l['QUERY PLAN']).join('\n')
    // La ligne « Execution Time » est fournie par PostgreSQL lui-meme.
    const match = texte.match(/Execution Time: ([\d.]+) ms/)
    const planning = texte.match(/Planning Time: ([\d.]+) ms/)
    const lignesParc = texte.match(/rows=(\d+)/)
    process.stdout.write(
      `  ${label}\n     Execution: ${match?.[1] ?? '?'} ms   Planning: ${planning?.[1] ?? '?'} ms\n`,
    )
    if (lignesParc) process.stdout.write(`     (nœud racine rows=${lignesParc[1]})\n`)
  }

  process.stdout.write('\nCompte des appels Prisma par endpoint (evenement query) :\n')
  const compteur = { appels: 0, requetes: [] }
  const p2 = new PrismaClient({
    datasources: { db: { url: URL } },
    log: [{ emit: 'event', level: 'query' }],
  })
  p2.$on('query', (e) => {
    compteur.appels += 1
    compteur.requetes.push({ sql: e.query.slice(0, 120), ms: e.duration })
  })

  // Endpoint dashboard : reproduit l'ensemble des appels de donneesTableauBord().
  compteur.appels = 0
  compteur.requetes = []
  await p2.patient.count()
  await p2.appointment.findMany({ where: { statut: { notIn: ['ANNULE'] } }, take: 10 })
  await p2.treatment.count({ where: { statut: 'EN_COURS' } })
  await p2.payment.count({ where: { statut: 'VALIDE' } })
  process.stdout.write(`  /api/dashboard (approximation) : ${compteur.appels} requetes, ` +
    `somme ${compteur.requetes.reduce((s, r) => s + r.ms, 0)} ms\n`)

  await p2.$disconnect()
  await prisma.$disconnect()
}

main().catch((e) => {
  process.stderr.write('Echec mesure base : ' + (e instanceof Error ? e.message : String(e)) + '\n')
  process.exit(1)
})