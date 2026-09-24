$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
Write-Host 'NEXUS Status'
$manifest=Read-NexusManifest
foreach($item in @(@('Database',55432),@('Redis',56379),@('API',3001),@('Web',3100))) {
    $owner=Get-NexusPortOwner ([int]$item[1])
    $state=if($owner -eq 0) { 'Stopped' } elseif($null -eq (Get-NexusProcess $owner)) { 'Port reserved by stale PID' } else { 'Running' }
    Write-Host ('{0,-14}{1}' -f $item[0],$state)
}
$discord='Unavailable';$recent='Unknown';$scope='Unknown'
try { $health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3;$discord=if($health.discordConnected) { 'Connected' } else { 'Disconnected' };if($health.recentEventAt) { $recent=$health.recentEventAt };$scope=switch($health.analysisScope){'all'{'Server-wide'}'include'{'Selected channels'}'exclude'{'Server-wide with exclusions'}default{'Unknown'}} } catch {}
Write-Host ('{0,-14}{1}' -f 'Discord',$discord)
Write-Host "Dashboard     http://localhost:3100"
Write-Host "Analysis scope $scope"
Write-Host "Recent signal $recent"
if($null -ne $manifest) { foreach($role in @('infra','nexus','web')) { if(-not (Test-NexusOwner (Get-NexusRoleEntry $manifest $role) $role)) { Write-Warning "$role process is absent or does not match its recorded identity." } } }
