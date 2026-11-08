param([string]$WaveFile, [ValidateRange(-2, 2)][int]$Rate = 0)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.Rate = $Rate
    if ($WaveFile) { $voice.SetOutputToWaveFile($WaveFile) }
    $voice.Speak([Console]::In.ReadToEnd())
} finally {
    $voice.Dispose()
}
