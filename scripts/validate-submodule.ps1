[CmdletBinding()]
param(
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SubmoduleDirectory = Join-Path $RepoRoot "external/MonoGame"
$ManifestPath = Join-Path $RepoRoot "docs/toolchain-manifest.json"

function Exit-SubmoduleNotInitialized {
    [Console]::Error.WriteLine("MonoGame submodule is not initialized.")
    [Console]::Error.WriteLine()
    [Console]::Error.WriteLine("Run:")
    [Console]::Error.WriteLine()
    [Console]::Error.WriteLine("    git submodule update --init --recursive")
    exit 1
}

if (-not (Test-Path -LiteralPath $SubmoduleDirectory -PathType Container) -or
    @(Get-ChildItem -LiteralPath $SubmoduleDirectory -Force -ErrorAction SilentlyContinue).Count -eq 0) {
    Exit-SubmoduleNotInitialized
}

$SubmoduleTopLevel = & git -C $SubmoduleDirectory rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or
    [System.IO.Path]::GetFullPath($SubmoduleTopLevel) -ne [System.IO.Path]::GetFullPath($SubmoduleDirectory)) {
    Exit-SubmoduleNotInitialized
}

$Gitlink = & git -C $RepoRoot ls-files --stage -- external/MonoGame 2>$null
if ($LASTEXITCODE -ne 0 -or $Gitlink -notmatch "^160000 ") {
    Exit-SubmoduleNotInitialized
}

try {
    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $Expected = [string]$Manifest.monogame.commitSha
    $ProtectedRef = [string]$Manifest.monogame.protectedRef
    $Branch = [string]$Manifest.monogame.branch
    if ([string]::IsNullOrWhiteSpace($Expected) -or
        [string]::IsNullOrWhiteSpace($ProtectedRef) -or
        [string]::IsNullOrWhiteSpace($Branch)) {
        throw "monogame values must be non-empty strings"
    }
}
catch {
    [Console]::Error.WriteLine("Unable to read MonoGame pins from ${ManifestPath}: $($_.Exception.Message)")
    exit 1
}

$Actual = & git -C $SubmoduleDirectory rev-parse HEAD 2>$null
if ($LASTEXITCODE -ne 0) {
    Exit-SubmoduleNotInitialized
}

if ($Expected -ne $Actual) {
    [Console]::Error.WriteLine("MonoGame submodule commit mismatch: expected $Expected, found $Actual. Run 'git submodule update --init --recursive' or update docs/toolchain-manifest.json if this is an intentional pointer bump.")
    exit 1
}

$DirtyState = & git -C $SubmoduleDirectory status --porcelain
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("Unable to inspect the MonoGame submodule working tree.")
    exit 1
}
if ($DirtyState) {
    if ($AllowDirty) {
        [Console]::Error.WriteLine("WARNING: -AllowDirty enabled; building the dirty MonoGame development checkout as-is.")
    }
    else {
        [Console]::Error.WriteLine("MonoGame submodule has uncommitted changes; commit or discard them inside external/MonoGame before building.")
        exit 1
    }
}

$RemoteRef = "refs/remotes/origin/$ProtectedRef"
$null = & git -C $SubmoduleDirectory rev-parse --verify --quiet "${RemoteRef}^{commit}"
$CheckReachability = $true
if ($LASTEXITCODE -ne 0) {
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $FetchOutput = & git -C $SubmoduleDirectory fetch origin $ProtectedRef --quiet 2>&1
    $FetchExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($FetchExitCode -ne 0) {
        $FetchError = ($FetchOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        if ($FetchError -match "Could not resolve host|Could not resolve hostname|Failed to connect|Network is unreachable|Connection timed out|Operation timed out") {
            [Console]::Error.WriteLine("Warning: unable to fetch origin/$ProtectedRef while offline; skipping the protected-ref reachability check.")
            $CheckReachability = $false
        }
        else {
            [Console]::Error.WriteLine("Unable to fetch MonoGame protected ref origin/${ProtectedRef}: $FetchError. Check the origin remote and monogame.protectedRef in docs/toolchain-manifest.json.")
            exit 1
        }
    }
}

if ($CheckReachability) {
    $null = & git -C $SubmoduleDirectory rev-parse --verify --quiet "${RemoteRef}^{commit}"
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("MonoGame protected ref origin/$ProtectedRef is unavailable after fetch. Check the origin remote and monogame.protectedRef in docs/toolchain-manifest.json.")
        exit 1
    }

    $null = & git -C $SubmoduleDirectory merge-base --is-ancestor $Actual "origin/$ProtectedRef"
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("MonoGame pinned commit $Actual is not reachable from protected ref origin/$ProtectedRef. Update the submodule to a commit on that ref, or update docs/toolchain-manifest.json for an intentional pin change.")
        exit 1
    }
}

[Console]::WriteLine("MonoGame submodule OK: $Actual (branch $Branch)")
exit 0
