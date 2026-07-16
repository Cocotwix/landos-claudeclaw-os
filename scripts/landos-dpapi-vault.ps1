param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('protect', 'unprotect')]
  [string]$Mode
)

# This helper intentionally receives sensitive material only over stdin. It does
# not write it, echo it, or place it in command-line arguments. Node owns the
# encrypted local record; Windows DPAPI owns the encryption key for the current
# Windows user.
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Vault request is empty.' }
$request = $raw | ConvertFrom-Json
Add-Type -AssemblyName System.Security

if ($Mode -eq 'protect') {
  if ($null -eq $request.value) { throw 'Vault protect request is missing a value.' }
  $plain = [Text.Encoding]::UTF8.GetBytes([string]$request.value)
  try {
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $plain,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    @{ value = [Convert]::ToBase64String($protected) } | ConvertTo-Json -Compress
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace([string]$request.value)) { throw 'Vault unprotect request is missing ciphertext.' }
$cipher = [Convert]::FromBase64String([string]$request.value)
try {
  $plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  try {
    # Base64 keeps arbitrary credential bytes out of PowerShell's encoding path.
    @{ value = [Convert]::ToBase64String($plain) } | ConvertTo-Json -Compress
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
} finally {
  [Array]::Clear($cipher, 0, $cipher.Length)
}
