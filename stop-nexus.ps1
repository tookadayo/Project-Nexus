$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
try {
    Write-Host 'NEXUS STOP'
    $manifest = Read-NexusManifest
    foreach($role in @('web','nexus','infra')){Write-Host "$role $(if(Test-NexusOwner (Get-NexusRoleEntry $manifest $role) $role){'Stopping...'}else{'Already stopped'})"}
    if ($null -ne $manifest) { Stop-NexusManaged $manifest; Remove-Item -LiteralPath $script:RuntimeManifest -Force }
    Stop-NexusOrphans
    $released=Wait-NexusPortsReleased @(55432,56379,3001,3002,3100) 5
    foreach($service in @(@('Web',3100),@('API / Discord',3001),@('Redis',56379),@('PostgreSQL',55432))){
        $info=Get-NexusPortDiagnostic ([int]$service[1]) $null
        Write-Host "$($service[0]) $(if($info.Pid -eq 0){'Stopped'}else{'Failed'})$(if($info.Pid -ne 0){" :$($service[1]) PID $($info.Pid) $($info.Ownership)"})"
    }
    if(-not $released){Write-Warning 'One or more ports remain occupied. Doctor will identify ownership; external processes were not stopped.'}
    Write-Host 'NEXUS stopped.'
    exit 0
} catch { [Console]::Error.WriteLine("NEXUS shutdown failed: $($_.Exception.Message)"); exit 1 }
