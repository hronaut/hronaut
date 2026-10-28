@echo off
rem Claude Code runs headersHelper commands with cmd.exe on Windows, where sh is often not on the PATH. This prints
rem what hronaut-headers.sh prints, using the PowerShell that comes with Windows.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0hronaut-headers.ps1"
