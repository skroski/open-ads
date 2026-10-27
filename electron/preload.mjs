import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Status e verificação
  getStatus: () => ipcRenderer.invoke('wizard:get-status'),
  getBrandInfo: () => ipcRenderer.invoke('wizard:get-brand-info'),
  
  // Arquivo de credenciais JSON
  selectJsonFile: () => ipcRenderer.invoke('wizard:select-json-file'),
  parseJsonContent: (content) => ipcRenderer.invoke('wizard:parse-json-content', content),
  
  // Fluxo de autorização OAuth
  startOAuth: (options) => ipcRenderer.invoke('wizard:start-oauth', options),
  
  // Consulta e teste de contas do Google Ads
  listAccounts: (options) => ipcRenderer.invoke('wizard:list-accounts', options),
  testAccount: (options) => ipcRenderer.invoke('wizard:test-account', options),
  
  // Salvar configurações no server/.env
  saveConfig: (config) => ipcRenderer.invoke('wizard:save-config', config),
  
  // Diagnóstico
  runDoctor: () => ipcRenderer.invoke('wizard:run-doctor'),
  
  // Navegação e controle de janelas
  launchDashboard: () => ipcRenderer.invoke('app:launch-dashboard'),
  openWizard: () => ipcRenderer.invoke('app:open-wizard'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  restartServer: () => ipcRenderer.invoke('app:restart-server'),

  // Eventos de progresso do OAuth
  onOAuthStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('oauth:status', listener);
    return () => ipcRenderer.removeListener('oauth:status', listener);
  },
});
