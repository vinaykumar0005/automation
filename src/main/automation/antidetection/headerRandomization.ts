// src/main/automation/antidetection/headerRandomization.ts
/**
 * Header and request randomization
 * Rotates User-Agent variants and other headers to avoid consistent fingerprinting
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply header randomization protections to a page
 * Note: This is primarily handled at the network level by Playwright,
 * but we can ensure JS environment doesn't leak inconsistencies.
 */
export async function applyHeaderRandomization(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Ensure navigator.userAgent is consistent with what we report
    // The user agent is set at the context level, so we just ensure
    // JS-readable properties match
    if ('navigator' in window) {
      // We don't actually change the UA here - it's set by Playwright context
      // But we can ensure that any derived values are consistent

      // 2. Make sure plugins array looks natural for the UA
      const ua = navigator.userAgent || '';
      if (ua) {
        // Determine likely browser from UA
        let isChrome = /Chrome\/\d+/.test(ua) && !/Edge\/\d+/.test(ua);
        let isFirefox = /Firefox\/\d+/.test(ua);

        // Adjust plugins array to match expected browser
        if (isChrome) {
          // Chrome-specific plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => {
              const chromePlugins = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 1 }
              ];
              const pluginArray = {
                length: chromePlugins.length,
                item: (index: number) => chromePlugins[index] || null,
                namedItem: (name: string) => chromePlugins.find(p => p.name === name) || null,
                [Symbol.iterator]: function* () { yield* chromePlugins; }
              };
              return pluginArray;
            },
            configurable: true
          });
        } else if (isFirefox) {
          // Firefox typically reports plugins differently - often empty or via specific API
          // For simplicity, we'll leave as is or use a minimal set
          Object.defineProperty(navigator, 'plugins', {
            get: () => {
              const ffPlugins = [
                { name: 'Shockwave Flash', filename: 'pepflashplayer.dll', description: 'Shockwave Flash 32.0 r0', length: 1 }
              ];
              const pluginArray = {
                length: ffPlugins.length,
                item: (index: number) => ffPlugins[index] || null,
                namedItem: (name: string) => ffPlugins.find(p => p.name === name) || null,
                [Symbol.iterator]: function* () { yield* ffPlugins; }
              };
              return pluginArray;
            },
            configurable: true
          });
        }
        // For Safari/Edge, we could do similar but keep simple
      }
    }

    // 3. Spoof appCodeName and appName to be consistent
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'appCodeName', {
        get: () => 'Mozilla',
        configurable: true
      });
      Object.defineProperty(navigator, 'appName', {
        get: () => 'Netscape',
        configurable: true
      });
    }

    // 4. Ensure appVersion is consistent with user agent
    if ('navigator' in window) {
      const ua = navigator.userAgent || '';
      // Extract version from UA if possible
      const versionMatch = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : '129.0.0.0';
      Object.defineProperty(navigator, 'appVersion', {
        get: () => `5.0 (${navigator.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
        configurable: true
      });
    }

    // 5. Protect against header leakage through custom properties
    // Ensure no odd headers are detectable via JS
    // This is more of a network-level concern, but we can monitor
    // for any attempt to set custom headers that look automated

    // 6. Make sure connection type reporting is plausible.
    //
    // A previous version read `navigator.connection` from inside its own getter
    // (`get: () => ({ effectiveType: navigator.connection?.effectiveType ... })`),
    // which recursed unboundedly → `RangeError: Maximum call stack size exceeded`
    // the first time site JS read navigator.connection. Return a precomputed
    // literal instead so the getter never touches itself; binding the object
    // once also makes repeated reads stable, which is better for fingerprint
    // consistency than the per-read Math.random applyNetworkProtection produces.
    if ('connection' in navigator) {
      const conn = {
        effectiveType: '4g',
        rtt: 50 + Math.random() * 50,
        downlink: 10 + Math.random() * 20,
        saveData: false,
        type: 'wifi'
      };
      try {
        Object.defineProperty(navigator, 'connection', {
          get: () => conn,
          configurable: true
        });
      } catch {
        /* connection may be non-configurable on some builds; leave the real one */
      }
    }

    // 7. Add slight variability to timestamp-based headers if any
    // Not much we can do here as headers are set by browser/network

    // 8. Ensure Accept-Language matches languages
    if ('navigator' in window) {
      // This is tricky as Accept-Language is a header, not JS property
      // But we can at least make languages property consistent
      const langs = navigator.languages || [];
      if (langs.length > 0) {
        // Already set in environmental consistency
      }
    }
  });
}

export default { applyHeaderRandomization };