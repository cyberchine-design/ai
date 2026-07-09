# Auto-generierter FileSystemWatcher
# Ueberwacht backend/src/ auf Aenderungen und macht auto-commit + push
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = 'C:\\Users\\Thaimachine\\Documents\\MainBrain\\MiuCode Apps Entwicklung\\T-Ai-machine\backend\src'
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$debounceTimer = $null
$action = {
    if ($debounceTimer) { [System.Threading.Timer]::static.Dispose() }
    $debounceTimer = [System.Threading.Timer]::new({
        $debounceTimer.Dispose()
        Push-Location 'C:\\Users\\Thaimachine\\Documents\\MainBrain\\MiuCode Apps Entwicklung\\T-Ai-machine'
        $status = git status --porcelain 2>&1
        if ($status) {
            git add backend/src/
            git commit -m 'auto-deploy: backend/src change detected' 2>&1 | Out-Null
            git pull --rebase origin main 2>&1 | Out-Null
            git push origin main 2>&1
            Write-Host '[auto-push] Backend deployed ' (Get-Date -Format 'HH:mm:ss')
        }
        Pop-Location
    }, $null, 5000, [System.Threading.Timeout]::Infinite)
}

Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action
Register-ObjectEvent -InputObject $watcher -EventName Created -Action $action
Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action $action

Write-Host '[auto-push-watcher] Watching: C:\Users\Thaimachine\Documents\MainBrain\MiuCode Apps Entwicklung\T-Ai-machine\backend\src'
Write-Host 'Druecke Strg+C zum Beenden'

while ($true) { Start-Sleep -Seconds 60 }
