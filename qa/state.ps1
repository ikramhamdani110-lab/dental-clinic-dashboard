$u = (Get-Content .env | Select-String '^DATABASE_URL').ToString() -replace '^DATABASE_URL="', '' -replace '"$', ''
$m = [regex]::Match($u, '//([^:]+):([^@]+)@')
$env:PGPASSWORD = $m.Groups[2].Value
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
Write-Output "=== public apres reset+seed ==="
& $psql -h localhost -U $m.Groups[1].Value -d sahed_clinic -c "SELECT (SELECT count(*) FROM public.users) AS users, (SELECT count(*) FROM public.patients) AS patients, (SELECT count(*) FROM public.appointments) AS rdvs, (SELECT count(*) FROM public.payments) AS paiements;"
Write-Output "=== tier3 (donnees intactes ?) ==="
& $psql -h localhost -U $m.Groups[1].Value -d sahed_clinic -c "SELECT (SELECT count(*) FROM tier3.users) AS users, (SELECT count(*) FROM tier3.patients) AS patients, (SELECT count(*) FROM tier3.appointments) AS rdvs, (SELECT count(*) FROM tier3.payments) AS paiements;"
Write-Output "=== WAL / slots de reparation ==="
& $psql -h localhost -U $m.Groups[1].Value -d postgres -c "SELECT slot_name, active FROM pg_replication_slots;"
Write-Output "=== fichiers de la base (taille WAL) ==="
Get-ChildItem "C:\Program Files\PostgreSQL\16\data\pg_wal" -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select-Object Count, Sum
