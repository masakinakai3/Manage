param(
    [string]$AdminUsername = "admin",
    [string]$ExePath = "",
    [string]$NewPassword = ""
)

$ErrorActionPreference = "Stop"

if (-not $ExePath) {
    $ExePath = Join-Path $PSScriptRoot "..\dist\manage_app.exe"
}

$resolvedExePath = [System.IO.Path]::GetFullPath($ExePath)
if (-not (Test-Path -LiteralPath $resolvedExePath)) {
    throw "manage_app.exe was not found: $resolvedExePath"
}

if (-not $NewPassword) {
    $securePassword = Read-Host "Enter the new admin password" -AsSecureString
    $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $NewPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    }
}

if ([string]::IsNullOrWhiteSpace($NewPassword)) {
    throw "An empty password is not allowed."
}

$previousResetUsername = $env:RESET_ADMIN_USERNAME
$previousResetPassword = $env:RESET_ADMIN_PASSWORD

try {
    $env:RESET_ADMIN_USERNAME = $AdminUsername
    $env:RESET_ADMIN_PASSWORD = $NewPassword

    Write-Host "Starting admin password reset mode for: $AdminUsername"
    Write-Host "Executable: $resolvedExePath"
    Write-Host "Wait for the reset confirmation message in the startup log, then sign in with the new password."

    & $resolvedExePath
} finally {
    if ($null -eq $previousResetUsername) {
        Remove-Item Env:RESET_ADMIN_USERNAME -ErrorAction SilentlyContinue
    } else {
        $env:RESET_ADMIN_USERNAME = $previousResetUsername
    }

    if ($null -eq $previousResetPassword) {
        Remove-Item Env:RESET_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    } else {
        $env:RESET_ADMIN_PASSWORD = $previousResetPassword
    }
}
