[CmdletBinding()]
param(
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SubmoduleDirectory = Join-Path $RepoRoot "external/MonoGame"
$StagingDirectory = Join-Path $RepoRoot "artifacts/monogame"
$WebOutput = Join-Path $SubmoduleDirectory "Example/bin/Web/Debug/net9.0/wwwroot"
$WebStatic = Join-Path $SubmoduleDirectory "Example/wwwroot"

function Invoke-CapturedGitStatus {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "git"
    $startInfo.ArgumentList.Add("-C")
    $startInfo.ArgumentList.Add($SubmoduleDirectory)
    $startInfo.ArgumentList.Add("status")
    $startInfo.ArgumentList.Add("--short")
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.UseShellExecute = $false

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Unable to inspect the MonoGame submodule working tree: $stderr"
    }
    return $stdout
}

function Format-Status([string]$Status) {
    if ([string]::IsNullOrEmpty($Status)) {
        return "(clean)"
    }
    return $Status.TrimEnd("`r", "`n")
}

Set-Location $RepoRoot

$PreBuildStatus = Invoke-CapturedGitStatus
$CommitSha = (& git -C external/MonoGame rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the MonoGame commit."
}
$DotnetSdkVersion = (& dotnet --version).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the active .NET SDK version."
}
$StatusBytes = [System.Text.Encoding]::UTF8.GetBytes($PreBuildStatus)
$PreBuildStatusSha256 = [Convert]::ToHexString(
    [System.Security.Cryptography.SHA256]::HashData($StatusBytes)
).ToLowerInvariant()

if ($AllowDirty) {
    & (Join-Path $PSScriptRoot "validate-submodule.ps1") -AllowDirty
}
else {
    & (Join-Path $PSScriptRoot "validate-submodule.ps1")
}
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
& (Join-Path $PSScriptRoot "check-emsdk-env.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Output "Building MonoGame at commit $CommitSha"
Set-Location external/MonoGame
& dotnet run --project build/Build.csproj
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
Set-Location ../..

& dotnet build external/MonoGame/Example/Example.Web.csproj --configuration Debug
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$RequiredPaths = @(
    (Join-Path $WebStatic "index.html"),
    (Join-Path $WebStatic "main.js"),
    (Join-Path $WebOutput "_framework/blazor.boot.json")
)
foreach ($RequiredPath in $RequiredPaths) {
    if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
        throw "Required MonoGame Web runtime artifact not found: $RequiredPath"
    }
}

$FrameworkDirectory = Join-Path $WebOutput "_framework"
$RequiredPatterns = @(
    "dotnet.native.*.wasm",
    "dotnet.native.*.js",
    "dotnet.runtime.*.js",
    "Example.Web.*.wasm",
    "MonoGame.Framework.*.wasm"
)
foreach ($Pattern in $RequiredPatterns) {
    if (@(Get-ChildItem -LiteralPath $FrameworkDirectory -Filter $Pattern -File).Count -lt 1) {
        throw "MonoGame Web runtime output is incomplete; missing artifact pattern: $Pattern"
    }
}

if (Test-Path -LiteralPath $StagingDirectory) {
    Remove-Item -LiteralPath $StagingDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDirectory | Out-Null
Copy-Item -Path (Join-Path $WebStatic "*") -Destination $StagingDirectory -Recurse
Copy-Item -Path (Join-Path $WebOutput "*") -Destination $StagingDirectory -Recurse

$Provenance = [ordered]@{
    commitSha = $CommitSha
    dotnetSdkVersion = $DotnetSdkVersion
    allowDirty = [bool]$AllowDirty
    preBuildStatus = $PreBuildStatus
    preBuildStatusSha256 = $PreBuildStatusSha256
}
$Provenance |
    ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $StagingDirectory "provenance.json") -Encoding utf8

$PostBuildStatus = Invoke-CapturedGitStatus
$PreEntries = @($PreBuildStatus -split "\r?\n" | Where-Object { $_ })
$PostEntries = @($PostBuildStatus -split "\r?\n" | Where-Object { $_ })
$PostBuildAdditions = @($PostEntries | Where-Object { $_ -notin $PreEntries })
$PostBuildRemovals = @($PreEntries | Where-Object { $_ -notin $PostEntries })

Write-Output "Pre-existing external/MonoGame status:"
Write-Output (Format-Status $PreBuildStatus)
Write-Output "Post-build external/MonoGame status:"
Write-Output (Format-Status $PostBuildStatus)
Write-Output "Post-build additions:"
Write-Output $(if ($PostBuildAdditions.Count) { $PostBuildAdditions -join [Environment]::NewLine } else { "(none)" })
Write-Output "Pre-existing entries no longer reported:"
Write-Output $(if ($PostBuildRemovals.Count) { $PostBuildRemovals -join [Environment]::NewLine } else { "(none)" })
Write-Output "Staged MonoGame Web runtime artifacts in $StagingDirectory"
