param(
  [Parameter(Mandatory = $true)]
  [int]$PidNumber
)

$ErrorActionPreference = 'Stop'

try {
  $process = Get-Process -Id $PidNumber -ErrorAction Stop
  [pscustomobject]@{
    alive = -not $process.HasExited
    pid = $process.Id
    name = $process.ProcessName
    executable = $process.Path
    startTime = $process.StartTime.ToUniversalTime().ToString('o')
    inspectionFailed = $false
  } | ConvertTo-Json -Compress
  exit 0
} catch {
  $notFound = $_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*'
  [pscustomobject]@{
    alive = $false
    pid = $PidNumber
    reason = $_.Exception.Message
    inspectionFailed = -not $notFound
  } | ConvertTo-Json -Compress
  exit 0
}
