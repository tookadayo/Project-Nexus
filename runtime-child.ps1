param(
    [Parameter(Mandatory=$true)][ValidateSet('infra','nexus','web','ngrok')][string]$Role,
    [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root
switch ($Role) {
    'infra' { & corepack pnpm infra; break }
    'nexus' { & corepack pnpm dev; break }
    'web' { & corepack pnpm web --dev; break }
    'ngrok' { & ngrok http 3002; break }
}
exit $LASTEXITCODE
