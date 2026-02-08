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

export interface PortConflict {
  port: number;
  pid: number;
  processName: string;
}

export interface PortCheckResult {
  available: boolean;
  conflicts: PortConflict[];
}

export interface ElectronAPI {
  docker: {
    checkInstalled: () => Promise<boolean>;
    checkRunning: () => Promise<boolean>;
    getStatus: () => Promise<DockerStatus>;
    checkPorts: () => Promise<PortCheckResult>;
    killPortProcesses: (ports: number[]) => Promise<void>;
    cleanup: () => Promise<void>;
    startDaemon: () => Promise<boolean>;
    prune: () => Promise<void>;
    pullImages: () => Promise<void>;
    start: (config?: { adminEmail?: string; adminPassword?: string }) => Promise<void>;
    stop: () => Promise<void>;
    waitHealthy: (timeoutMs?: number) => Promise<boolean>;
    getInstallUrl: () => Promise<string>;
    checkBackendDeps: () => Promise<BackendDependencies>;
    installBackendDeps: () => Promise<void>;
    onPullProgress: (callback: (progress: PullProgress) => void) => () => void;
    onStatusUpdate: (callback: (status: string) => void) => () => void;
    onInstallProgress: (callback: (status: string) => void) => () => void;
    onLog: (callback: (line: string) => void) => () => void;
    removeAllListeners: () => void;
  };
  app: {
    loadPlatform: () => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    getVersion: () => Promise<string>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
