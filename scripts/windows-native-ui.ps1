param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('clear','text','image','tray','menu','screenshot')]
  [string]$Action,
  [string]$Label,
  [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Action -eq 'clear') { [System.Windows.Forms.Clipboard]::Clear(); exit 0 }
if ($Action -eq 'text') { [Console]::Write([System.Windows.Forms.Clipboard]::GetText()); exit 0 }
if ($Action -eq 'image') {
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image -or $image.Width -le 0 -or $image.Height -le 0) { throw 'No valid native clipboard image' }
  try { [Console]::Write("$($image.Width)x$($image.Height)") } finally { $image.Dispose() }
  exit 0
}
if ($Action -eq 'screenshot') {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  exit 0
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativePointer {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]::Descendants
function Find-Named($parent, [string]$name) {
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  return $parent.FindFirst($scope, $condition)
}
function Click-Native($element, [bool]$right) {
  if ($null -eq $element) { throw 'Required native desktop element was not found; GUI coverage cannot be skipped' }
  $point = $element.GetClickablePoint()
  if (-not [NativePointer]::SetCursorPos([int]$point.X, [int]$point.Y)) { throw 'Cannot move native pointer' }
  Start-Sleep -Milliseconds 100
  if ($right) { $down=8; $up=16 } else { $down=2; $up=4 }
  [NativePointer]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
  [NativePointer]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
}
if ($Action -eq 'tray') {
  $trayCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
  $tray = $root.FindFirst($scope, $trayCondition)
  if ($null -eq $tray) { throw 'No interactive Explorer notification area; native tray gate unavailable' }
  $icon = Find-Named $tray 'Hronaut'
  if ($null -eq $icon -or $icon.Current.IsOffscreen) {
    Click-Native (Find-Named $tray 'Show hidden icons') $false
    Start-Sleep -Milliseconds 500
    $overflowCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'NotifyIconOverflowWindow')
    $overflow = $root.FindFirst($scope, $overflowCondition)
    if ($null -eq $overflow) { throw 'Notification overflow unavailable' }
    $icon = Find-Named $overflow 'Hronaut'
  }
  Click-Native $icon $true
} else {
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Label)
  $typeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)
  $condition = New-Object System.Windows.Automation.AndCondition($nameCondition, $typeCondition)
  Click-Native ($root.FindFirst($scope, $condition)) $false
}
