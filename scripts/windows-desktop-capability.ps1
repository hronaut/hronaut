param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DesktopCapability {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, uint length, out uint needed);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string name);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$evidence = [ordered]@{
  status = 'inconclusive'
  source = $env:GITHUB_SHA
  userInteractive = [Environment]::UserInteractive
  processSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  inputDesktop = $null
  inputDesktopError = $null
  screenCount = [System.Windows.Forms.Screen]::AllScreens.Count
  width = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
  height = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height
  explorerTrayPresent = ([DesktopCapability]::FindWindow('Shell_TrayWnd', $null) -ne [IntPtr]::Zero)
  foregroundPresent = ([DesktopCapability]::GetForegroundWindow() -ne [IntPtr]::Zero)
  scope = 'Desktop capability only; no screenshot freshness or minimize/restore proof.'
}
$desktop = [DesktopCapability]::OpenInputDesktop(0, $false, 1)
if ($desktop -eq [IntPtr]::Zero) {
  $evidence.inputDesktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
} else {
  try {
    $name = New-Object System.Text.StringBuilder 256
    [uint32]$needed = 0
    if ([DesktopCapability]::GetUserObjectInformation($desktop, 2, $name, 512, [ref]$needed)) {
      $evidence.inputDesktop = $name.ToString()
    } else { $evidence.inputDesktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
  } finally { [void][DesktopCapability]::CloseDesktop($desktop) }
}
$usable = $evidence.userInteractive -and $evidence.inputDesktop -eq 'Default' -and $evidence.screenCount -gt 0 -and $evidence.width -ge 640 -and $evidence.height -ge 480 -and $evidence.explorerTrayPresent
if ($usable) { $evidence.status = 'eligible-for-native-validation' }
$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$evidence | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $OutputPath
if (-not $usable) { throw 'INCONCLUSIVE: runner does not establish an interactive Default input desktop, usable display and Explorer tray. No native screenshot coverage claimed.' }
