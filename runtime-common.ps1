Set-StrictMode -Version 2.0
$script:NexusRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$script:RuntimeDirectory = Join-Path $script:NexusRoot '.local\runtime'
$script:RuntimeManifest = Join-Path $script:RuntimeDirectory 'runtime.json'

function Get-NexusRelease {
    $version = [string]((Get-Content -Raw -LiteralPath (Join-Path $script:NexusRoot 'package.json') | ConvertFrom-Json).version)
    $sha = 'unknown'
    if (Get-Command git -ErrorAction SilentlyContinue) {
        try { $value = (& git -C $script:NexusRoot rev-parse --short=7 HEAD 2>$null).Trim(); if ($value -match '^[0-9a-f]{7,40}$') { $sha = $value.Substring(0,7) } } catch {}
    }
    $channel = if ($version -match '-alpha\.') { 'Alpha' } elseif ($version -match '-beta\.') { 'Beta' } elseif ($version -match '-rc\.') { 'Release candidate' } else { 'Stable' }
    return [pscustomobject]@{ Version=$version; Build=$sha; Channel=$channel }
}

function Get-NexusProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}
function Get-NexusStamp($Process) { return $Process.CreationDate.ToUniversalTime().ToString('o') }
function Test-NexusOwner($Entry, [string]$Role) {
    if ($null -eq $Entry -or $null -eq $Entry.pid -or $null -eq $Entry.createdAt) { return $false }
    $process = Get-NexusProcess ([int]$Entry.pid)
    if ($null -eq $process) { return $false }
    if ((Get-NexusStamp $process) -ne [string]$Entry.createdAt) { return $false }
    $command = [string]$process.CommandLine
    return $command.Contains('runtime-child.ps1') -and $command.Contains("-Role $Role") -and $command.Contains($script:NexusRoot)
}
function Read-NexusManifest {
    if (-not (Test-Path -LiteralPath $script:RuntimeManifest -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $script:RuntimeManifest -Raw | ConvertFrom-Json }
    catch { throw 'The runtime manifest is unreadable. Inspect .local\runtime\runtime.json before retrying.' }
}
function Get-NexusRoleEntry($Manifest, [string]$Role) {
    if ($null -eq $Manifest -or $null -eq $Manifest.processes) { return $null }
    if ($Manifest.processes -is [System.Collections.IDictionary]) { return $Manifest.processes[$Role] }
    $property = $Manifest.processes.PSObject.Properties[$Role]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Write-NexusManifest($Manifest) {
    New-Item -ItemType Directory -Path $script:RuntimeDirectory -Force | Out-Null
    $temporary = Join-Path $script:RuntimeDirectory 'runtime.tmp'
    $Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $script:RuntimeManifest -Force
}
function Get-NexusDescendants([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $rootProcess = $all | Where-Object { $_.ProcessId -eq $RootPid } | Select-Object -First 1
    if ($null -eq $rootProcess) { return @() }
    $rootCreated = $rootProcess.CreationDate
    $found = New-Object System.Collections.Generic.List[int]
    $frontier = @($RootPid)
    while ($frontier.Count -gt 0) {
        $next = @()
        foreach ($parent in $frontier) {
            foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parent -and $_.CreationDate -ge $rootCreated }) {
                if (-not $found.Contains([int]$child.ProcessId)) { $found.Add([int]$child.ProcessId); $next += [int]$child.ProcessId }
            }
        }
        $frontier = $next
    }
    return @($found.ToArray())
}
function Get-NexusPortOwner([int]$Port) {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $connection) { return 0 }
    return [int]$connection.OwningProcess
}
function Get-NexusPortDiagnostic([int]$Port, $Manifest) {
    $owner = Get-NexusPortOwner $Port
    if ($owner -eq 0) { return [pscustomobject]@{Port=$Port;Pid=0;State='Free';Name='';Path='';CreatedAt='';Ownership='None'} }
    $process = Get-NexusProcess $owner
    if ($null -eq $process) { return [pscustomobject]@{Port=$Port;Pid=$owner;State='Ghost listener';Name='Unavailable';Path='Unavailable';CreatedAt='Unavailable';Ownership='Unverified'} }
    $verified = $false
    foreach ($role in @('infra','nexus','web')) {
        $entry = Get-NexusRoleEntry $Manifest $role
        if (Test-NexusOwner $entry $role) {
            $childOwned=@(Get-NexusDescendants ([int]$entry.pid)) -contains $owner -and ([string]$process.Name -match '^(node|node.exe|postgres.exe|redis-server.exe|powershell.exe|cmd.exe)$') -and (Test-NexusRootText ([string]$process.CommandLine))
            if ([int]$entry.pid -eq $owner -or $childOwned) { $verified = $true; break }
        }
    }
    if (-not $verified) { $verified = @((Get-NexusOrphanProcesses) | Where-Object { $_.ProcessId -eq $owner }).Count -gt 0 }
    return [pscustomobject]@{Port=$Port;Pid=$owner;State='Listening';Name=[string]$process.Name;Path=[string]$process.ExecutablePath;CreatedAt=[string]$process.CreationDate;Ownership=$(if($verified){'Verified NEXUS'}else{'External or ambiguous'})}
}
function Wait-NexusPortsReleased([int[]]$Ports, [int]$Seconds=5) {
    $deadline=(Get-Date).AddSeconds($Seconds)
    do {
        $occupied=@($Ports | Where-Object { (Get-NexusPortOwner $_) -ne 0 })
        if($occupied.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 250
    } while((Get-Date) -lt $deadline)
    return $false
}
function Get-NexusWebReachability {
    try { $null=Invoke-WebRequest 'http://127.0.0.1:3100' -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 3; return 'Reachable' }
    catch {
        $response=$_.Exception.Response
        if($response -and [int]$response.StatusCode -in @(301,302,303,307,308,401,403)){return 'Authentication required'}
        return 'Unavailable'
    }
}
function Test-NexusRootText([string]$Value) {
    if ([string]::IsNullOrEmpty($Value)) { return $false }
    $normalized=$Value.Replace('/','\')
    $offset=0
    while($offset -lt $normalized.Length){
        $index=$normalized.IndexOf($script:NexusRoot,$offset,[System.StringComparison]::OrdinalIgnoreCase)
        if($index -lt 0){return $false}
        $end=$index+$script:NexusRoot.Length
        if($end -eq $normalized.Length -or $normalized[$end] -in @('\','"',' ',';')){return $true}
        $offset=$end
    }
    return $false
}
function Get-NexusDedicatedPostgresPid {
    $file = Join-Path $script:NexusRoot '.local\pg\postmaster.pid'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return 0 }
    $lines = @(Get-Content -LiteralPath $file -TotalCount 4 -ErrorAction SilentlyContinue)
    if ($lines.Count -lt 4) { return 0 }
    $data = [System.IO.Path]::GetFullPath($lines[1].Replace('/','\')).TrimEnd('\')
    if (-not $data.Equals((Join-Path $script:NexusRoot '.local\pg'),[System.StringComparison]::OrdinalIgnoreCase) -or $lines[3] -ne '55432') { return 0 }
    $pidNumber = 0
    if (-not [int]::TryParse($lines[0],[ref]$pidNumber)) { return 0 }
    return $pidNumber
}
function Test-NexusBundledPostgres($Process) {
    if($null -eq $Process -or [string]$Process.Name -ine 'postgres.exe'){return $false}
    $binaryPath=([string]$Process.ExecutablePath).Replace('/','\')
    return (Test-NexusRootText $binaryPath) -and ($binaryPath -match '\\node_modules\\\.pnpm\\@embedded-postgres\+windows-x64@|\\node_modules\\@embedded-postgres\\windows-x64\\') -and ([string]$Process.CommandLine -match 'postgres.exe|--fork')
}
function Get-NexusOrphanProcesses {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $postgresPid = Get-NexusDedicatedPostgresPid
    $postgresOwner=Get-NexusPortOwner 55432
    $ownerProcess=$all | Where-Object { $_.ProcessId -eq $postgresOwner } | Select-Object -First 1
    $postgresPortTrusted=$postgresOwner -eq 0 -or $postgresOwner -eq $postgresPid -or (Test-NexusBundledPostgres $ownerProcess)
    $ownedProcesses = New-Object System.Collections.Generic.List[object]
    foreach ($process in $all) {
        $command = [string]$process.CommandLine
        $executable = [string]$process.ExecutablePath
        $name = [string]$process.Name
        $owned = $false
        if ($name -ieq 'postgres.exe' -and $postgresPid -gt 0 -and $postgresPortTrusted) {
            $fromBundledBinary=Test-NexusBundledPostgres $process
            $direct=$process.ProcessId -eq $postgresPid -or $process.ParentProcessId -eq $postgresPid
            # A vanished postmaster can leave workers with different recycled parent IDs.
            # The project binary, matching data/port metadata and trusted port owner are required.
            $owned=$fromBundledBinary -and ($direct -or $command -match '--fork')
        }
        if ($name -ieq 'redis-server.exe' -and ((Test-NexusRootText $executable) -or (Test-NexusRootText $command)) -and ($executable.Replace('/','\') -like "$(Join-Path $script:NexusRoot '.local\redis')\*" -or $command.Replace('/','\') -like "*$(Join-Path $script:NexusRoot '.local\redis')\*redis-server.exe*") -and $command -match '56379') { $owned = $true }
        if ($name -match '^(node|node.exe)$' -and (Test-NexusRootText $command) -and $command -match 'scripts[\\/]dev\.ts|scripts[\\/]infra\.ts|scripts[\\/]web\.ts|apps[\\/]web[\\/]node_modules[\\/]next') { $owned = $true }
        if ($name -match '^powershell(\.exe)?$' -and (Test-NexusRootText $command) -and $command -match 'runtime-child\.ps1' -and $command -match '\-Root') { $owned = $true }
        if ($owned) { $ownedProcesses.Add($process) }
    }
    return @($ownedProcesses.ToArray())
}
function Get-NexusUnmanagedOrphans($Manifest) {
    $managed=New-Object System.Collections.Generic.HashSet[int]
    foreach($role in @('infra','nexus','web','ngrok')) {
        $entry=Get-NexusRoleEntry $Manifest $role
        if(Test-NexusOwner $entry $role){
            $null=$managed.Add([int]$entry.pid)
            foreach($child in @(Get-NexusDescendants ([int]$entry.pid))){$null=$managed.Add([int]$child)}
        }
    }
    return @(Get-NexusOrphanProcesses|Where-Object {-not $managed.Contains([int]$_.ProcessId)})
}
function Stop-NexusOrphans {
    $owned = @(Get-NexusOrphanProcesses)
    # Stop children first. Every candidate has independent project evidence; PID alone is never sufficient.
    foreach ($process in $owned | Sort-Object { if ($_.Name -ieq 'postgres.exe') { 0 } else { 1 } }) {
        $fresh = Get-NexusProcess ([int]$process.ProcessId)
        if ($null -ne $fresh -and (Get-NexusStamp $fresh) -eq (Get-NexusStamp $process)) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
}
function Stop-NexusManaged($Manifest) {
    if ($null -eq $Manifest) { return }
    if ([string]$Manifest.projectRoot -ne $script:NexusRoot) { throw 'Runtime manifest belongs to a different project root.' }
    $ownedIds=New-Object System.Collections.Generic.HashSet[int]
    foreach($process in @(Get-NexusOrphanProcesses)){$null=$ownedIds.Add([int]$process.ProcessId)}
    foreach ($role in @('ngrok','web','nexus','infra')) {
        $entry = Get-NexusRoleEntry $Manifest $role
        if (-not (Test-NexusOwner $entry $role)) { continue }
        $rootPid = [int]$entry.pid
        $descendants = @(Get-NexusDescendants $rootPid)
        [array]::Reverse($descendants)
        foreach ($childPid in $descendants) {
            $child=Get-NexusProcess ([int]$childPid)
            $lineageOwned=$child -and ([string]$child.Name -match '^(node|node.exe|postgres.exe|redis-server.exe|powershell.exe|cmd.exe)$') -and (Test-NexusRootText ([string]$child.CommandLine))
            if($ownedIds.Contains([int]$childPid) -or $lineageOwned){Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue}
        }
        Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
    }
}
