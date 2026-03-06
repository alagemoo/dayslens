const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daylens', {
  getToday:             ()                          => ipcRenderer.invoke('get-today'),
  getSummary:           (days)                      => ipcRenderer.invoke('get-summary', days),
  getWeekly:            ()                          => ipcRenderer.invoke('get-weekly'),
  setCategory:          (app, category, productive) => ipcRenderer.invoke('set-category', app, category, productive),
  getCurrentActivity:   ()                          => ipcRenderer.invoke('get-current-activity'),
  getDayRows:           (offset)                    => ipcRenderer.invoke('get-day-rows', offset),
  triggerSummary:       ()                          => ipcRenderer.invoke('trigger-summary'),
  getSummaryTime:       ()                          => ipcRenderer.invoke('get-summary-time'),
  exportPdf:            (payload)                   => ipcRenderer.invoke('export-pdf', payload),
  getExtensionInfo:     ()                          => ipcRenderer.invoke('get-extension-info'),
  openExtensionFolder:  ()                          => ipcRenderer.invoke('open-extension-folder'),
  openBrowserExtensions:(browser)                   => ipcRenderer.invoke('open-browser-extensions', browser),
});
