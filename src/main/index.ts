// src/main/index.ts
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

      // Handle comma-separated or colon-separated format
      if (parts.length === 1) {
        // Format: server (label auto-generated)
        return { label: `Proxy ${i + 1}`, server: parts[0] };
      } else if (parts.length === 4) {
        // Could be: label,server,username,password OR ip:port:username:password
        // Heuristic: if first part contains a dot and looks like an IP address/domain,
        // treat as ip:port:username:password format
        const firstPart = parts[0];
        const isIpAddress = /^[\d\.]+$/.test(firstPart) ||
                           /^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9](\.[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])*$/.test(firstPart);

        if (isIpAddress) {
          // Format: ip:port:username:password
          const [ip, port, username, password] = parts;
          return {
            label: `Proxy ${i + 1}`,
            server: `${ip}:${port}`,
            username: username || undefined,
            password: password || undefined
          };
        } else {
          // Format: label,server,username,password
          const [label, server, username, password] = parts;
          return {
            label: label || `Proxy ${i + 1}`,
            server,
            username: username || undefined,
            password: password || undefined
          };
        }
      } else {
        // Fallback: treat as server only
        return { label: `Proxy ${i + 1}`, server: line };
      }
    });
}

async function loadProxiesFromFile(): Promise<ProxyConfig[]> {
  try {
    // Look for proxies.txt in the app directory
    const appPath = getAppPath();
    const proxiesPath = path.join(appPath, 'proxies.txt');

    const content = await readFile(proxiesPath, 'utf8');
    return parseProxyList(content);
  } catch (err: any) {
    // File doesn't exist or other error - not fatal
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
    // When packaged, use the directory containing the executable
    if (app.isPackaged) {
      // In packaged apps, the executable is in a different location than the app.asar
      // We want to use the directory where the executable resides for user data
      const exePath = app.getPath('exe');
      if (exePath) {
        return path.dirname(exePath);
      }
      // Fallback to app.getAppPath() if exePath fails
      return app.getAppPath();
    }

    // When not packaged (development), use the current working directory
    // or the directory of the main script
    try {
      // Try to get the app path first
      const appPath = app.getAppPath();
      if (appPath) {
        return appPath;
      }
    } catch (e) {
      // Ignore errors and continue to fallbacks
    }

    // Fallback to current working directory
    return process.cwd();
  } catch (e) {
    // Final fallback to ensure we always return a valid path
    try {
      return path.resolve('.');
    } catch {
      // Last resort - use system temp directory
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
    show: true, // Show immediately for debugging
  });

  logger.info('BrowserWindow created');

  mainWindow.once('ready-to-show', () => {
    logger.info('Window is ready to show');
    mainWindow?.show();
    mainWindow?.focus();
    logger.info('Window was shown');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error('Failed to load URL:', validatedURL, errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
    if (isMainFrame) {
      logger.info('Main frame finished loading');
    }
  });

  // Listen for renderer process crashes
  mainWindow.webContents.on('crashed', (event) => {
    logger.error('Renderer process crashed');
  });

  mainWindow.webContents.on('unresponsive', () => {
    logger.warn('Renderer process became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    logger.info('Renderer process became responsive again');
  });

  // Open DevTools for debugging in both development and production
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
  // Get configuration
  const proxyConfig = configService.getProxyConfig();
  controller = new BrowserController(); // Fixed: no parameters needed
  await controller.init();                        // ✅ launch Chromium first, properly awaited

  // Load proxies from file if available and proxy is enabled
  if (proxyConfig.enabled) {
    const proxies = await loadProxiesFromFile();
    if (proxies.length > 0) {
      // Use async non-blocking version to avoid blocking UI startup
      await controller.setProxiesAsync(proxies, proxyConfig.strategy);
      logger.info(`Loaded ${proxies.length} proxies from proxies.txt (validating in background)`);
    }
  }

  controller.attachBroadcast(() => mainWindow);    // ✅ wire event broadcast
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