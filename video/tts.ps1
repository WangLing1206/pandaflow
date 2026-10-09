# Generate narration audio with the built-in Windows Chinese TTS voice.
# NOTE: keep this file ASCII-only -- Windows PowerShell reads .ps1 as ANSI
# unless a BOM is present, which corrupts non-ASCII source.
param(
  [string]$Segments = (Join-Path $PSScriptRoot 'segments.json'),
  [string]$OutDir = (Join-Path $PSScriptRoot 'audio'),
  [int]$Rate = 1
)

Add-Type -AssemblyName System.Speech
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$json = [System.IO.File]::ReadAllText($Segments, [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
if ($voice) {
  $synth.SelectVoice($voice.VoiceInfo.Name)
  Write-Host "voice: $($voice.VoiceInfo.Name)"
} else {
  Write-Host "WARNING: no zh-CN voice found, using default"
}
$synth.Rate = $Rate
$synth.Volume = 100

$manifest = @()
foreach ($seg in $data) {
  $file = Join-Path $OutDir ($seg.id + '.wav')
  $synth.SetOutputToWaveFile($file)
  $synth.Speak($seg.text)
  $synth.SetOutputToNull()
  $manifest += [pscustomobject]@{ id = $seg.id; file = $file; chars = $seg.text.Length }
  Write-Host ("{0} -> {1}  ({2} chars)" -f $seg.id, $file, $seg.text.Length)
}
$synth.Dispose()

$manifest | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $OutDir 'manifest.json') -Encoding UTF8
Write-Host ""
Write-Host ("done: {0} segments" -f $manifest.Count)
