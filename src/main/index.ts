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
  PullProgress
} from './docker';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const PLATFORM_UI_URL = 'http://localhost:3000';

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

  mainWindow.loadFile(getPublicPath('setup.html'));
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
        try {
          await stopContainers();
          await startContainers();
          if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Services Restarted',
              message: 'Docker containers have been restarted successfully.'
            });
          }
        } catch (error) {
          dialog.showErrorBox(
            'Restart Failed',
            error instanceof Error ? error.message : 'Failed to restart Docker services'
          );
        }
      }
    },
    {
      label: 'Stop Services',
      click: async () => {
        try {
          await stopContainers();
          if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Services Stopped',
              message: 'Docker containers have been stopped.'
            });
          }
        } catch (error) {
          dialog.showErrorBox(
            'Stop Failed',
            error instanceof Error ? error.message : 'Failed to stop Docker services'
          );
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
  ipcMain.handle('docker:start', (_event, config?: { adminEmail?: string; adminPassword?: string }) => startContainers(config));
  ipcMain.handle('docker:stop', () => stopContainers());

  ipcMain.handle('docker:pull-images', async (event): Promise<void> => {
    await pullImages((progress: PullProgress) => {
      event.sender.send('docker:pull-progress', progress);
    });
  });

  ipcMain.handle('docker:wait-healthy', async (event, timeoutMs?: number): Promise<boolean> => {
    return await waitForHealthy(timeoutMs, (status: string) => {
      event.sender.send('docker:status-update', status);
    });
  });

  ipcMain.handle('docker:check-backend-deps', () => checkBackendDependencies());

  ipcMain.handle('docker:install-backend-deps', async (event): Promise<void> => {
    await installBackendDependencies((status: string) => {
      event.sender.send('docker:install-progress', status);
    });
  });

  ipcMain.handle('app:load-platform', async (): Promise<void> => {
    if (mainWindow) mainWindow.loadURL(PLATFORM_UI_URL);
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

app.on('before-quit', () => { isQuitting = true; });

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
