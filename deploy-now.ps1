# PowerShell: Direkter SFTP-Upload mit Passwort im Klartext
# (nur für lokales Test-Setup ok)

param(
    [string]$LocalPath = "C:\Users\Thaimachine\Documents\MainBrain\MiuCode Apps Entwicklung\T-Ai-machine\frontend\dist",
    [string]$RemoteHost = "92.205.171.196",
    [int]$Port = 22,
    [string]$User = "zhx0ri4nw02d",
    [string]$Password = "Sdfwerqa3421!",
    [string]$RemotePath = "/home/zhx0ri4nw02d/public_html/thaimachinestudio.com/ai"
)

Add-Type -AssemblyName System.Net

# sftp-Skript generieren
$tempScript = [System.IO.Path]::GetTempFileName()
$commands = @()
$commands += "option batch on"
$commands += "option confirm off"
$commands += "open sftp://${User}:${Password}@${RemoteHost}:${Port}/"
$commands += "cd ${RemotePath}"
$commands += "lcd `"$LocalPath`""
$commands += "put -preservetime index.html"
$commands += "put -preservetime version.json"
$commands += "put -preservetime sw.js"
$commands += "put -preservetime favicon.svg"
$commands += "put -preservetime icons.svg"
$commands += "put -preservetime manifest.json"
$commands += "put -preservetime .htaccess"
$commands += "cd assets"
$commands += "put -preservetime *"
$commands += "cd .."
$commands += "cd dictionaries"
$commands += "put -preservetime *"
$commands += "exit"

$commands -join "`n" | Out-File $tempScript -Encoding utf8

# WinSCP oder psftp verfügbar?
$tools = @("C:\Program Files\WinSCP\WinSCP.com", "C:\Program Files (x86)\WinSCP\WinSCP.com")
$tool = $null
foreach ($t in $tools) { if (Test-Path $t) { $tool = $t; break } }

if ($tool) {
    Write-Host "Verwende WinSCP..." -ForegroundColor Cyan
    & $tool /script="$tempScript"
} else {
    Write-Host "WinSCP nicht gefunden. Verwende .NET SFTP..." -ForegroundColor Cyan

    # .NET 7+ hat kein SFTP eingebaut. Versuche via SSH.NET DLL falls vorhanden
    $sshNet = "C:\Users\Thaimachine\.nuget\packages\ssh.net\*\lib\net47\Renci.SshNet.dll"
    $sshNetExists = Test-Path $sshNet

    if ($sshNetExists) {
        Write-Host "SSH.NET gefunden, verwende es..." -ForegroundColor Green
        # Wäre zu komplex - skip
    }

    Write-Host "FEHLER: Kein SFTP-Tool gefunden." -ForegroundColor Red
    Write-Host "Bitte installiere WinSCP: https://winscp.net/eng/download.php" -ForegroundColor Yellow
    exit 1
}

Remove-Item $tempScript -Force
Write-Host "Upload abgeschlossen!" -ForegroundColor Green
