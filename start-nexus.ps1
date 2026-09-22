$root = "D:\Project Nexus"

Write-Host "Starting NEXUS..." -ForegroundColor Cyan

# 1. PostgreSQL + Redis
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root'; corepack pnpm infra"
)

Write-Host "Waiting for PostgreSQL / Redis..."

# PostgreSQL が起動するまで待つ
while (-not (Test-NetConnection 127.0.0.1 -Port 55432 -InformationLevel Quiet)) {
    Start-Sleep -Seconds 1
}

# Redis が起動するまで待つ
while (-not (Test-NetConnection 127.0.0.1 -Port 56379 -InformationLevel Quiet)) {
    Start-Sleep -Seconds 1
}

Write-Host "Infrastructure ready." -ForegroundColor Green

# 2. NEXUS
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root'; corepack pnpm dev"
)

Write-Host "Waiting for NEXUS..."

while (-not (Test-NetConnection 127.0.0.1 -Port 3002 -InformationLevel Quiet)) {
    Start-Sleep -Seconds 1
}

Write-Host "NEXUS ready." -ForegroundColor Green

# 3. ngrok
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root'; ngrok http 3002"
)

Write-Host ""
Write-Host "NEXUS startup complete." -ForegroundColor Green
Write-Host "PostgreSQL : 55432"
Write-Host "Redis      : 56379"
Write-Host "API        : 3001"
Write-Host "Interaction: 3002"
Write-Host ""
Write-Host "Use 'corepack pnpm register' only when changing guild or slash commands."