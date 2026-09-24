$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
try {
    $manifest = Read-NexusManifest
    if ($null -eq $manifest) { Write-Host 'NEXUS is already stopped.'; exit 0 }
    Stop-NexusManaged $manifest
    Remove-Item -LiteralPath $script:RuntimeManifest -Force
    Write-Host 'NEXUS stopped.'
    exit 0
} catch { [Console]::Error.WriteLine("NEXUS shutdown failed: $($_.Exception.Message)"); exit 1 }
