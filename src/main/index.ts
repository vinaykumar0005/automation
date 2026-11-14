// src/main/index.ts
//
// Fix: 'crashed' is no longer part of the WebContents event typings; Electron
// emits 'render-process-gone' with a details object carrying reason/exitCode.

import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { registerIpcHandlers } from './ipc/handler';
import { BrowserController } from './automation/BrowserController';
import { ProxyConfig } from './automation/types';
import logger from './logging/logger';
import { configService } from './config/configService';
const os = require('os');

// Set disk cache directory to avoid access denied errors
app.commandLine.appendSwitch('disk-cache-dir', path.join(os.tmpdir(), 'electron-cache'));

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
}

let mainWindow: BrowserWindow | null = null;
let controller: BrowserController | null = null;

// Reuse the parsing logic from ProxyPanel.tsx
function parseProxyList(raw: string): ProxyConfig[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      // First try comma-separated format (existing behavior)
      let parts = line.split(',').map((p) => p.trim());

      // If we don't have 4 parts from comma splitting, try colon-separated format
      // to see if it's ip:port:username:password format
      if (parts.length !== 4) {
        parts = line.split(':').map((p) => p.trim());
      }

      if (parts.length === 1) {
        return { label: `Proxy ${i + 1}`, server: parts[0] };
      } else if (parts.length === 4) {
        // Could be: label,server,username,password OR ip:port:username:password
        const firstPart = parts[0];
        const isIpAddress =
          /^[\d\.]+$/.test(firstPart) ||
          /^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9](\.[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])*$/.test(firstPart);

        if (isIpAddress) {
          const [ip, port, username, password] = parts;
          return {
            label: `Proxy ${i + 1}`,
            server: `${ip}:${port}`,
            username: username || undefined,
            password: password || undefined,
          };
        } else {
          const [label, server, username, password] = parts;
          return {
            label: label || `Proxy ${i + 1}`,
            server,
            username: username || undefined,
            password: password || undefined,
          };
        }
      } else {
        return { label: `Proxy ${i + 1}`, server: line };
      }
    });
}

async function loadProxiesFromFile(): Promise<ProxyConfig[]> {
  try {
    const appPath = getAppPath();
    const proxiesPath = path.join(appPath, 'proxies.txt');

    const content = await readFile(proxiesPath, 'utf8');
    return parseProxyList(content);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      logger.info('proxies.txt not found - starting with no proxies');
    } else {
      logger.warn('Failed to load proxies.txt', err);
    }
    return [];
  }
}

// Helper function to get the correct base path for app data
const getAppPath = () => {
  try {
    if (app.isPackaged) {
      const exePath = app.getPath('exe');
      if (exePath) {
        return path.dirname(exePath);
      }
      return app.getAppPath();
    }

    try {
      const appPath = app.getAppPath();
      if (appPath) {
        return appPath;
      }
    } catch {
      /* ignore */
    }

    return process.cwd();
  } catch {
    try {
      return path.resolve('.');
    } catch {
      return require('os').tmpdir();
    }
  }
};

async function createWindow() {
  logger.info('Creating BrowserWindow');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    show: true,
  });

  logger.info('BrowserWindow created');

  mainWindow.once('ready-to-show', () => {
    logger.info('Window is ready to show');
    mainWindow?.show();
    mainWindow?.focus();
    logger.info('Window was shown');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('Failed to load URL:', validatedURL, errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (isMainFrame) {
      logger.info('Main frame finished loading');
    }
  });

  // Renderer process crashes. 'crashed' is gone from the typings; this is the
  // current event and it carries a reason.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone: ${details.reason} (exitCode ${details.exitCode})`);
  });

  mainWindow.webContents.on('unresponsive', () => {
    logger.warn('Renderer process became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    logger.info('Renderer process became responsive again');
  });

  mainWindow.webContents.openDevTools();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  logger.info('Loading URL or file');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    logger.info('Loaded dev server URL:', devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    logger.info('Loaded local index.html');
  }
}

app.whenReady().then(async () => {
  const proxyConfig = configService.getProxyConfig();
  controller = new BrowserController();
  await controller.init();

  if (proxyConfig.enabled) {
    const proxies = await loadProxiesFromFile();
    if (proxies.length > 0) {
      await controller.setProxiesAsync(proxies, proxyConfig.strategy);
      logger.info(`Loaded ${proxies.length} proxies from proxies.txt (validating in background)`);
    }
  }

  controller.attachBroadcast(() => mainWindow);
  registerIpcHandlers(controller, () => mainWindow);
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await controller?.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (controller && !controller.isShutDown) {
    e.preventDefault();
    await controller.shutdown();
    app.quit();
  }
});

process.on('unhandledRejection', (err) => logger.error('UnhandledRejection', err));