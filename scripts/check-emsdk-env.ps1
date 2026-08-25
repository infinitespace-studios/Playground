$repositoryRoot = Split-Path -Parent $PSScriptRoot
$emsdkPath = Join-Path (Split-Path -Parent $repositoryRoot) "emsdk"

function Write-EmsdkEnvironmentError {
    [Console]::Error.WriteLine("Emscripten environment is not active in this shell.")
    [Console]::Error.WriteLine("Run this exact command in your current shell before continuing:")
    [Console]::Error.WriteLine("")
    [Console]::Error.WriteLine("    source ../emsdk/emsdk_env.sh")
    [Console]::Error.WriteLine("")
    [Console]::Error.WriteLine("Note: this must be sourced, not executed, because emsdk_env.sh sets variables in the calling shell.")
}

if (-not (Test-Path -LiteralPath $emsdkPath -PathType Container)) {
    [Console]::Error.WriteLine("Emscripten SDK not found at ../emsdk (expected as a sibling of this repository).")
    [Console]::Error.WriteLine("Clone it from https://github.com/emscripten-core/emsdk into ../emsdk and install/activate the pinned version.")
    exit 1
}

$emccCommand = Get-Command emcc -ErrorAction SilentlyContinue
if (-not $env:EMSDK -or -not $emccCommand) {
    Write-EmsdkEnvironmentError
    exit 1
}

try {
    $emccOutput = @(& $emccCommand.Source --version 2>$null)
    if ($LASTEXITCODE -ne 0) {
        Write-EmsdkEnvironmentError
        exit 1
    }
}
catch {
    Write-EmsdkEnvironmentError
    exit 1
}

$emccVersion = if ($emccOutput.Count -gt 0) { $emccOutput[0] } else { "" }
Write-Output "emsdk environment OK: EMSDK=$env:EMSDK, emcc=$emccVersion"
exit 0
