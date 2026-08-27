[CmdletBinding()]
param(
    [switch]$Verify,
    [string]$Manifest,
    [string]$ReferencesDir
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$arguments = @((Join-Path $repoRoot "scripts/collect-compiler-references.py"))
if (-not $Verify -and ($Manifest -or $ReferencesDir)) {
    [Console]::Error.WriteLine(
        "-Manifest and -ReferencesDir overrides are only valid with -Verify."
    )
    exit 1
}
if ($Verify) {
    $arguments += "--verify"
}
if ($Manifest) {
    $arguments += @("--manifest", $Manifest)
}
if ($ReferencesDir) {
    $arguments += @("--references-dir", $ReferencesDir)
}

function Find-Python3 {
    $candidates = @(
        @{ Name = "python3"; Prefix = @() },
        @{ Name = "py"; Prefix = @("-3") },
        @{ Name = "python"; Prefix = @() }
    )
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate.Name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $command) {
            continue
        }
        try {
            $probeArguments = @($candidate.Prefix) + @("--version")
            $version = & $command.Source @probeArguments 2>&1
            if ($LASTEXITCODE -eq 0 -and "$version" -match "^Python 3(\.|$)") {
                return @{
                    Path = $command.Source
                    Prefix = $candidate.Prefix
                }
            }
        }
        catch {
            continue
        }
    }
    return $null
}

$python = Find-Python3
if (-not $python) {
    [Console]::Error.WriteLine(
        "Python 3 is required. Install it as python3, the py -3 launcher, or python."
    )
    exit 1
}

$pythonPath = $python.Path
$pythonArguments = @($python.Prefix) + $arguments
& $pythonPath @pythonArguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
