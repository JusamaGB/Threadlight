param([string]$WaveFile)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($WaveFile) { $voice.SetOutputToWaveFile($WaveFile) }
    $voice.Speak([Console]::In.ReadToEnd())
} finally {
    $voice.Dispose()
}
