$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
Write-Host 'NEXUS Status'
$manifest=Read-NexusManifest
foreach($item in @(@('Database',55432),@('Redis',56379),@('API',3001),@('Web',3100))) {
    $owner=Get-NexusPortOwner ([int]$item[1])
    $state=if($owner -eq 0) { 'Stopped' } elseif($null -eq (Get-NexusProcess $owner)) { 'Port reserved by stale PID' } else { 'Running' }
    Write-Host ('{0,-14}{1}' -f $item[0],$state)
}
$discord='Unavailable';$recent='Unknown';$scope='Unknown';$health=$null
try { $health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3;$discord=if($health.discordConnected) { 'Connected' } else { 'Disconnected' };if($health.recentEventAt) { $recent=$health.recentEventAt };$scope=switch($health.analysisScope){'all'{'Server-wide'}'include'{'Selected channels'}'exclude'{'Server-wide with exclusions'}default{'Unknown'}} } catch {}
Write-Host ('{0,-22}{1}' -f 'Bot connection',$discord)
if($health) {
    $commands=if($health.commands.registered){'Registered'}else{'Not confirmed'}
    Write-Host ('{0,-22}{1}' -f 'Commands',$commands)
    Write-Host ('{0,-22}{1}' -f 'Interaction mode',$health.interaction.transport)
    Write-Host ('{0,-22}{1}' -f 'Handler',$(if($health.interaction.handlerRegistered){'Registered'}else{'Not registered'}))
    Write-Host ('{0,-22}{1}' -f 'Last command received',$(if($health.interaction.lastReceivedAt){$health.interaction.lastReceivedAt}elseif($health.lastInteraction){$health.lastInteraction.receivedAt}else{'None observed'}))
    Write-Host ('{0,-22}{1}' -f 'Last ACK',$(if($health.interaction.lastAcknowledgedAt){$health.interaction.lastAcknowledgedAt}elseif($health.lastInteraction){$health.lastInteraction.acknowledgedAt}else{'None observed'}))
    Write-Host ('{0,-22}{1}' -f 'Last reply completed',$(if($health.interaction.lastCompletedAt){$health.interaction.lastCompletedAt}elseif($health.lastInteraction){$health.lastInteraction.completedAt}else{'None observed'}))
    Write-Host ('{0,-22}{1}' -f 'Last reply',$(if($health.interaction.lastResult){$health.interaction.lastResult}elseif($health.lastInteraction){$health.lastInteraction.result}else{'None observed'}))
    Write-Host ('{0,-22}{1}' -f 'Command hash',$(if($health.commands.registeredHash){$health.commands.registeredHash.Substring(0,[Math]::Min(12,$health.commands.registeredHash.Length))}else{'Unavailable'}))
    if($health.interaction.transport -eq 'gateway') { Write-Host 'Gateway mode requires an empty Interactions Endpoint URL in the Discord Developer Portal.' }
}
Write-Host "Dashboard     http://localhost:3100"
Write-Host "Analysis scope $scope"
Write-Host "Recent signal $recent"
if($null -ne $manifest) { foreach($role in @('infra','nexus','web')) { if(-not (Test-NexusOwner (Get-NexusRoleEntry $manifest $role) $role)) { Write-Warning "$role process is absent or does not match its recorded identity." } } }
