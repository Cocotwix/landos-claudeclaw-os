param(
  [Parameter(Mandatory = $true)][ValidateSet('protect','unprotect')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InputPath))
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Mode -eq 'protect') {
  $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect($inputBytes, $null, $scope)
} else {
  $outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, $scope)
}
[System.IO.File]::WriteAllBytes($OutputPath, $outputBytes)
