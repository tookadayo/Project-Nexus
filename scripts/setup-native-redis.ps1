$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localPath = Join-Path $workspacePath '.local'
$targetPath = Join-Path $localPath 'redis'
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
$release = Invoke-RestMethod 'https://api.github.com/repos/redis-windows/redis-windows/releases/tags/8.10.2'
$asset = $release.assets | Where-Object name -eq 'Redis-8.10.2-Windows-x64-cygwin.zip'
if (-not $asset) { throw 'Pinned Redis test binary not found' }
$archivePath = Join-Path $localPath 'redis.zip'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath
if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $asset.digest.Substring(7)) { throw 'Redis archive digest mismatch' }
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $targetPath -Force
Write-Output 'Portable Redis installed inside .local for development/tests. Production uses official Redis containers.'
