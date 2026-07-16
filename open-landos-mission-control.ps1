Add-Type -AssemblyName System.Windows.Forms

$repoPath = $PSScriptRoot
$envFile  = Join-Path $repoPath ".env"
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

$nodeExe = "C:\Program Files\nodejs\node.exe"
$runtimeScript = Join-Path $repoPath "scripts\runtime\landos-runtime.mjs"

# Always delegate startup and validation to the repository runtime. A raw port
# check cannot distinguish LandOS from an unrelated listener.
& $nodeExe $runtimeScript start
if ($LASTEXITCODE -ne 0) {
    Show-Error "The canonical LandOS runtime could not validate or start the dashboard.`nRun npm run landos:logs in:`n$repoPath"
    exit 1
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
