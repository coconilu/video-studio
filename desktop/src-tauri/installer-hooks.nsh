; 安装/卸载前，结束所有从安装目录 resources\ 子树运行的进程。
; Tauri 的 NSIS 模板默认只处理主程序进程；随包的 sidecar node.exe
; （resources\node\node.exe）退出主程序后可能残留，把文件锁住导致覆盖安装失败。
;
; 实现要点（均已实测）：
; - 外层用双引号 + $\" 转义：NSIS 单引号字符串里 '' 不是转义，会被拆成多个参数
; - 用 CIM 而非 Get-Process：安装器是 32 位，Get-Process 读不到 64 位进程的 .Path，
;   CIM 的 WMI provider 是 64 位，ExecutablePath 跨位数可见
; - 只匹配 resources\ 子树：主程序留给模板自带的 CheckIfAppIsRunning 弹提示处理，
;   也避免误杀路径以安装目录为前缀的兄弟目录进程；同时排除 uninstall.exe（卸载器自身）

!macro KillInstallDirProcesses
  nsExec::ExecToLog "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\resources\', [StringComparison]::OrdinalIgnoreCase) -and $$_.ExecutablePath -inotlike '*\uninstall.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillInstallDirProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillInstallDirProcesses
!macroend
