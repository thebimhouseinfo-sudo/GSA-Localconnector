# Read-only capability check for GSA-Localconnector native Windows sandbox.
# Requires NO administrator privileges and makes NO system configuration changes.
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  platform = 'windows'
  os_version = [Environment]::OSVersion.Version.ToString()
  architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  processmodel_dll = $false
  experimental_sandbox_export = $false
  result = 'UNVERIFIED'
}
try {
  $source = @'
using System;
using System.Runtime.InteropServices;
public static class GsaSandboxProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="LoadLibraryExW")]
  public static extern IntPtr LoadLibraryEx(string name, IntPtr file, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)]
  public static extern IntPtr GetProcAddress(IntPtr module, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr module);
}
'@
  Add-Type -TypeDefinition $source
  $module = [GsaSandboxProbe]::LoadLibraryEx('processmodel.dll', [IntPtr]::Zero, 0x800)
  if ($module -ne [IntPtr]::Zero) {
    $report.processmodel_dll = $true
    try {
      $entry = [GsaSandboxProbe]::GetProcAddress($module,'Experimental_CreateProcessInSandbox')
      $report.experimental_sandbox_export = ($entry -ne [IntPtr]::Zero)
    } finally {
      [void][GsaSandboxProbe]::FreeLibrary($module)
    }
  }
} catch {
  $report.result = 'PROBE_ERROR'
  $report.error_type = $_.Exception.GetType().Name
}
# API presence is NOT enforcement proof; never set SECURITY_PASS here.
$report | ConvertTo-Json -Depth 4
