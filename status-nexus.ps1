$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$release=Get-NexusRelease
$manifest=Read-NexusManifest
Write-Host 'NEXUS STATUS'
Write-Host "`nRELEASE"
Write-Host "Version $($release.Version)  Build $($release.Build)  Channel $($release.Channel)"
Write-Host "`nRUNTIME"
$roles=@('infra','nexus','web')
$running=@($roles|Where-Object {Test-NexusOwner (Get-NexusRoleEntry $manifest $_) $_})
Write-Host "Managed roles $($running.Count)/3"
foreach($role in $roles){$entry=Get-NexusRoleEntry $manifest $role;Write-Host ('{0,-14}{1}' -f $role,$(if($running -contains $role){"PID $($entry.pid) verified"}elseif($entry){"PID $($entry.pid) stale"}else{'Stopped'}))}
Write-Host "`nSERVICES"
$ports=@(@('PostgreSQL',55432),@('Redis',56379),@('API',3001),@('Web',3100))
$unsafe=0
foreach($service in $ports){$info=Get-NexusPortDiagnostic ([int]$service[1]) $manifest;Write-Host ('{0,-14}:{1,-6} {2,-16} PID {3,-7} {4}' -f $service[0],$service[1],$info.State,$info.Pid,$info.Ownership);if($info.State -eq 'Ghost listener' -or $info.Ownership -eq 'External or ambiguous'){$unsafe++}}
$health=$null
try{$health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3}catch{}
$community=$null
if($health -and $health.PSObject.Properties['community']){$community=$health.community}
Write-Host "`nDISCORD"
Write-Host "Gateway          $(if($health -and $health.discordConnected){'Connected'}else{'Unavailable'})"
Write-Host "Commands         $(if($health -and $health.commands.registered){'Registered'}else{'Pending / unavailable'})"
Write-Host "Transport        $($health.interaction.transport)"
Write-Host "Handler          $(if($health -and $health.interaction.handlerRegistered){'Registered'}else{'Unavailable'})"
Write-Host "Last received    $($health.interaction.lastReceivedAt)"
Write-Host "Last ACK         $($health.interaction.lastAcknowledgedAt)"
Write-Host "Last completion  $($health.interaction.lastCompletedAt)"
Write-Host "Last result      $($health.interaction.lastResult)"
Write-Host "Command hash     $(if($health.commands.registeredHash){$health.commands.registeredHash.Substring(0,[Math]::Min(12,$health.commands.registeredHash.Length))}else{'Unavailable'})"
Write-Host "`nCOMMUNITY"
Write-Host "Analysis scope   $($health.analysisScope)"
Write-Host "Setup progress   $(if($community -and $community.setupSteps){@($community.setupSteps.PSObject.Properties|Where-Object {$_.Value}).Count.ToString()+'/4'}else{'Unknown'})"
Write-Host "Timezone         $(if($community){$community.timezone}else{'Unknown'})"
Write-Host "Panel channel    $(if($community -and $community.panelChannelId){$community.panelChannelId}else{'Not configured'})"
Write-Host "`nWEB"
Write-Host 'Dashboard        http://localhost:3100'
$webState=Get-NexusWebReachability
Write-Host "Reachability     $webState"
$envPath=Join-Path $script:NexusRoot '.env'
$oauth=$false
if(Test-Path -LiteralPath $envPath){$lines=@(Get-Content -LiteralPath $envPath);$oauth=@('DISCORD_APPLICATION_ID','DISCORD_CLIENT_SECRET','NEXUS_SESSION_SECRET','NEXUS_WEB_URL'|Where-Object {$key=$_;@($lines|Where-Object {$_ -match "^$key=.+$"}).Count -eq 0}).Count -eq 0}
Write-Host "OAuth            $(if($oauth){'Configured'}else{'Not configured'})"
Write-Host "`nHEALTH"
$overall=if($unsafe -gt 0){'ACTION REQUIRED'}elseif($running.Count -eq 3 -and $health -and $health.discordConnected -and $health.commands.registered -and $webState -ne 'Unavailable'){'HEALTHY'}else{'DEGRADED'}
Write-Host "Overall          $overall"
if($overall -ne 'HEALTHY'){Write-Host 'Recommended      NEXUS DOCTOR.cmd'}
