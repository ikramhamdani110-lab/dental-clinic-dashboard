/**
 * PARCOURS COMPLET, tel que le medecin le vivrait.
 * Chaque etape est verifiee, et les erreurs console / reseau sont collectees.
 */
const EMAIL = 'dr.sahed@demo.cabinet'
const MDP = 'DemoSahed2026!'

export default async function run(page) {
  const journal = []
  const erreursConsole = []
  const echecsReseau = []
  const attendre = (ms) => page.waitForTimeout(ms)
  const note = (etape, detail) => journal.push({ etape, ...detail })

  page.on('console', (m) => {
    if (m.type() === 'error') erreursConsole.push(m.text().slice(0, 160))
  })
  page.on('requestfailed', (r) => {
    echecsReseau.push({ url: r.url().replace('http://localhost:3000', ''), raison: r.failure()?.errorText })
  })

  const donnees = async () =>
    page.evaluate(async () => {
      const r = await fetch('/api/dashboard', { credentials: 'include' })
      return r.json()
    })

  await page.setViewportSize({ width: 1440, height: 900 })

  // 1. Connexion
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(MDP)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await attendre(3000)
  const tdb0 = await donnees()
  note('1-connexion-dashboard', {
    cartes: await page.locator('.grille-statistiques .statistique').count(),
    rdvs: tdb0.rendezVousDuJour?.length,
    sansRdv: tdb0.patientsSansRendezVous?.length,
    revenus: tdb0.revenusJourCentimes,
    restant: tdb0.totalRestantCentimes,
  })

  // 2. Suggestions de patients : AUCUN detail (nom seul)
  await page.goto('http://localhost:3000/rendez-vous/nouveau', { waitUntil: 'networkidle' })
  await attendre(2500)
  const champPatient = page.locator('#nom-patient-rendez-vous').first()
  await champPatient.click()
  await champPatient.type('a')
  await attendre(2200)
  const suggestions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#suggestions-patients-rendez-vous [role="option"]')).map(
      (o) => ({ texte: o.textContent.trim(), enfants: o.children.length }),
    ),
  )
  note('2-suggestions', {
    nombre: suggestions.length,
    exemples: suggestions.slice(0, 4),
    toutesNomSeul: suggestions.every((s) => s.enfants === 0),
  })

  // 3. Creation d'un patient
  const marqueur = 'Démo' + Date.now().toString().slice(-5)
  await page.goto('http://localhost:3000/patients/nouveau', { waitUntil: 'networkidle' })
  await attendre(2000)
  await page.locator('input[name="nom"]').first().fill(marqueur)
  await page.locator('input[name="prenom"]').first().fill('Yacine')
  await page.locator('input[name="age"]').first().fill('37')
  await page.locator('input[name="telephone"]').first().fill('0550 11 44 88')
  await page.getByRole('button', { name: 'Creer le patient', exact: true }).first().click()
  await page.waitForURL(/\/patients\/[0-9a-f-]{20,}/, { timeout: 45000 })
  await attendre(2500)
  const urlFiche = page.url()
  note('3-patient-cree', {
    nom: marqueur,
    url: urlFiche,
    ageAffiche: (await page.locator('body').innerText()).includes('37'),
  })

  // 4. Rendez-vous depuis la fiche : Total / Paye / Reste, saisie continue
  const lienRdv = page.locator('a[href^="/rendez-vous/nouveau?patientId="]').first()
  await lienRdv.click()
  await page.waitForURL('**/rendez-vous/nouveau**', { timeout: 40000 })
  await attendre(2500)
  const patientRdv = await page.locator('input[name="patient-rendez-vous"]').first().inputValue()
  const patientLectureSeule = await page
    .locator('input[name="patient-rendez-vous"]')
    .first()
    .evaluate((e) => e.readOnly)
  note('4a-rdv-patient-pre-rempli', { valeur: patientRdv, lectureSeule: patientLectureSeule })

  await page.locator('select[name="traitement-rendez-vous"]').first().selectOption({ index: 1 })
  // Saisie CONTINUE de 15000
  const total = page.locator('input[name="total-rendez-vous"]').first()
  await total.click()
  const etapesTotal = []
  for (const c of '15000') {
    await page.keyboard.type(c)
    await attendre(70)
    etapesTotal.push(await total.inputValue())
  }
  const paye = page.locator('input[name="paye-rendez-vous"]').first()
  await paye.click()
  for (const c of '10000') {
    await page.keyboard.type(c)
    await attendre(70)
  }
  await attendre(700)
  const reste = await page.locator('output').first().innerText().catch(() => null)
  note('4b-rdv-saisie', {
    totalSaisi: etapesTotal,
    focusUnique: new Set(etapesTotal).size === 5,
    resteAffiche: reste,
  })

  await page.getByRole('button', { name: /Enregistrer|Creer/i }).first().click()
  await page.waitForURL(/\/patients\/[0-9a-f-]{20,}/, { timeout: 45000 }).catch(() => { })
  await attendre(3000)
  const texteFiche = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  note('4c-rdv-enregistre', {
    aTraitement: /20\s?000/.test(texteFiche),
    aReste: /5\s?000/.test(texteFiche),
  })

  // 5. Deux paiements partiels, saisie continue
  for (const montant of ['7000', '3000']) {
    const ajouter = page.getByRole('button', { name: 'Ajouter un paiement', exact: true }).first()
    await ajouter.click()
    await page.waitForSelector('.modale input[name="montant"]', { timeout: 25000 })
    await attendre(1600)
    const champ = page.locator('.modale input[name="montant"]').first()
    await champ.click()
    const etapes = []
    for (const c of montant) {
      await page.keyboard.type(c)
      await attendre(70)
      etapes.push(await champ.inputValue())
    }
    const totaux = await page.locator('.modale .grille-solde').innerText()
    await page.locator('.modale button[type="submit"]').first().click()
    await page.waitForSelector('.modale input[name="montant"]', { state: 'detached', timeout: 30000 })
    await attendre(2500)
    note(`5-paiement-${montant}`, {
      etapes,
      focusUnique: new Set(etapes).size === montant.length,
      totauxAvant: totaux.replace(/\s+/g, ' '),
    })
  }
  const texteFinal = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  note('5b-solde-final', {
    aPaye10: /10\s?000/.test(texteFinal),
    aReste5: /5\s?000/.test(texteFinal),
  })

  // 6. Tableau de bord
  await page.goto('http://localhost:3000/tableau-de-bord', { waitUntil: 'networkidle' })
  await attendre(3000)
  const tdb1 = await donnees()
  note('6-tdb-final', {
    revenusAvant: tdb0.revenusJourCentimes,
    revenusApres: tdb1.revenusJourCentimes,
    delta: tdb1.revenusJourCentimes - tdb0.revenusJourCentimes,
    paiementsAvant: tdb0.nombrePaiementsJour,
    paiementsApres: tdb1.nombrePaiementsJour,
  })

  // 7. Statut d'un rendez-vous
  await page.goto('http://localhost:3000/rendez-vous', { waitUntil: 'networkidle' })
  await attendre(3000)
  const selecteurs = await page.locator('select[name^="statut-"]').count()
  const options = selecteurs
    ? await page.locator('select[name^="statut-"]').first().locator('option').evaluateAll((o) =>
      o.map((x) => x.textContent.trim()),
    )
    : []
  const avantRdv = await page.locator('table tbody tr').count()
  let changement = null
  if (selecteurs > 0) {
    const sel = page.locator('select[name^="statut-"]').first()
    await sel.selectOption('ABSENT')
    await attendre(3000)
    const apresRdv = await page.locator('table tbody tr').count()
    const badge = await page
      .locator('table tbody tr')
      .first()
      .innerText()
      .catch(() => '')
    changement = { avant: avantRdv, apres: apresRdv, pasDeDoublon: avantRdv === apresRdv, ligne: badge.replace(/\s+/g, ' ').slice(0, 80) }
  }
  note('7-statut-rdv', { selecteurs, options, changement })

  // 8. Rapports : periodes
  const rapports = []
  await page.goto('http://localhost:3000/rapports/', { waitUntil: 'networkidle' })
  await attendre(2500)
  const menu = page.locator('select#periode-rapport, select[name="periode-rapport"]').first()
  for (const v of ['7-jours', '30-jours', 'annee', 'annee-precedente']) {
    await menu.selectOption(v)
    await attendre(2600)
    rapports.push({
      periode: v,
      cartes: await page
        .locator('.grille-statistiques .statistique-valeur')
        .evaluateAll((e) => e.map((x) => x.textContent.trim())),
    })
  }
  note('8-rapports-periodes', rapports)

  // 9. Personnaliser
  await menu.selectOption('personnalisee')
  await attendre(1000)
  const du = page.locator('input[name="periode-du"]').first()
  const au = page.locator('input[name="periode-au"]').first()
  const iso = (d) => d.toISOString().slice(0, 10)
  await du.fill(iso(new Date(Date.now() - 45 * 86400000)))
  await au.fill(iso(new Date()))
  await page.getByRole('button', { name: /Afficher/i }).first().click()
  await attendre(3000)
  note('9-personnalise', {
    cartes: await page
      .locator('.grille-statistiques .statistique-valeur')
      .evaluateAll((e) => e.map((x) => x.textContent.trim())),
  })

  // 10. Themes
  for (const theme of ['sombre', 'clair']) {
    await page.goto('http://localhost:3000/tableau-de-bord', { waitUntil: 'networkidle' })
    await page.evaluate((t) => {
      localStorage.setItem('sahed-theme', t)
      document.documentElement.setAttribute('data-theme', t)
    }, theme)
    await attendre(2000)
    note(`10-theme-${theme}`, {
      fond: await page.evaluate(() => getComputedStyle(document.querySelector('.contenu-principal')).backgroundColor),
    })
  }

  await page.screenshot({ path: 'demo-final.png', fullPage: true })

  return {
    journal,
    erreursConsole,
    echecsReseau: echecsReseau.filter((e) => !e.url.includes('_rsc')),
  }
}
