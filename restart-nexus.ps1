$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Write-Host '[1/4] Stop STARTING'
& (Join-Path $root 'stop-nexus.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host '[1/4] Stop READY'
. (Join-Path $root 'runtime-common.ps1')
Write-Host '[2/4] Wait STARTING'
if(-not (Wait-NexusPortsReleased @(55432,56379,3001,3002,3100) 5)){[Console]::Error.WriteLine('RESTART stopped: ports have not been released. Run NEXUS DOCTOR.cmd.');exit 1}
Write-Host '[2/4] Wait READY'
Write-Host '[3/4] Start STARTING'
& (Join-Path $root 'start-nexus.ps1')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Write-Host '[3/4] Start READY'
Write-Host '[4/4] Health confirmation STARTING'
try{$health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3;Write-Host "[4/4] Health confirmation $(if($health.discordConnected){'READY'}else{'DEGRADED'})"}catch{Write-Host '[4/4] Health confirmation PENDING (run NEXUS STATUS.cmd)'}
exit 0
