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
