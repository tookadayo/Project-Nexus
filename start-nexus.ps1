$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$manifest = $null
$script:StartStage='Preflight'
$script:StartPort=0
$script:StartLog='.local\runtime\nexus.err.log'
$startedAt=Get-Date
Write-Host 'NEXUS START'
try {
    Write-Host "`n[1/5] Preflight STARTING"
    foreach ($name in @('.env','package.json','node_modules')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:NexusRoot $name))) { throw "$name is missing from $script:NexusRoot" }
    }
    foreach ($command in @('node','corepack')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is unavailable on PATH." }
    }
    $version = [version]((& node --version).Trim().TrimStart('v'))
    if ($version.Major -ne 24) { throw "Node.js 24.x is required; found $version." }
    Write-Host '      READY Node.js 24 / environment'
    $transport = if (@(Get-Content -LiteralPath (Join-Path $script:NexusRoot '.env') | Where-Object { $_ -match '^NEXUS_INTERACTION_TRANSPORT=webhook\s*$' }).Count -gt 0) { 'webhook' } else { 'gateway' }
    $existing = Read-NexusManifest
    $ports = if ($transport -eq 'webhook') { @(55432,56379,3001,3002,3100) } else { @(55432,56379,3001,3100) }
    foreach($port in $ports){
        $info=Get-NexusPortDiagnostic $port $existing
        if($info.Ownership -eq 'External or ambiguous' -or $info.Ownership -eq 'Unverified'){$script:StartPort=$port;throw "Port $port is not verified as NEXUS-owned. Run NEXUS DOCTOR.cmd."}
    }
    if ($null -ne $existing) {
        $alive = @('infra','nexus','web') | Where-Object { Test-NexusOwner (Get-NexusRoleEntry $existing $_) $_ }
        if ($alive.Count -eq 3 -and @($ports | Where-Object { (Get-NexusPortOwner $_) -eq 0 }).Count -eq 0) {
            Write-Host 'NEXUS READY (already running). Dashboard: http://localhost:3100'
            exit 0
        }
        Stop-NexusManaged $existing
        Remove-Item -LiteralPath $script:RuntimeManifest -Force
    }
    Stop-NexusOrphans
    Start-Sleep -Milliseconds 800
    $requiredPorts = if ($transport -eq 'webhook') { @(55432,56379,3001,3002,3100) } else { @(55432,56379,3001,3100) }
    foreach ($port in $requiredPorts) {
        if ((Get-NexusPortOwner $port) -ne 0) { $script:StartPort=$port; throw "Port $port is occupied. Nothing was started." }
    }
    Write-Host '      [OK] Required ports available'
    $manifest = @{projectRoot=$script:NexusRoot;startedAt=(Get-Date).ToUniversalTime().ToString('o');processes=@{};infraPid=$null;nexusPid=$null;webPid=$null;ngrokPid=$null}
    function Start-NexusRole([string]$Role, [int[]]$Ports) {
        $script:StartStage=$Role
        $script:StartLog=".local\runtime\$Role.err.log"
        $args = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $script:NexusRoot 'runtime-child.ps1') + '"'),'-Role',$Role,'-Root',('"' + $script:NexusRoot + '"'))
        $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $script:NexusRoot -ArgumentList $args -PassThru -RedirectStandardOutput (Join-Path $script:RuntimeDirectory "$Role.out.log") -RedirectStandardError (Join-Path $script:RuntimeDirectory "$Role.err.log")
        $info = Get-NexusProcess $process.Id
        if ($null -eq $info) { throw "$Role exited immediately." }
        $manifest.processes[$Role] = @{pid=$process.Id;createdAt=(Get-NexusStamp $info)}
        $manifest["${Role}Pid"] = $process.Id
        Write-NexusManifest $manifest
        foreach ($port in $Ports) {
            $script:StartPort=$port
            $deadline = (Get-Date).AddSeconds(120)
            while ((Get-Date) -lt $deadline) {
                if (-not (Test-NexusOwner $manifest.processes[$Role] $Role)) { throw "$Role exited before port $port opened. Check .local\runtime\$Role.err.log" }
                $owner = Get-NexusPortOwner $port
                if ($owner -ne 0) {
                    $descendants = @(Get-NexusDescendants $process.Id)
                    if ($owner -eq $process.Id -or $descendants -contains $owner) { break }
                    throw "Port $port was claimed by an unrelated process."
                }
                Start-Sleep -Milliseconds 500
            }
            if ((Get-NexusPortOwner $port) -eq 0) { throw "$Role did not open port $port. Check .local\runtime\$Role.err.log" }
        }
    }
    New-Item -ItemType Directory -Path $script:RuntimeDirectory -Force | Out-Null
    Write-Host "`n[2/5] Database STARTING"
    Start-NexusRole 'infra' @(55432,56379)
    Write-Host '      READY PostgreSQL :55432'
    Write-Host "`n[3/5] Cache READY Redis :56379"
    Write-Host "`n[4/5] NEXUS API + Discord STARTING"
    Start-NexusRole 'nexus' $(if ($transport -eq 'webhook') { @(3001,3002) } else { @(3001) })
    Write-Host '      READY API :3001'
    Write-Host "      READY Discord interaction transport: $transport"
    Write-Host "`n[5/5] Web STARTING"
    Start-NexusRole 'web' @(3100)
    Write-Host '      READY Dashboard :3100'
    $discord='PENDING';try{$health=Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 3;if($health.discordConnected){$discord='READY'}else{$discord='DEGRADED'}}catch{$discord='PENDING'}
    $elapsed=[Math]::Round(((Get-Date)-$startedAt).TotalSeconds,1)
    Write-Host "`nNEXUS READY | Discord $discord | Dashboard http://localhost:3100 | Elapsed ${elapsed}s"
    exit 0
} catch {
    [Console]::Error.WriteLine("FAILED [$script:StartStage] $($_.Exception.Message)")
    if($script:StartPort -gt 0){$info=Get-NexusPortDiagnostic $script:StartPort $manifest;[Console]::Error.WriteLine("Port: $script:StartPort  PID: $($info.Pid)  Process: $($info.Name)  Ownership: $($info.Ownership)")}
    [Console]::Error.WriteLine('Recommended: NEXUS DOCTOR.cmd')
    [Console]::Error.WriteLine("Log: $(Join-Path $script:NexusRoot $script:StartLog)")
    if ($null -ne $manifest) { Stop-NexusManaged $manifest }
    Stop-NexusOrphans
    if ($null -ne $manifest -and (Test-Path -LiteralPath $script:RuntimeManifest)) { Remove-Item -LiteralPath $script:RuntimeManifest -Force }
    exit 1
}
