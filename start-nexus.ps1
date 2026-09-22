$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$startupTimeoutSeconds = 120

function Stop-WithError([string]$Message) {
    Write-Host "NEXUS startup failed: $Message" -ForegroundColor Red
    exit 1
}

function Require-Command([string]$Name, [string]$Help) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Stop-WithError "$Name was not found. $Help"
    }
}

function Wait-ForPort([int]$Port, [string]$Service, [System.Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds($startupTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            Stop-WithError "$Service exited before opening port $Port (exit code $($Process.ExitCode))."
        }
        if (Test-NetConnection 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue) {
            return
        }
        Start-Sleep -Seconds 1
    }
    Stop-WithError "$Service did not open port $Port within $startupTimeoutSeconds seconds."
}

if (-not (Test-Path -LiteralPath (Join-Path $root ".env") -PathType Leaf)) {
    Stop-WithError ".env is missing. Copy .env.example to .env and configure the required values."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "package.json") -PathType Leaf)) {
    Stop-WithError "package.json was not found beside this launcher."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules") -PathType Container)) {
    Stop-WithError "Dependencies are not installed. Run 'corepack pnpm install' in $root."
}

Require-Command "node" "Install Node.js 24.x."
Require-Command "corepack" "Install a Node.js distribution that includes Corepack."
Require-Command "ngrok" "Install ngrok and make it available on PATH."

$nodeVersionText = (& node --version).Trim().TrimStart('v')
try { $nodeVersion = [version]$nodeVersionText } catch { Stop-WithError "Could not read the Node.js version: $nodeVersionText" }
if ($nodeVersion.Major -ne 24) { Stop-WithError "Node.js 24.x is required; found v$nodeVersionText." }
try { $null = & corepack pnpm --version } catch { Stop-WithError "pnpm is unavailable through Corepack." }
if ($LASTEXITCODE -ne 0) { Stop-WithError "pnpm is unavailable through Corepack." }

Write-Host "Starting NEXUS from $root" -ForegroundColor Cyan
$infra = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @("-NoProfile", "-Command", "Set-Location -LiteralPath '$root'; corepack pnpm infra")
Write-Host "Waiting for PostgreSQL and Redis..."
Wait-ForPort 55432 "PostgreSQL infrastructure" $infra
Wait-ForPort 56379 "Redis infrastructure" $infra
Write-Host "Infrastructure ready." -ForegroundColor Green

$nexus = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @("-NoProfile", "-Command", "Set-Location -LiteralPath '$root'; corepack pnpm dev")
Write-Host "Waiting for the NEXUS interaction server..."
Wait-ForPort 3002 "NEXUS" $nexus
Write-Host "NEXUS ready." -ForegroundColor Green

$ngrok = Start-Process ngrok -WindowStyle Hidden -PassThru -ArgumentList @("http", "3002")
Start-Sleep -Milliseconds 500
if ($ngrok.HasExited) { Stop-WithError "ngrok exited immediately (exit code $($ngrok.ExitCode)). Check ngrok authentication and configuration." }

Write-Host ""
Write-Host "NEXUS startup complete." -ForegroundColor Green
Write-Host "PostgreSQL : 55432"
Write-Host "Redis      : 56379"
Write-Host "API        : 3001"
Write-Host "Interaction: 3002"
Write-Host "ngrok      : running"
Write-Host ""
Write-Host "Use 'corepack pnpm register' only when changing guild or slash commands."
