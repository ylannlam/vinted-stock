$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$sourceDir = Join-Path $PSScriptRoot 'adspower-companion'
$archivePath = Join-Path $repoRoot 'public/downloads/adspower-companion.zip'
$names = @('package.json','package-lock.json','adspower.mjs','authorization.mjs','companion.mjs','dotb.mjs','factory.mjs','factory-journal.mjs','dotb-ui.mjs','lookback.mjs','monitor.mjs','queue.mjs','storage.mjs','run.bat','LIRE-MOI.txt','ylavint.mjs','ylavint-ui.mjs','ylavint-journal.mjs','ylavint-visible.mjs','ylavint-memory.mjs')
$files = $names | ForEach-Object { Join-Path $sourceDir $_ }
Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName })
  if (Compare-Object ($names | Sort-Object) ($entries | Sort-Object)) { throw 'Unexpected archive entries' }
  Write-Output "Archive verified: $($entries.Count) files, no credentials."
} finally { $archive.Dispose() }
