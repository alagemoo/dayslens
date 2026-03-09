# Custom NSIS installer script for DayLens
# Adds auto-start registry entry option

!macro customInstall
  # Register app for Windows startup (optional - user can disable in Task Manager)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DayLens" "$INSTDIR\DayLens.exe --hidden"
  
  # Register app in Windows Add/Remove Programs with extra metadata
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "DisplayName" "DayLens - Activity Tracker"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "Publisher" "DayLens"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "URLInfoAbout" "https://github.com/daylens"
!macroend

!macro customUnInstall
  # Remove startup entry on uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DayLens"
!macroend
