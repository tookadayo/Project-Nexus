param([switch]$Repair)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
Write-Host 'NEXUS Doctor'
foreach($tool in @('node','corepack')) { Write-Host ('{0,-14}{1}' -f $tool, $(if(Get-Command $tool -ErrorAction SilentlyContinue){'Available'}else{'Missing'})) }
if(Get-Command node -ErrorAction SilentlyContinue) { $version=(& node --version).Trim();Write-Host "Node version  $version";if($version -notmatch '^v24\.') { Write-Warning 'Node.js 24 is required.' } }
$envPath=Join-Path $script:NexusRoot '.env';if(-not (Test-Path -LiteralPath $envPath)) { Write-Warning '.env is missing. Run NEXUS SETUP.cmd.' } else {
    $content=Get-Content -LiteralPath $envPath
    foreach($key in @('DISCORD_TOKEN','DISCORD_APPLICATION_ID','DISCORD_GUILD_ID','DATABASE_URL','REDIS_URL')) { if(-not ($content | Where-Object { $_ -match "^$key=.+$" })) { Write-Warning "$key is missing." } }
}
if(-not (Test-Path -LiteralPath (Join-Path $script:NexusRoot '.local\redis\Redis-8.10.2-Windows-x64-cygwin\redis-server.exe'))) { Write-Warning 'Local Redis binary is missing. Run NEXUS SETUP.cmd.' }
$manifest=Read-NexusManifest
$running=@(@('infra','nexus','web') | Where-Object { Test-NexusOwner (Get-NexusRoleEntry $manifest $_) $_ })
Write-Host "Managed roles: $($running.Count)/3"
$orphans=@(Get-NexusOrphanProcesses | Where-Object { $process=$_; -not @(@('infra','nexus','web') | Where-Object { $entry=Get-NexusRoleEntry $manifest $_; $null -ne $entry -and [int]$entry.pid -eq [int]$process.ProcessId }).Count })
Write-Host "Verified project processes: $($orphans.Count)"
foreach($port in @(55432,56379,3001,3002,3100)) { $owner=Get-NexusPortOwner $port;Write-Host "Port $port : $(if($owner){"PID $owner"}else{'Free'})" }
$transport='gateway';if(Test-Path -LiteralPath $envPath) { if(@(Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^NEXUS_INTERACTION_TRANSPORT=webhook\s*$' }).Count -gt 0){$transport='webhook'} }
Write-Host "[OK] Interaction mode: $transport"
if($transport -eq 'gateway') { Write-Warning 'Gateway mode requires an empty Interactions Endpoint URL in the Discord Developer Portal. This check cannot read the Portal setting.' }
try {
    $health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3
    Write-Host $(if($health.discordConnected){'[OK] Discord Gateway connected'}else{'[FAIL] Discord Gateway is not connected. Run NEXUS STATUS.cmd and check the Bot Token.'})
    Write-Host $(if($health.interaction.handlerRegistered){'[OK] Interaction handler registered'}else{'[FAIL] Interaction handler is not registered. Check NEXUS_INTERACTION_TRANSPORT.'})
    Write-Host $(if($health.commands.registered){'[OK] Slash commands registered'}else{'[WARN] Slash command registration is not confirmed. Check Bot permissions and restart NEXUS.'})
    Write-Host $(if($health.interaction.lastReceivedAt -or $health.lastInteraction){'[OK] An interaction has been received'}else{'[FAIL] No interaction has been received. Run /nexus panel in a test server.'})
    if($health.interaction.lastResult -and $health.interaction.lastResult -notin @('success','completed','acknowledged','queued')) { Write-Warning "Last interaction result: $($health.interaction.lastResult). Check the Bot connection and database." }
} catch { Write-Warning 'NEXUS API is not running. Start NEXUS, then run Doctor again for Discord and command checks.' }
if($Repair) { if($running.Count -gt 0) { Write-Warning 'Stop NEXUS before repairing orphan processes.';exit 1 };Stop-NexusOrphans;Write-Host 'Verified NEXUS processes were stopped. Ambiguous processes were left alone.' }
elseif($running.Count -lt 3 -and $orphans.Count -gt 0) { Write-Host 'Run NEXUS DOCTOR.cmd -Repair after stopping NEXUS to recover verified orphan processes.' }
