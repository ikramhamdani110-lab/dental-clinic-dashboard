# QA BROWSER — APPLICATION SECRETAIRE (port 3100, base demo)
# Verifie : pas de salutation, indicateur Nouveaux patients cliquable,
#           vue nouvelles-entrees, traitement texte libre, acompte.
$ErrorActionPreference = 'Stop'

function Login-Secretaire {
  $body = '{"email":"demo@cabinet.local","password":"MR1VN8HB0bHoPSa1PPd3CwwMG4M1kuLA"}'
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/auth/login' -Method POST -Body $body -ContentType 'application/json' -SessionVariable sess
  return $sess
}
$sess = Login-Secretaire
Write-Host "login OK ($($r.StatusCode))"

# ── 1. Tableau de bord : PAS de « Bonjour Dr Sahed » ──
$dash = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/tableau-de-bord' -WebSession $sess
$html = $dash.Content
if ($html -match 'Bonjour Dr') { Write-Host 'ECHEC : salutation encore presente' } else { Write-Host '1. salutation absente : OK' }
if ($html -match 'Nouveaux patients') { Write-Host '   indicateur Nouveaux patients present : OK' } else { Write-Host 'ECHEC : indicateur absent' }
if ($html -match 'rendez-vous\?vue=nouvelles-entrees') { Write-Host '   lien vers ?vue=nouvelles-entrees : OK' } else { Write-Host 'ECHEC : lien absent' }

# ── 2. Vue nouvelles-entrees ──
$nv = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/rendez-vous?vue=nouvelles-entrees' -WebSession $sess
if ($nv.Content -match 'Nouveaux rendez-vous') { Write-Host '2. section Nouveaux rendez-vous affichee : OK' } else { Write-Host 'ECHEC : section absente' }

# ── 3. Formulaire rendez-vous : champ Traitement texte libre (PAS de <select>) ──
$frm = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/rendez-vous/nouveau' -WebSession $sess
$zone = [regex]::Match($frm.Content, '<main[\s\S]*?</main>').Value
if ($zone -match '<select') { Write-Host 'ECHEC : un select est present dans le formulaire rendez-vous' }
else { Write-Host '3. aucun select dans le formulaire rendez-vous : OK' }
if ($zone -match 'Demande du patient') { Write-Host '   champ Demande du patient conserve : OK' } else { Write-Host 'ECHEC : demande du patient absente' }

# ── 4. API dashboard : indicateurs ──
$d = Invoke-RestMethod -Uri 'http://127.0.0.1:3100/api/dashboard' -WebSession $sess
Write-Host ("4. dashboard : rdvJour={0} nouveauxPatients={1} patientsJour={2}" -f $d.rendezVousDuJour.Count, $d.nouveauxPatientsJour, $d.patientsVenusJour)
