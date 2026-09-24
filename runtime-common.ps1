Set-StrictMode -Version 2.0
$script:NexusRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$script:RuntimeDirectory = Join-Path $script:NexusRoot '.local\runtime'
$script:RuntimeManifest = Join-Path $script:RuntimeDirectory 'runtime.json'

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
function Test-NexusRootText([string]$Value) {
    if ([string]::IsNullOrEmpty($Value)) { return $false }
    return $Value.Replace('/','\').IndexOf($script:NexusRoot,[System.StringComparison]::OrdinalIgnoreCase) -ge 0
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
    if ((Get-NexusPortOwner 55432) -ne $pidNumber) { return 0 }
    return $pidNumber
}
function Get-NexusOrphanProcesses {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $postgresPid = Get-NexusDedicatedPostgresPid
    $ownedProcesses = New-Object System.Collections.Generic.List[object]
    foreach ($process in $all) {
        $command = [string]$process.CommandLine
        $executable = [string]$process.ExecutablePath
        $name = [string]$process.Name
        $owned = $false
        if ($name -ieq 'postgres.exe' -and $postgresPid -gt 0 -and ($process.ProcessId -eq $postgresPid -or $process.ParentProcessId -eq $postgresPid)) {
            $owned = (Test-NexusRootText $command) -and $command -match 'embedded-postgres|postgres.exe'
        }
        if ($name -ieq 'redis-server.exe' -and ((Test-NexusRootText $executable) -or (Test-NexusRootText $command)) -and ($executable.Replace('/','\') -like "$(Join-Path $script:NexusRoot '.local\redis')\*" -or $command.Replace('/','\') -like "*$(Join-Path $script:NexusRoot '.local\redis')\*redis-server.exe*") -and $command -match '56379') { $owned = $true }
        if ($name -match '^(node|node.exe)$' -and (Test-NexusRootText $command) -and $command -match 'scripts[\\/]dev\.ts|scripts[\\/]infra\.ts|scripts[\\/]web\.ts|apps[\\/]web[\\/]node_modules[\\/]next') { $owned = $true }
        if ($name -match '^powershell(\.exe)?$' -and (Test-NexusRootText $command) -and $command -match 'runtime-child\.ps1' -and $command -match '\-Root') { $owned = $true }
        if ($owned) { $ownedProcesses.Add($process) }
    }
    return @($ownedProcesses.ToArray())
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
    foreach ($role in @('ngrok','web','nexus','infra')) {
        $entry = Get-NexusRoleEntry $Manifest $role
        if (-not (Test-NexusOwner $entry $role)) { continue }
        $rootPid = [int]$entry.pid
        $descendants = @(Get-NexusDescendants $rootPid)
        [array]::Reverse($descendants)
        foreach ($childPid in $descendants) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
    }
}
