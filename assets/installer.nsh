# Custom NSIS installer script for DayLens
# The app's Settings toggle manages auto-start via the registry.
# The installer only sets up Add/Remove Programs metadata.

!macro customInstall
  # Register app in Windows Add/Remove Programs with metadata
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "DisplayName" "DayLens - Activity Tracker"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "Publisher" "Valion Technologies Limited"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "DisplayVersion" "1.2.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DayLens" "URLInfoAbout" "https://valiontech.com/products/daylens"
!macroend

!macro customUnInstall
  # Remove startup entry on uninstall (in case user enabled it via Settings)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DayLens"
!macroend
