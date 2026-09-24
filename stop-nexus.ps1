$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
try {
    $manifest = Read-NexusManifest
    if ($null -ne $manifest) { Stop-NexusManaged $manifest; Remove-Item -LiteralPath $script:RuntimeManifest -Force }
    Stop-NexusOrphans
    Write-Host 'NEXUS stopped.'
    exit 0
} catch { [Console]::Error.WriteLine("NEXUS shutdown failed: $($_.Exception.Message)"); exit 1 }
