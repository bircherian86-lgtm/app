const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {
  getStats: () => ipcRenderer.invoke('get-system-stats'),
  getSpecs: () => ipcRenderer.invoke('get-hardware-specs'),
  runTweak: (name, enabled) => ipcRenderer.invoke('run-tweak', { name, enabled }),
  checkAdmin: () => ipcRenderer.invoke('check-admin'),
  getTweakStates: () => ipcRenderer.invoke('get-tweak-states'),
  restartPC: () => ipcRenderer.invoke('restart-pc'),
  revertTweaks: () => ipcRenderer.invoke('revert-tweaks'),
  relaunchAdmin: () => ipcRenderer.invoke('relaunch-admin'),
  checkTweakStatus: (name) => ipcRenderer.invoke('check-tweak-status', name),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  restoreWindow: () => ipcRenderer.send('window-restore'),
  closeWindow: () => ipcRenderer.send('window-close'),
  updateRPC: (state, details) => ipcRenderer.invoke('update-rpc', state, details),
  getStartupPrograms: () => ipcRenderer.invoke('get-startup-programs'),
  toggleStartupProgram: (name, enabled) => ipcRenderer.invoke('toggle-startup-program', { name, enabled }),
  createRestorePoint: (description) => ipcRenderer.invoke('create-restore-point', description),
  getRestorePoints: () => ipcRenderer.invoke('get-restore-points'),
  getBootTime: () => ipcRenderer.invoke('get-boot-time'),
  getDiskHealth: () => ipcRenderer.invoke('get-disk-health'),
  getPingStats: () => ipcRenderer.invoke('get-ping-stats'),
  getTopProcesses: () => ipcRenderer.invoke('get-top-processes'),
  killProcess: (name) => ipcRenderer.invoke('kill-process', name),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  selectBackground: (type) => ipcRenderer.invoke('select-background', type)
});
