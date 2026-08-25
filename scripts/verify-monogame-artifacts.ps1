[CmdletBinding()]
param(
    [string]$ArtifactsDirectory
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrEmpty($ArtifactsDirectory)) {
    $ArtifactsDirectory = Join-Path $RepoRoot "artifacts/monogame"
}
elseif (-not [System.IO.Path]::IsPathRooted($ArtifactsDirectory)) {
    $ArtifactsDirectory = Join-Path $RepoRoot $ArtifactsDirectory
}

$InventoryPath = Join-Path $RepoRoot "docs/monogame-artifacts.json"
$ToolchainPath = Join-Path $RepoRoot "docs/toolchain-manifest.json"

function Stop-Verification([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 1
}

function Read-JsonFile([string]$Path, [string]$Description) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    }
    catch {
        Stop-Verification "Unable to read $Description ${Path}: $($_.Exception.Message)"
    }
}

function Get-ArtifactPath([string]$RelativePath) {
    $NativeRelativePath = $RelativePath.Replace(
        [System.IO.Path]::AltDirectorySeparatorChar,
        [System.IO.Path]::DirectorySeparatorChar
    )
    return Join-Path $ArtifactsDirectory $NativeRelativePath
}

$Inventory = Read-JsonFile $InventoryPath "artifact inventory"
$Toolchain = Read-JsonFile $ToolchainPath "toolchain manifest"

if ($Inventory.schemaVersion -ne 1) {
    Stop-Verification "Unsupported MonoGame artifact inventory schemaVersion; expected 1."
}

$CommitSha = [string]$Inventory.monogameCommitSha
if ($CommitSha -cnotmatch "^[0-9a-f]{40}$") {
    Stop-Verification "Artifact inventory monogameCommitSha must be a lowercase 40-character SHA."
}

$ToolchainSha = [string]$Toolchain.monogame.commitSha
if ($CommitSha -cne $ToolchainSha) {
    Stop-Verification "MonoGame commit SHA mismatch: artifact inventory has '$CommitSha', toolchain manifest has '$ToolchainSha'."
}

$BuildConfiguration = [string]$Inventory.buildConfiguration
if ([string]::IsNullOrEmpty($BuildConfiguration)) {
    Stop-Verification "Artifact inventory buildConfiguration must be a non-empty string."
}

$ProvenanceFile = [string]$Inventory.provenanceFile
if ([string]::IsNullOrEmpty($ProvenanceFile)) {
    Stop-Verification "Artifact inventory provenanceFile must be a non-empty string."
}

$RequiredFiles = @($Inventory.requiredFiles)
if ($RequiredFiles.Count -eq 0) {
    Stop-Verification "Artifact inventory requiredFiles must be a non-empty array."
}

$SortedRequiredFiles = [string[]]@($RequiredFiles)
[Array]::Sort($SortedRequiredFiles, [System.StringComparer]::Ordinal)
if ((Compare-Object $RequiredFiles $SortedRequiredFiles -SyncWindow 0).Count -ne 0) {
    Stop-Verification "Artifact inventory requiredFiles must be sorted."
}

$SeenRequiredFiles = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not $SeenRequiredFiles.Add($RelativePath)) {
        Stop-Verification "Artifact inventory requiredFiles must not contain duplicates."
    }
    if (
        [string]::IsNullOrEmpty($RelativePath) -or
        [System.IO.Path]::IsPathRooted($RelativePath) -or
        $RelativePath.Contains("\") -or
        $RelativePath -match '(^|/)\.\.?(/|$)|//'
    ) {
        Stop-Verification "Artifact inventory contains an unsafe relative path: '$RelativePath'."
    }
}

if ($ProvenanceFile -cnotin $RequiredFiles) {
    Stop-Verification "Artifact inventory provenanceFile must also appear in requiredFiles."
}

$Missing = @(
    foreach ($RelativePath in $RequiredFiles) {
        if (-not (Test-Path -LiteralPath (Get-ArtifactPath $RelativePath) -PathType Leaf)) {
            $RelativePath
        }
    }
)

$ProvenancePath = Get-ArtifactPath $ProvenanceFile
$Provenance = $null
if (Test-Path -LiteralPath $ProvenancePath -PathType Leaf) {
    $Provenance = Read-JsonFile $ProvenancePath "artifact provenance"
    $ProvenanceSha = [string]$Provenance.commitSha
    if ($CommitSha -cne $ProvenanceSha) {
        Stop-Verification "MonoGame commit SHA mismatch: artifact inventory has '$CommitSha', artifact provenance has '$ProvenanceSha'."
    }

    if (
        $Provenance.preBuildStatus -isnot [string] -or
        $Provenance.preBuildStatusSha256 -isnot [string]
    ) {
        Stop-Verification "Artifact provenance must contain preBuildStatus and preBuildStatusSha256 strings."
    }
    $StatusBytes = [System.Text.Encoding]::UTF8.GetBytes($Provenance.preBuildStatus)
    $ActualStatusHash = [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($StatusBytes)
    ).ToLowerInvariant()
    if ($ActualStatusHash -cne $Provenance.preBuildStatusSha256) {
        Stop-Verification "Artifact provenance preBuildStatusSha256 mismatch: recorded '$($Provenance.preBuildStatusSha256)', computed '$ActualStatusHash'."
    }
}

if ($Missing.Count -gt 0) {
    [Console]::Error.WriteLine("Missing required MonoGame artifacts:")
    foreach ($RelativePath in $Missing) {
        [Console]::Error.WriteLine(" - $RelativePath")
    }
    exit 1
}

$FileEntries = @(
    foreach ($RelativePath in $RequiredFiles) {
        $Digest = (Get-FileHash -LiteralPath (Get-ArtifactPath $RelativePath) -Algorithm SHA256).Hash.ToLowerInvariant()
        [ordered]@{
            path = $RelativePath
            sha256 = $Digest
        }
    }
)

$Output = [ordered]@{
    schemaVersion = 1
    inventorySchemaVersion = [int]$Inventory.schemaVersion
    monogameCommitSha = $CommitSha
    buildConfiguration = $BuildConfiguration
    provenance = [ordered]@{
        file = $ProvenanceFile
        dotnetSdkVersion = $Provenance.dotnetSdkVersion
        allowDirty = $Provenance.allowDirty
        preBuildStatusSha256 = $Provenance.preBuildStatusSha256
    }
    files = $FileEntries
}

$OutputPath = Join-Path $ArtifactsDirectory "artifact-hashes.json"
$Output |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $OutputPath -Encoding utf8

Write-Output "All $($FileEntries.Count) required MonoGame artifacts are present; hashes written to $OutputPath"
