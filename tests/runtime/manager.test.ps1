$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$root = Join-Path $tempBase ('NEXUS Runtime Test ' + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $root 'fake bin'
$chosen=New-Object System.Collections.Generic.List[int]
for($i=0;$i -lt 5;$i++){ $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0);$listener.Start();$port=([System.Net.IPEndPoint]$listener.LocalEndpoint).Port;$listener.Stop();if($chosen.Contains($port)){$i--;continue};$chosen.Add($port) }
$pgPort=$chosen[0];$redisPort=$chosen[1];$apiPort=$chosen[2];$interactionPort=$chosen[3];$webPort=$chosen[4]
$portMap=@{'55432'=[string]$pgPort;'56379'=[string]$redisPort;'3001'=[string]$apiPort;'3002'=[string]$interactionPort;'3100'=[string]$webPort}
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Invoke-Launcher([string]$Name) {
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName='powershell.exe';$info.Arguments='-NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root $Name)+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $process=New-Object System.Diagnostics.Process;$process.StartInfo=$info;$null=$process.Start()
    if(-not $process.WaitForExit(180000)){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue;throw "Launcher timed out: $Name"}
    return @{code=$process.ExitCode;text=$Name}
}
function PortOwner([int]$Port) {
    $row=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if($null -eq $row){return 0};return [int]$row.OwningProcess
}
try {
    New-Item -ItemType Directory -Path $bin,(Join-Path $root 'node_modules') -Force | Out-Null
    foreach($name in @('runtime-common.ps1','runtime-child.ps1','start-nexus.ps1','stop-nexus.ps1','restart-nexus.ps1')) { $contents=Get-Content -LiteralPath (Join-Path $source $name) -Raw;foreach($old in $portMap.Keys){$contents=$contents.Replace($old,$portMap[$old])};Set-Content -LiteralPath (Join-Path $root $name) -Value $contents -Encoding UTF8 }
    Set-Content -LiteralPath (Join-Path $root '.env') -Value 'NEXUS_WEB_AUTH_MODE=development' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $root 'package.json') -Value '{}' -Encoding ASCII
    @'
const net=require('node:net');
const role=process.argv[2];
if(process.env.NEXUS_FAKE_FAIL===role)process.exit(9);
const ports={infra:[55432,56379],nexus:[3001,3002],web:[3100],ngrok:[],occupy:[3100]}[role]||[];
for(const port of ports){const server=net.createServer(()=>{});server.on('error',()=>process.exit(8));server.listen(port,'127.0.0.1');}
setInterval(()=>{},1000);
'@ | ForEach-Object {$contents=$_;foreach($old in $portMap.Keys){$contents=$contents.Replace($old,$portMap[$old])};$contents} | Set-Content -LiteralPath (Join-Path $bin 'fake-service.cjs') -Encoding ASCII
@'
@echo off
set "role=%2"
if /I "%role%"=="dev" set "role=nexus"
node "%~dp0fake-service.cjs" %role%
'@ | Set-Content -LiteralPath (Join-Path $bin 'corepack.cmd') -Encoding ASCII
    @'
