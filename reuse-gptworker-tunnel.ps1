param(
 [ValidateSet('check','doctor','run')][string]$Action='check',
 [string]$TunnelId='',
 [string]$TunnelClientPath='',
 [int]$HealthPort=58348
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$GpRoot=Join-Path (Split-Path -Parent $Root) 'chatgpt-local-worker'
$Candidates=@(
 $TunnelClientPath,
 (Join-Path $GpRoot 'bin\tunnel-client.exe'),
 'D:\00 Other Works\Vibecode\chatgpt-local-worker\bin\tunnel-client.exe'
) | Where-Object { $_ }
$Exe=$Candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if(-not $Exe){throw 'GPTWorker tunnel-client.exe not found. Set -TunnelClientPath to the existing GPTWorker binary. No additional installation is needed.'}
Write-Host "Reusing GPTWorker tunnel-client binary: $Exe"
& $Exe --version
if($LASTEXITCODE -ne 0){throw 'Existing tunnel-client could not run.'}
if($Action -eq 'check'){Write-Host 'PASS: existing tunnel-client binary found; GPTWorker unchanged.';exit 0}
if(-not $TunnelId){$TunnelId=$env:GSA_LC_TUNNEL_ID}
if($TunnelId -notmatch '^tunnel_[a-fA-F0-9]{32}$'){throw 'Set the GSA-Localconnector tunnel ID via -TunnelId or GSA_LC_TUNNEL_ID (not GPTWorker tunnel ID).'}
if(-not $env:CONTROL_PLANE_API_KEY){throw 'CONTROL_PLANE_API_KEY is not set in this PowerShell process. Supply an authorized runtime key locally; do not share or save it to the repository.'}
$McpScript=Join-Path $Root 'dist\src\mcp\cli.js'
if(-not (Test-Path -LiteralPath $McpScript)){throw 'Missing compiled MCP. Run npm test or npm run build.'}
$ProfileDir=Join-Path $env:LOCALAPPDATA 'GSA-Localconnector\tunnel'
New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
$Profile=Join-Path $ProfileDir 'gsa-localconnector.yaml'
# tunnel-client 0.0.14 parses stdio command with POSIX-like backslash escaping. Use Windows-compatible forward slashes in absolute paths so C:\\ does not become C:; keep quotes for spaces.
$node=(Get-Command node -ErrorAction Stop).Source
$command='"'+$node.Replace('\','/').Replace('"','\"')+'" "'+$McpScript.Replace('\','/').Replace('"','\"')+'"'
$yaml=@"
config_version: 1
control_plane:
  tunnel_id: "$TunnelId"
  api_key: env:CONTROL_PLANE_API_KEY
health:
  listen_addr: "127.0.0.1:$HealthPort"
log:
  level: info
  format: json
mcp:
  commands:
    - channel: main
      command: '$command'
"@
[System.IO.File]::WriteAllText($Profile,$yaml,[System.Text.UTF8Encoding]::new($false))
Write-Host "Profile created: $Profile"
Write-Host 'No API key stored in profile. GPTWorker is not modified.'
if($Action -eq 'doctor'){& $Exe doctor --profile-file $Profile --explain;exit $LASTEXITCODE}
& $Exe run --profile-file $Profile
exit $LASTEXITCODE
