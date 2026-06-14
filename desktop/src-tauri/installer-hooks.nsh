; NSIS installer hooks for Pixiv PBD Manager.
;
; Before copying files, terminate any running instance of the app and its
; Python sidecar. The sidecar (pixiv-pbd-api.exe) loads PIL's native
; extensions (e.g. PIL\_imaging.cp311-win_amd64.pyd); if it is still running
; during an install/upgrade, Windows keeps those files locked and NSIS fails
; with "Error opening file for writing ... _imaging...pyd". Killing the
; processes first lets the overwrite succeed.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM "pixiv-pbd-api.exe"'
  nsExec::Exec 'taskkill /F /T /IM "Pixiv PBD Manager.exe"'
  Sleep 600
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM "pixiv-pbd-api.exe"'
  nsExec::Exec 'taskkill /F /T /IM "Pixiv PBD Manager.exe"'
  Sleep 600
!macroend
