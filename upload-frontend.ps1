# Upload-Script fuer Thaimachine AI Frontend
# Verwendet WinSCP (SFTP) mit den Syncorman-Daten

param(
    [string]$LocalPath = "C:\Users\Thaimachine\Documents\MainBrain\MiuCode Apps Entwicklung\T-Ai-machine\frontend\dist"
)

# Syncorman-Konfiguration (aus config.json):
$SftpHost = "92.205.171.196"
$SftpPort = 22
$SftpUser = "zhx0ri4nw02d"
$SftpPass = "Sdfwerqa3421!"
$RemotePath = "/home/zhx0ri4nw02d/public_html/thaimachinestudio.com/ai"

# Pruefe ob WinSCP verfuegbar ist
$winscpPaths = @(
    "C:\Program Files\WinSCP\WinSCP.com",
    "C:\Program Files (x86)\WinSCP\WinSCP.com",
    "$env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com"
)

$winscp = $null
foreach ($path in $winscpPaths) {
    if (Test-Path $path) {
        $winscp = $path
        break
    }
}

if (-not $winscp) {
    Write-Host "FEHLER: WinSCP nicht gefunden!" -ForegroundColor Red
    Write-Host "Download: https://winscp.net/eng/download.php" -ForegroundColor Yellow
    Write-Host "Oder nutze stattdessen das Syncorman-UI direkt." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== Thaimachine AI Frontend Upload (SFTP) ===" -ForegroundColor Cyan
Write-Host "WinSCP:  $winscp" -ForegroundColor Gray
Write-Host "Lokal:   $LocalPath" -ForegroundColor Gray
Write-Host "Remote:  sftp://${SftpUser}@${SftpHost}${RemotePath}" -ForegroundColor Gray
Write-Host ""

# WinSCP-Script-File generieren
$scriptFile = Join-Path $env:TEMP "winscp-upload-$(Get-Random).txt"
$scriptContent = @"
option batch abort
option confirm off
open sftp://${SftpUser}:${SftpPass}@${SftpHost}:${SftpPort}/
cd ${RemotePath}
option transfer binary
put -preservetime "${LocalPath}\index.html" "index.html"
put -preservetime "${LocalPath}\version.json" "version.json"
put -preservetime "${LocalPath}\sw.js" "sw.js"
put -preservetime "${LocalPath}\favicon.svg" "favicon.svg"
put -preservetime "${LocalPath}\icons.svg" "icons.svg"
put -preservetime "${LocalPath}\manifest.json" "manifest.json"
put -preservetime "${LocalPath}\.htaccess" ".htaccess"
mkdir "assets"
put -preservetime "${LocalPath}\assets\*" "assets/*"
mkdir "dictionaries"
put -preservetime "${LocalPath}\dictionaries\*" "dictionaries/*"
ls
close
exit
"@

$scriptContent | Out-File -FilePath $scriptFile -Encoding utf8

Write-Host "Starte Upload..." -ForegroundColor Yellow
& $winscp /script="$scriptFile" /log="$env:TEMP\winscp-upload.log"

$result = $LASTEXITCODE

Remove-Item $scriptFile -Force -ErrorAction SilentlyContinue

if ($result -eq 0) {
    Write-Host ""
    Write-Host "=== Upload erfolgreich! ===" -ForegroundColor Green
    Write-Host "Test: https://thaimachinestudio.com/ai/" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "=== Upload FEHLGESCHLAGEN (Exit: $result) ===" -ForegroundColor Red
    Write-Host "Log: $env:TEMP\winscp-upload.log" -ForegroundColor Yellow
}

exit $result
