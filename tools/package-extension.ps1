$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$sourceDir = Join-Path $repoRoot 'extensions/shein'
$archivePath = Join-Path $repoRoot 'public/downloads/shein-catalogue.zip'
$names = @('manifest.json', 'extractor.js', 'popup.js', 'popup.html', 'popup.css', 'README.md')
$files = $names | ForEach-Object { Join-Path $sourceDir $_ }
Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName })
  if (Compare-Object ($names | Sort-Object) ($entries | Sort-Object)) { throw 'Unexpected archive entries' }
  Write-Output "Extension archive verified: $($entries.Count) files."
} finally { $archive.Dispose() }
