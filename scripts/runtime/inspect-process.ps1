param(
  [Parameter(Mandatory = $true)]
  [int]$PidNumber
)

$ErrorActionPreference = 'Stop'

try {
  $process = Get-Process -Id $PidNumber -ErrorAction Stop
  # Some protected Windows services expose the process row while withholding
  # Path and StartTime. Treat that as an alive, non-associable process instead
  # of failing inspection; stale LandOS history PIDs are commonly reused this
  # way and must not prevent the canonical runtime from starting.
  $startTime = if ($null -ne $process.StartTime) { $process.StartTime.ToUniversalTime().ToString('o') } else { $null }
  [pscustomobject]@{
    alive = -not $process.HasExited
    pid = $process.Id
    name = $process.ProcessName
    executable = $process.Path
    startTime = $startTime
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
