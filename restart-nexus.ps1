$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
& (Join-Path $root 'stop-nexus.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
. (Join-Path $root 'runtime-common.ps1')
if(-not (Wait-NexusPortsReleased @(55432,56379,3001,3002,3100) 5)){[Console]::Error.WriteLine('RESTART stopped: ports have not been released. Run NEXUS DOCTOR.cmd.');exit 1}
& (Join-Path $root 'start-nexus.ps1')
exit $LASTEXITCODE
