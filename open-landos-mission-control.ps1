Add-Type -AssemblyName System.Windows.Forms

$repoPath = "C:\Users\tbutt\claudeclaw-os"
$envFile  = Join-Path $repoPath ".env"
$logFile  = Join-Path $repoPath "logs\main.log"
$port     = 3141

function Show-Error($msg) {
    [System.Windows.Forms.MessageBox]::Show(
        $msg,
        "LandOS Mission Control",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

# Read token
$tokenLine = Get-Content $envFile -ErrorAction SilentlyContinue |
             Where-Object { $_ -match "^DASHBOARD_TOKEN=" } |
             Select-Object -First 1

$token = if ($tokenLine) {
    ($tokenLine -replace "^DASHBOARD_TOKEN=", "").Trim().Trim('"').Trim("'")
} else { "" }

if (-not $token) {
    Show-Error "DASHBOARD_TOKEN missing or empty in .env`n$envFile"
    exit 1
}

function Test-Port {
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new()
        $ar  = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
        $ok  = $ar.AsyncWaitHandle.WaitOne(1000)
        $tcp.Close()
        return $ok
    } catch {
        return $false
    }
}

if (-not (Test-Port)) {
    $logsDir = Join-Path $repoPath "logs"
    if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Force $logsDir | Out-Null }

    $nodeExe = "C:\Program Files\nodejs\node.exe"
    $indexJs = Join-Path $repoPath "dist\index.js"
    $errFile = Join-Path $repoPath "logs\main-err.log"

    # stdout is not redirected here — pino's file transport writes JSON to
    # logs/main.log directly, so the log is captured regardless of how the
    # process is started. Redirecting stdout to the same file would cause
    # two writers (OS redirect + pino worker) to interleave writes.
    Start-Process -FilePath $nodeExe `
                  -ArgumentList $indexJs `
                  -WorkingDirectory $repoPath `
                  -RedirectStandardError  $errFile `
                  -WindowStyle Hidden

    $maxWait  = 45
    $waited   = 0
    $interval = 2
    while (-not (Test-Port) -and $waited -lt $maxWait) {
        Start-Sleep -Seconds $interval
        $waited += $interval
    }

    if (-not (Test-Port)) {
        Show-Error "Server did not open port $port within ${maxWait}s.`nCheck logs at:`n$logFile"
        exit 1
    }
}

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
    $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

$url = "http://localhost:$port/?token=$token"

if (Test-Path $chrome) {
    Start-Process $chrome $url
} else {
    Start-Process $url
}
