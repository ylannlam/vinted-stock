$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$sourceDir = Join-Path $PSScriptRoot 'shein-collector'
$archivePath = Join-Path $repoRoot 'public/downloads/shein-collector.zip'
# An explicit allowlist prevents browser profiles, credentials and dependencies entering the archive.
$names = @('package.json', 'package-lock.json', 'collector.mjs', 'extract.mjs', 'run.bat', 'LIRE-MOI.txt')
$files = $names | ForEach-Object { Join-Path $sourceDir $_ }
Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName })
  if (Compare-Object ($names | Sort-Object) ($entries | Sort-Object)) { throw 'Unexpected archive entries' }
  Write-Output "Archive verified: $($entries.Count) files, no profile or credentials."
} finally { $archive.Dispose() }
