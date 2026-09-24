$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
function New-NexusSecret([int]$Bytes=32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($buffer)).Replace('-','').ToLowerInvariant()
}
try {
    foreach($tool in @('node','corepack')) { if(-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH. Install Node.js 24 and retry." } }
    $version=[version]((& node --version).Trim().TrimStart('v'))
    if($version.Major -ne 24) { throw "Node.js 24.x is required; found $version." }
    Write-Host 'Installing dependencies with corepack pnpm...'
    & corepack pnpm install --frozen-lockfile
    if($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    $redisBinary=Join-Path $script:NexusRoot '.local\redis\Redis-8.10.2-Windows-x64-cygwin\redis-server.exe'
    if(-not (Test-Path -LiteralPath $redisBinary)) {
        Write-Host 'Preparing local Redis...'
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:NexusRoot 'scripts\setup-native-redis.ps1')
        if($LASTEXITCODE -ne 0) { throw 'Redis preparation failed.' }
    }
    $envPath=Join-Path $script:NexusRoot '.env'
    $existingEnv=Test-Path -LiteralPath $envPath
    if($existingEnv) { $lines=New-Object System.Collections.Generic.List[string];$lines.AddRange([string[]]@(Get-Content -LiteralPath $envPath)) }
    else { $lines=New-Object System.Collections.Generic.List[string];$lines.AddRange([string[]]@(Get-Content -LiteralPath (Join-Path $script:NexusRoot '.env.example'))) }
    function Get-Setting([string]$Name) { foreach($line in $lines) { if($line -match "^$Name=(.*)$") { return $Matches[1] } }; return '' }
    function Set-Setting([string]$Name,[string]$Value) { for($i=0;$i -lt $lines.Count;$i++) { if($lines[$i] -match "^$Name=") { $lines[$i]="$Name=$Value"; return } };$lines.Add("$Name=$Value") }
    foreach($key in @('IDENTITY_KEY','LOOKUP_KEY','COMPONENT_KEY','API_KEY','NEXUS_SESSION_SECRET')) { if(-not (Get-Setting $key)) { Set-Setting $key (New-NexusSecret) } }
    $newPassword=$null
    if(-not (Get-Setting 'NEXUS_WEB_PASSWORD')) { $newPassword=New-NexusSecret 16;Set-Setting 'NEXUS_WEB_PASSWORD' $newPassword }
    if(-not (Get-Setting 'NEXUS_INTERACTION_TRANSPORT')) { Set-Setting 'NEXUS_INTERACTION_TRANSPORT' 'gateway' }
    if(-not (Get-Setting 'NODE_ENV')) { Set-Setting 'NODE_ENV' 'development' }
    if(-not $existingEnv -or -not (Get-Setting 'NEXUS_WEB_AUTH_MODE') -or ((Get-Setting 'NEXUS_WEB_AUTH_MODE') -eq 'oauth' -and -not (Get-Setting 'DISCORD_CLIENT_SECRET') -and (Get-Setting 'NODE_ENV') -eq 'development')) { Set-Setting 'NEXUS_WEB_AUTH_MODE' 'development' }
    foreach($key in @('DISCORD_APPLICATION_ID','DISCORD_GUILD_ID')) {
        if(-not (Get-Setting $key)) { $value=Read-Host "$key (Discord Developer Portal / server ID)";if($value -notmatch '^\d{17,20}$') { throw "$key must be a Discord snowflake ID." };Set-Setting $key $value }
    }
    if(-not (Get-Setting 'NEXUS_GUILD_ID')) { Set-Setting 'NEXUS_GUILD_ID' (Get-Setting 'DISCORD_GUILD_ID') }
    if(-not (Get-Setting 'DISCORD_TOKEN')) {
        $secret=Read-Host 'DISCORD_TOKEN (input hidden)' -AsSecureString
        $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $value=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        if(-not $value) { throw 'DISCORD_TOKEN is required.' }
        Set-Setting 'DISCORD_TOKEN' $value
    }
    $text=($lines -join "`n")+"`n"
    [System.IO.File]::WriteAllText($envPath,$text,(New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'Building NEXUS and the local dashboard...'
    & corepack pnpm build
    if($LASTEXITCODE -ne 0) { throw 'Build failed. Review the output above before starting NEXUS.' }
    Write-Host 'Starting database, Redis, Discord, and dashboard. The database is migrated automatically; commands register when their definition changes.'
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:NexusRoot 'start-nexus.ps1')
    if($LASTEXITCODE -ne 0) { throw 'NEXUS did not start. Check .local\runtime\*.err.log and run NEXUS DOCTOR.cmd.' }
    if($newPassword) { Write-Host "Local dashboard password: $newPassword" }
    Write-Host 'Dashboard: http://localhost:3100'
    exit 0
} catch { [Console]::Error.WriteLine("NEXUS setup failed: $($_.Exception.Message)");exit 1 }
