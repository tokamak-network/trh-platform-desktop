import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, NativeImage, dialog } from 'electron';
import * as path from 'path';
import {
  isDockerInstalled,
  isDockerRunning,
  getDockerStatus,
  pullImages,
  startContainers,
  stopContainers,
  waitForHealthy,
  getDockerInstallUrl,
  checkBackendDependencies,
  installBackendDependencies,
  cleanupProcesses,
  setLogCallback,
  getPortConflicts,
  killPortProcesses,
  PullProgress
} from './docker';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let dockerOperationInProgress = false;

const PLATFORM_UI_URL = 'http://localhost:3000';
const VITE_DEV_URL = 'http://localhost:5173';
const isDev = !app.isPackaged;

function getRendererPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
  }
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function getPublicPath(filename: string): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'public', filename);
  }
  return path.join(__dirname, '..', '..', 'public', filename);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f3f4f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
  } else {
    mainWindow.loadFile(getRendererPath());
  }

  setLogCallback((line: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docker:log', line);
    }
  });
}

function createTray(): void {
  const iconPath = getPublicPath('tray-icon.png');
  let icon: NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('TRH Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(PLATFORM_UI_URL)
    },
    { type: 'separator' },
    {
      label: 'Restart Services',
      click: async () => {
        if (dockerOperationInProgress) {
          dialog.showErrorBox('Operation In Progress', 'Please wait for the current operation to complete.');
          return;
        }
        dockerOperationInProgress = true;
        try {
          await stopContainers();
          await startContainers();
          const dialogOptions = {
            type: 'info' as const,
            title: 'Services Restarted',
            message: 'Docker containers have been restarted successfully.'
          };
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, dialogOptions);
          } else {
            dialog.showMessageBox(dialogOptions);
          }
        } catch (error) {
          dialog.showErrorBox(
            'Restart Failed',
            error instanceof Error ? error.message : 'Failed to restart Docker services'
          );
        } finally {
          dockerOperationInProgress = false;
        }
      }
    },
    {
      label: 'Stop Services',
      click: async () => {
        if (dockerOperationInProgress) {
          dialog.showErrorBox('Operation In Progress', 'Please wait for the current operation to complete.');
          return;
        }
        dockerOperationInProgress = true;
        try {
          await stopContainers();
          const dialogOptions = {
            type: 'info' as const,
            title: 'Services Stopped',
            message: 'Docker containers have been stopped.'
          };
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, dialogOptions);
          } else {
            dialog.showMessageBox(dialogOptions);
          }
        } catch (error) {
          dialog.showErrorBox(
            'Stop Failed',
            error instanceof Error ? error.message : 'Failed to stop Docker services'
          );
        } finally {
          dockerOperationInProgress = false;
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });
}

function setupIpcHandlers(): void {
  ipcMain.handle('docker:check-installed', () => isDockerInstalled());
  ipcMain.handle('docker:check-running', () => isDockerRunning());
  ipcMain.handle('docker:get-status', () => getDockerStatus());
  ipcMain.handle('docker:get-install-url', () => getDockerInstallUrl());
  ipcMain.handle('docker:check-ports', () => getPortConflicts());
  ipcMain.handle('docker:kill-port-processes', async (_event, ports: number[]) => {
    await killPortProcesses(ports);
  });

  ipcMain.handle('docker:start', async (_event, config?: { adminEmail?: string; adminPassword?: string }) => {
    if (dockerOperationInProgress) {
      throw new Error('Docker operation already in progress');
    }
    dockerOperationInProgress = true;
    try {
      await startContainers(config);
    } finally {
      dockerOperationInProgress = false;
    }
  });

  ipcMain.handle('docker:stop', async () => {
    if (dockerOperationInProgress) {
      throw new Error('Docker operation already in progress');
    }
    dockerOperationInProgress = true;
    try {
      await stopContainers();
    } finally {
      dockerOperationInProgress = false;
    }
  });

  ipcMain.handle('docker:pull-images', async (event): Promise<void> => {
    if (dockerOperationInProgress) {
      throw new Error('Docker operation already in progress');
    }
    dockerOperationInProgress = true;
    try {
      await pullImages((progress: PullProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('docker:pull-progress', progress);
        }
      });
    } finally {
      dockerOperationInProgress = false;
    }
  });

  ipcMain.handle('docker:wait-healthy', async (event, timeoutMs?: number): Promise<boolean> => {
    return await waitForHealthy(timeoutMs, (status: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('docker:status-update', status);
      }
    });
  });

  ipcMain.handle('docker:check-backend-deps', () => checkBackendDependencies());

  ipcMain.handle('docker:install-backend-deps', async (event): Promise<void> => {
    if (dockerOperationInProgress) {
      throw new Error('Docker operation already in progress');
    }
    dockerOperationInProgress = true;
    try {
      await installBackendDependencies((status: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('docker:install-progress', status);
        }
      });
    } finally {
      dockerOperationInProgress = false;
    }
  });

  ipcMain.handle('app:load-platform', async (): Promise<void> => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const maxRetries = 10;
    const retryDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(PLATFORM_UI_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          mainWindow.loadURL(PLATFORM_UI_URL);
          return;
        }
      } catch {
        // Retry unless this is the last attempt
      }
      if (i === maxRetries - 1) {
        throw new Error('Platform UI failed to respond. Please check if Docker containers are running.');
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  });

  ipcMain.handle('app:open-external', async (_event, url: string): Promise<void> => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid URL protocol');
      }
      await shell.openExternal(url);
    } catch {
      throw new Error('Invalid URL');
    }
  });

  ipcMain.handle('app:get-version', () => app.getVersion());
}

app.whenReady().then(async () => {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setupIpcHandlers();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;

  event.preventDefault();
  cleanupProcesses();
  try {
    await stopContainers();
  } catch (error) {
    console.error('Failed to stop containers on quit:', error);
  }
  app.exit(0);
});

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch { /* invalid URL */ }
  callback(false);
});
