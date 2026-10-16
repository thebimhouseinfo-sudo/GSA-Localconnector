$ErrorActionPreference = "Stop"
Write-Host "GSA Localconnector — Windows native sandbox preflight (read-only)"
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("Windows version: " + $os.Version)
Write-Host ("Architecture: " + $env:PROCESSOR_ARCHITECTURE)
$paths = @(
  "$env:WINDIR\System32\WindowsSandbox.exe",
  "$env:WINDIR\System32\WindowsSandboxClient.exe"
)
foreach ($p in $paths) { Write-Host ("Exists [" + $p + "]: " + (Test-Path -LiteralPath $p)) }
try {
 $feature = Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -ErrorAction Stop
 Write-Host ("Windows Sandbox optional feature: " + $feature.State)
} catch { Write-Host ("Windows Sandbox optional feature: not queryable (" + $_.Exception.GetType().Name + ")") }
Write-Host "NOTE: These checks DO NOT certify AppContainer, filesystem confinement, process-tree containment or ability to run SDK builds."
Write-Host "No install/enable/change was performed."
