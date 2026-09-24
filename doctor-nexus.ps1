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
if($Repair) { if($running.Count -gt 0) { Write-Warning 'Stop NEXUS before repairing orphan processes.';exit 1 };Stop-NexusOrphans;Write-Host 'Verified NEXUS processes were stopped. Ambiguous processes were left alone.' }
elseif($running.Count -lt 3 -and $orphans.Count -gt 0) { Write-Host 'Run NEXUS DOCTOR.cmd -Repair after stopping NEXUS to recover verified orphan processes.' }
