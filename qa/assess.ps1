$u = (Get-Content .env | Select-String '^DATABASE_URL').ToString() -replace '^DATABASE_URL="', '' -replace '"$', ''
$m = [regex]::Match($u, '//([^:]+):([^@]+)@')
$env:PGPASSWORD = $m.Groups[2].Value
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
Write-Output "=== URL (masquee) ==="
Write-Output ($u -replace '//[^@]*@', '//<masquee>@')
Write-Output "=== SCHEMAS ==="
& $psql -h localhost -U $m.Groups[1].Value -d sahed_clinic -c "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';"
Write-Output "=== TAILLE DES TABLES ==="
& $psql -h localhost -U $m.Groups[1].Value -d sahed_clinic -c "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname IN ('public','tier3') AND relname IN ('patients','users','appointments','payments') ORDER BY schemaname, relname;"
Write-Output "=== SAUVEGARDES ==="
Get-ChildItem -Recurse -Include *.sql, *.dump, *.backup -Path . -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' } | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
