# Demarre les deux serveurs de preview DETACHES (survivent a la fin du script).
# Secrétaire : port 3100 ; Finances : port 3200. Base : demonstration (5433).
$racine = 'C:\Users\pc\CodeGPT\sahed-dental-clinic-2'
Set-Location $racine
Start-Process -FilePath 'node' -ArgumentList 'scripts\preview.mjs' -WorkingDirectory $racine -WindowStyle Hidden -RedirectStandardOutput "$racine\.preview-out.log" -RedirectStandardError "$racine\.preview-err.log"
Start-Sleep -Seconds 6
Get-Content "$racine\.preview-out.log" -Tail 10