@echo off
node "%~dp0fake-service.cjs" ngrok
'@ | Set-Content -LiteralPath (Join-Path $bin 'ngrok.cmd') -Encoding ASCII
    $env:PATH = "$bin;$env:PATH"
    foreach($name in @('runtime-common.ps1','runtime-child.ps1','start-nexus.ps1','stop-nexus.ps1','restart-nexus.ps1')) {
        $tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $name),[ref]$tokens,[ref]$errors)|Out-Null
        Assert ($errors.Count -eq 0) "PowerShell 5.1 parse failed: $name"
    }
    $stopped=Invoke-Launcher 'stop-nexus.ps1';Assert ($stopped.code -eq 0) "First STOP failed code=$($stopped.code): $($stopped.text)"
    $stopped=Invoke-Launcher 'stop-nexus.ps1';Assert ($stopped.code -eq 0) 'Double STOP failed'
    foreach($port in $chosen){Assert ((PortOwner $port) -eq 0) "Port $port is already occupied before the clean START test"}
    $started=Invoke-Launcher 'start-nexus.ps1';Assert ($started.code -eq 0) "Clean START failed: $($started.text)"
    $manifestPath=Join-Path $root '.local\runtime\runtime.json';$first=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
    Assert ($first.projectRoot -eq $root) 'Manifest root does not preserve spaces'
    foreach($role in @('infra','nexus','web')){Assert ($first.processes.$role.pid -gt 0) "Missing $role PID"}
    Assert ($null -eq $first.processes.ngrok) 'ngrok must not start by default'
    $again=Invoke-Launcher 'start-nexus.ps1';Assert ($again.code -eq 0) "Double START failed: $($again.text)"
    $second=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;Assert ($first.infraPid -eq $second.infraPid) 'Double START changed tracked PIDs'
    $stopped=Invoke-Launcher 'stop-nexus.ps1';Assert ($stopped.code -eq 0) "Clean STOP failed: $($stopped.text)"
    Start-Sleep -Seconds 1
    foreach($port in $chosen){Assert ((PortOwner $port) -eq 0) "STOP left port $port open"}
    Assert ((Invoke-Launcher 'stop-nexus.ps1').code -eq 0) 'Second STOP failed'
    Assert ((Invoke-Launcher 'start-nexus.ps1').code -eq 0) 'START before RESTART failed'
    $beforeRestart=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
    $restarted=Invoke-Launcher 'restart-nexus.ps1';Assert ($restarted.code -eq 0) "RESTART failed: $($restarted.text)"
    $afterRestart=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;Assert ($beforeRestart.nexusPid -ne $afterRestart.nexusPid) 'RESTART did not replace NEXUS'
    Assert ((Invoke-Launcher 'stop-nexus.ps1').code -eq 0) 'STOP after RESTART failed'
    $env:NEXUS_FAKE_FAIL='nexus'
    $partial=Invoke-Launcher 'start-nexus.ps1';Assert ($partial.code -ne 0) 'Partial-start failure returned success'
    Remove-Item Env:NEXUS_FAKE_FAIL -ErrorAction SilentlyContinue
    Assert (-not (Test-Path -LiteralPath $manifestPath)) 'Partial-start failure left a manifest'
    foreach($port in $chosen){Assert ((PortOwner $port) -eq 0) "Partial-start failure left port $port open"}
    $unrelated=Start-Process -FilePath 'node.exe' -ArgumentList @(('"'+(Join-Path $bin 'fake-service.cjs')+'"'),'occupy') -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    Assert ((PortOwner $webPort) -eq $unrelated.Id) 'Unrelated port holder did not start'
    $occupied=Invoke-Launcher 'start-nexus.ps1';Assert ($occupied.code -ne 0) 'Occupied port did not block START'
    Assert (-not $unrelated.HasExited) 'START killed an unrelated Node process'
    $stale=@{projectRoot=$root;startedAt='2020-01-01T00:00:00Z';processes=@{infra=@{pid=999999;createdAt='2020-01-01T00:00:00Z'};nexus=@{pid=$unrelated.Id;createdAt='2020-01-01T00:00:00Z'}};infraPid=999999;nexusPid=$unrelated.Id;webPid=$null;ngrokPid=$null}
    New-Item -ItemType Directory -Path (Split-Path $manifestPath) -Force|Out-Null
    $stale|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Assert ((Invoke-Launcher 'stop-nexus.ps1').code -eq 0) 'Stale PID STOP failed'
    Assert (-not $unrelated.HasExited) 'Stale or reused PID killed an unrelated Node process'
    Stop-Process -Id $unrelated.Id -Force -ErrorAction SilentlyContinue
    Write-Host 'Runtime manager tests passed.'
} finally {
    Remove-Item Env:NEXUS_FAKE_FAIL -ErrorAction SilentlyContinue
    if(Test-Path -LiteralPath (Join-Path $root 'stop-nexus.ps1')){& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'stop-nexus.ps1')|Out-Null}
    if($null -ne $unrelated){Stop-Process -Id $unrelated.Id -Force -ErrorAction SilentlyContinue}
    $resolved=[System.IO.Path]::GetFullPath($root)
    if($resolved.StartsWith($tempBase+'\',[System.StringComparison]::OrdinalIgnoreCase) -and $resolved -like '*NEXUS Runtime Test *'){Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue}
}
