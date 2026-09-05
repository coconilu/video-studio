; 安装/卸载前，结束所有从安装目录运行的进程。
; Tauri 的 NSIS 模板默认只处理主程序进程；随包的 sidecar node.exe
; （resources\node\node.exe）退出主程序后可能残留，把文件锁住导致覆盖安装失败。

!macro KillInstallDirProcesses
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith(''$INSTDIR'', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"'
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillInstallDirProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillInstallDirProcesses
!macroend
