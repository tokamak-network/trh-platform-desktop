import { contextBridge, ipcRenderer } from 'electron';

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  containersUp: boolean;
  healthy: boolean;
  error?: string;
}

export interface PullProgress {
  service: string;
  status: string;
  progress?: string;
}

export interface BackendDependencies {
  pnpm: boolean;
  node: boolean;
  forge: boolean;
  aws: boolean;
  allInstalled: boolean;
}

const electronAPI = {
  docker: {
    checkInstalled: (): Promise<boolean> => ipcRenderer.invoke('docker:check-installed'),
    checkRunning: (): Promise<boolean> => ipcRenderer.invoke('docker:check-running'),
    getStatus: (): Promise<DockerStatus> => ipcRenderer.invoke('docker:get-status'),
    pullImages: (): Promise<void> => ipcRenderer.invoke('docker:pull-images'),
    start: (config?: { adminEmail?: string; adminPassword?: string }): Promise<void> => ipcRenderer.invoke('docker:start', config),
    stop: (): Promise<void> => ipcRenderer.invoke('docker:stop'),
    waitHealthy: (timeoutMs?: number): Promise<boolean> => ipcRenderer.invoke('docker:wait-healthy', timeoutMs),
    getInstallUrl: (): Promise<string> => ipcRenderer.invoke('docker:get-install-url'),
    checkBackendDeps: (): Promise<BackendDependencies> => ipcRenderer.invoke('docker:check-backend-deps'),
    installBackendDeps: (): Promise<void> => ipcRenderer.invoke('docker:install-backend-deps'),

    onPullProgress: (callback: (progress: PullProgress) => void): void => {
      ipcRenderer.on('docker:pull-progress', (_event, progress) => callback(progress));
    },
    onStatusUpdate: (callback: (status: string) => void): void => {
      ipcRenderer.on('docker:status-update', (_event, status) => callback(status));
    },
    onInstallProgress: (callback: (status: string) => void): void => {
      ipcRenderer.on('docker:install-progress', (_event, status) => callback(status));
    },
    removeAllListeners: (): void => {
      ipcRenderer.removeAllListeners('docker:pull-progress');
      ipcRenderer.removeAllListeners('docker:status-update');
      ipcRenderer.removeAllListeners('docker:install-progress');
    }
  },

  app: {
    loadPlatform: (): Promise<void> => ipcRenderer.invoke('app:load-platform'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
