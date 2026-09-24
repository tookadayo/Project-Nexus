$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
& (Join-Path $root 'stop-nexus.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $root 'start-nexus.ps1')
exit $LASTEXITCODE
