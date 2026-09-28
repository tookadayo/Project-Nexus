param([switch]$Repair)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$release=Get-NexusRelease
$warnings=New-Object System.Collections.Generic.List[string]
Write-Host 'NEXUS DOCTOR'
Write-Host "`nRELEASE"
Write-Host "Version $($release.Version)  Build $($release.Build)  Channel $($release.Channel)"
Write-Host "`nENVIRONMENT"
foreach($tool in @('node','corepack')) {
    $found=Get-Command $tool -ErrorAction SilentlyContinue
    Write-Host ('{0,-16}{1}' -f $tool,$(if($found){'Available'}else{'Missing'}))
    if(-not $found){$warnings.Add("$tool is missing")}
}
if(Get-Command node -ErrorAction SilentlyContinue){$nodeVersion=(& node --version).Trim();Write-Host "Node version    $nodeVersion";if($nodeVersion -notmatch '^v24\.'){$warnings.Add('Node.js 24 is required')}}
$envPath=Join-Path $script:NexusRoot '.env'
$envLines=if(Test-Path -LiteralPath $envPath){@(Get-Content -LiteralPath $envPath)}else{@()}
foreach($key in @('DISCORD_TOKEN','DISCORD_APPLICATION_ID','DISCORD_GUILD_ID','DATABASE_URL','REDIS_URL','IDENTITY_KEY','LOOKUP_KEY','COMPONENT_KEY','API_KEY')) {
    $present=@($envLines|Where-Object { $_ -match "^$key=.+$" }).Count -gt 0
    Write-Host ('{0,-25}{1}' -f $key,$(if($present){'Present'}else{'Missing'}))
    if(-not $present){$warnings.Add("$key is missing")}
}
Write-Host ('{0,-16}{1}' -f 'Runtime dir',$(if(Test-Path -LiteralPath $script:RuntimeDirectory){'Present'}else{'Missing (created by START/Repair)'}))
if(-not (Test-Path -LiteralPath (Join-Path $script:NexusRoot '.local\redis\Redis-8.10.2-Windows-x64-cygwin\redis-server.exe'))){$warnings.Add('NEXUS Redis binary is missing. Run NEXUS SETUP.cmd')}
$manifest=Read-NexusManifest
$roles=@('infra','nexus','web')
$running=@($roles|Where-Object { Test-NexusOwner (Get-NexusRoleEntry $manifest $_) $_ })
$stale=@($roles|Where-Object { (Get-NexusRoleEntry $manifest $_) -and -not (Test-NexusOwner (Get-NexusRoleEntry $manifest $_) $_) })
Write-Host "`nRUNTIME"
Write-Host "Manifest        $(if($manifest){'Present'}else{'Absent'})"
Write-Host "Managed roles   $($running.Count)/3"
foreach($role in $roles){$entry=Get-NexusRoleEntry $manifest $role;Write-Host ('{0,-16}{1}' -f $role,$(if($running -contains $role){"Verified PID $($entry.pid)"}elseif($entry){"Stale PID $($entry.pid)"}else{'Stopped'}))}
$orphans=@(Get-NexusUnmanagedOrphans $manifest)
Write-Host "Verified orphans $($orphans.Count)"
if($stale.Count -gt 0){$warnings.Add("$($stale.Count) stale managed role entries")}
if($orphans.Count -gt 0){$warnings.Add("$($orphans.Count) verified orphan processes")}
Write-Host "`nSERVICES / PORTS"
$ports=@(55432,56379,3001,3100)
if(@($envLines|Where-Object { $_ -match '^NEXUS_INTERACTION_TRANSPORT=webhook\s*$' }).Count){$ports+=3002}
$unsafe=@()
foreach($port in $ports){
    $info=Get-NexusPortDiagnostic $port $manifest
    Write-Host ('Port {0,-6} {1,-16} PID {2,-7} {3}  {4}' -f $port,$info.State,$info.Pid,$info.Name,$info.Ownership)
    if($info.Path){Write-Host "  Path: $($info.Path)"}
    if($info.CreatedAt){Write-Host "  Created: $($info.CreatedAt)"}
    if($info.Ownership -eq 'External or ambiguous' -or $info.Ownership -eq 'Unverified'){$unsafe+= $info}
    if($info.State -eq 'Ghost listener'){$warnings.Add("Port $port has a ghost listener: PID $($info.Pid) is not resolvable. Wait, rerun Doctor, then restart Windows if it persists. No process will be terminated automatically.")}
}
Write-Host "`nDISCORD / WEB"
try {
    $health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3
    Write-Host "Gateway         $(if($health.discordConnected){'Connected'}else{'Disconnected'})"
    Write-Host "Transport       $($health.interaction.transport)"
    Write-Host "Handler         $(if($health.interaction.handlerRegistered){'Registered'}else{'Unavailable'})"
    Write-Host "Commands        $(if($health.commands.registered){'Registered'}else{'Pending'})"
    Write-Host "Last interaction $($health.interaction.lastReceivedAt)"
    Write-Host "Last ACK         $($health.interaction.lastAcknowledgedAt)"
    Write-Host "Last completion  $($health.interaction.lastCompletedAt)"
    Write-Host "Last result     $($health.interaction.lastResult)"
    if(-not $health.commands.registered){
        $warnings.Add('Command registration pending. Check nexus.err.log for Discord HTTP status and retry details.')
        $lastCommandFailure=$null
        $log=Join-Path $script:RuntimeDirectory 'nexus.err.log'
        if(Test-Path -LiteralPath $log){foreach($line in @(Get-Content -LiteralPath $log -Tail 100)){try{$event=$line|ConvertFrom-Json;if($event.action -eq 'command_registration'){$lastCommandFailure=$event}}catch{}}}
        if($lastCommandFailure){Write-Host "Registration reason $($lastCommandFailure.class) HTTP $($lastCommandFailure.httpStatus) Retry $($lastCommandFailure.retryAfter)s"}
    }
} catch {Write-Host 'API / Gateway   Unavailable';$warnings.Add('API is not reachable')}
$webState=Get-NexusWebReachability
Write-Host "Dashboard       $webState"
if($webState -eq 'Unavailable'){$warnings.Add('Web dashboard is not reachable')}
$oauth=@('DISCORD_APPLICATION_ID','DISCORD_CLIENT_SECRET','NEXUS_SESSION_SECRET','NEXUS_WEB_URL'|Where-Object {$key=$_;@($envLines|Where-Object {$_ -match "^$key=.+$"}).Count -eq 0}).Count -eq 0
Write-Host "OAuth           $(if($oauth){'Configured'}else{'Not configured'})"
Write-Host "`nHEALTH"
foreach($warning in $warnings){Write-Warning $warning}
$overall=if($unsafe.Count -gt 0){'ACTION REQUIRED'}elseif($warnings.Count -gt 0 -or $running.Count -lt 3){'DEGRADED'}else{'HEALTHY'}
Write-Host "Overall         $overall"
if($stale.Count -gt 0 -or $orphans.Count -gt 0 -or $running.Count -lt 3){Write-Host 'Recommended     NEXUS DOCTOR.cmd -Repair'}
if(-not $Repair){return}
Write-Host "`nREPAIR"
if($unsafe.Count -gt 0 -and @($unsafe|Where-Object {$_.State -ne 'Ghost listener'}).Count -eq 0){
    Write-Host 'Waiting up to 5 seconds for ghost listeners to release.'
    $null=Wait-NexusPortsReleased @($unsafe|ForEach-Object {$_.Port}) 5
    $unsafe=@($unsafe|ForEach-Object {Get-NexusPortDiagnostic $_.Port $manifest}|Where-Object {$_.Ownership -eq 'Unverified' -or $_.Ownership -eq 'External or ambiguous'})
}
if($unsafe.Count -gt 0){Write-Warning 'Repair refused: a listener is external, ambiguous, or has an unresolved PID. No process was terminated.';exit 1}
if($manifest -and [string]$manifest.projectRoot -ne $script:NexusRoot){Write-Warning 'Repair refused: manifest root does not match this project.';exit 1}
if($running.Count -eq 3 -and $stale.Count -eq 0 -and $orphans.Count -eq 0 -and @($ports|Where-Object {(Get-NexusPortOwner $_) -eq 0}).Count -eq 0){Write-Host 'Managed runtime is already healthy.';exit 0}
if($manifest){Stop-NexusManaged $manifest}
Stop-NexusOrphans
if(-not (Wait-NexusPortsReleased $ports 5)){Write-Warning 'Ports did not release within 5 seconds. Manifest was retained for diagnosis.';exit 1}
if($manifest -and (Test-Path -LiteralPath $script:RuntimeManifest)){Remove-Item -LiteralPath $script:RuntimeManifest -Force}
New-Item -ItemType Directory -Path $script:RuntimeDirectory -Force|Out-Null
Write-Host 'Verified runtime state was cleaned. Starting missing roles.'
& (Join-Path $script:NexusRoot 'start-nexus.ps1')
exit $LASTEXITCODE
