$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$manifest = $null
try {
    foreach ($name in @('.env','package.json','node_modules')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:NexusRoot $name))) { throw "$name is missing from $script:NexusRoot" }
    }
    foreach ($command in @('node','corepack','ngrok')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is unavailable on PATH." }
    }
    $version = [version]((& node --version).Trim().TrimStart('v'))
    if ($version.Major -ne 24) { throw "Node.js 24.x is required; found $version." }
    $existing = Read-NexusManifest
    if ($null -ne $existing) {
        $alive = @('infra','nexus','web','ngrok') | Where-Object { Test-NexusOwner (Get-NexusRoleEntry $existing $_) $_ }
        if ($alive.Count -eq 4 -and @(55432,56379,3001,3002,3100 | Where-Object { (Get-NexusPortOwner $_) -eq 0 }).Count -eq 0) {
            Write-Host 'NEXUS is already running.'
            exit 0
        }
        Stop-NexusManaged $existing
        Remove-Item -LiteralPath $script:RuntimeManifest -Force
    }
    foreach ($port in @(55432,56379,3001,3002,3100)) {
        if ((Get-NexusPortOwner $port) -ne 0) { throw "Port $port is occupied by an unrelated process. Nothing was started." }
    }
    $manifest = @{projectRoot=$script:NexusRoot;startedAt=(Get-Date).ToUniversalTime().ToString('o');processes=@{};infraPid=$null;nexusPid=$null;webPid=$null;ngrokPid=$null}
    function Start-NexusRole([string]$Role, [int[]]$Ports) {
        $args = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $script:NexusRoot 'runtime-child.ps1') + '"'),'-Role',$Role,'-Root',('"' + $script:NexusRoot + '"'))
        $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $script:NexusRoot -ArgumentList $args -PassThru -RedirectStandardOutput (Join-Path $script:RuntimeDirectory "$Role.out.log") -RedirectStandardError (Join-Path $script:RuntimeDirectory "$Role.err.log")
        $info = Get-NexusProcess $process.Id
        if ($null -eq $info) { throw "$Role exited immediately." }
        $manifest.processes[$Role] = @{pid=$process.Id;createdAt=(Get-NexusStamp $info)}
        $manifest["${Role}Pid"] = $process.Id
        Write-NexusManifest $manifest
        foreach ($port in $Ports) {
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
    Start-NexusRole 'infra' @(55432,56379)
    Start-NexusRole 'nexus' @(3001,3002)
    Start-NexusRole 'web' @(3100)
    Start-NexusRole 'ngrok' @()
    Start-Sleep -Milliseconds 500
    if (-not (Test-NexusOwner (Get-NexusRoleEntry $manifest 'ngrok') 'ngrok')) { throw 'ngrok exited. Check .local\runtime\ngrok.err.log' }
    Write-Host 'NEXUS is ready: Web 3100; API 3001; Interaction 3002; PostgreSQL 55432; Redis 56379.'
    exit 0
} catch {
    [Console]::Error.WriteLine("NEXUS startup failed: $($_.Exception.Message)")
    if ($null -ne $manifest) { Stop-NexusManaged $manifest }
    if ($null -ne $manifest -and (Test-Path -LiteralPath $script:RuntimeManifest)) { Remove-Item -LiteralPath $script:RuntimeManifest -Force }
    exit 1
}
