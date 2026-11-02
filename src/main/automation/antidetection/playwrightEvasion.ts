// src/main/automation/antidetection/playwrightEvasion.ts
/**
 * Playwright/Electron-specific evasion
 * Removes traces of automation frameworks and headless browser indicators
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply Playwright-specific evasion techniques to a page
 */
export async function applyPlaywrightEvasion(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Remove Playwright-specific properties
    const playwrightProps = [
      '__playwright_initalized',
      '__playwright_page_initialize_promise',
      '__CLIKEE',
      '__PLAYWRIGHT_INTERNAL',
      '__PW_INTERR',
      '__PW_UPD_TS',
      '__PWAIT_SELECTORS',
      '__PWAIT_ACTIONABLE',
      '__PWAIT_HIDDEN',
      '__PWAIT_VISIBLE',
      '__PWAIT_STABLE',
      '__PWAIT_DETACHED',
      '__PWAIT_FOCUSED',
      '__PWAIT_ENABLED',
      '__PWAIT_EDITABLE'
    ];

    playwrightProps.forEach(prop => {
      delete (window as any)[prop];
      delete (document as any)[prop];
    });

    // 2. Hide automation flags from chrome.runtime
    if ('chrome' in window && (window as any).chrome.runtime) {
      const originalOnConnect = (window as any).chrome.runtime.onConnect;
      if (originalOnConnect) {
        (window as any).chrome.runtime.onConnect = {
          ...originalOnConnect,
          // Remove any automation-specific listeners
          _listeners: originalOnConnect._listeners?.filter(
            (listener: Function) => !listener.toString().includes('automated')
          ) || []
        };
      }
    }

    // 3. Spoof navigator.plugins to look more realistic
    if ('navigator' in window) {
      // Create a realistic plugin array
      const fakePlugins = [
        {
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
          length: 1
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '',
          length: 1
        },
        {
          name: 'Native Client',
          filename: 'internal-nacl-plugin',
          description: '',
          length: 1
        }
      ];

      // Override plugins with realistic array-like object
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          // Create a fake PluginArray object
          const pluginArray = {
            length: fakePlugins.length,
            item: (index: number) => fakePlugins[index] || null,
            namedItem: (name: string) => fakePlugins.find(p => p.name === name) || null,
            [Symbol.iterator]: function* () {
              yield* fakePlugins;
            }
          };
          return pluginArray;
        },
        configurable: true
      });
    }

    // 4. Remove webdriver property completely (enhance existing protection)
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
      });
    }

    // 5. Spoof languages and language-related properties
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
      });
    }

    // 6. Protect against headless detection via chrome.app
    if ('chrome' in window && (window as any).chrome.app) {
      // Ensure chrome.app looks like a real browser
      const chromeApp = (window as any).chrome.app;
      if (!chromeApp.isInstalled) {
        chromeApp.isInstalled = false;
      }
      // Add missing properties that headless browsers often lack
      chromeApp.getDetails = function() {
        return {
          version: '1.0.0',
          name: 'Chrome'
        };
      };
      chromeApp.getIsInstalled = function() {
        return false;
      };
      chromeApp.getPackageDirectoryEntry = function() {
        // Return a mock DirectoryEntry
        return {
          isFile: false,
          isDirectory: true,
          name: 'chrome',
          fullPath: '/chrome'
        };
      };
    }

    // 7. Hide automation indicators in permissions API
    if ('permissions' in navigator) {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = async (permissionDesc) => {
        // Could modify specific permissions to look less automated
        // but for now, just pass through to avoid breaking functionality
        return originalQuery(permissionDesc);
      };
    }

    // 8. Spoof outer dimensions to look less like a controlled environment
    if ('window' in window) {
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth + (Math.random() > 0.5 ? 10 : 0),
        configurable: true
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => window.innerHeight + (Math.random() > 0.5 ? 10 : 0),
        configurable: true
      });
    }

    // 9. Protect against headless detection via document.visibilityState
    // Ensure it matches what you'd expect in a normal browser
    Object.defineProperty(document, 'visibilityState', {
      get: () => document.hidden ? 'hidden' : 'visible',
      configurable: true
    });

    // 10. Remove any Playwright-specific CSS classes or attributes
    // Override getAttribute to hide automation attributes
    const originalGetAttribute = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function(name) {
      // Hide common automation attributes
      if (name && (name.includes('webkit') || name.includes('playwright') || name.includes('automated'))) {
        return null;
      }
      return originalGetAttribute.call(this, name);
    };
  });
}

export default { applyPlaywrightEvasion };