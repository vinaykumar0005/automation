// src/main/automation/antidetection/playwrightEvasion.ts
//
// The old version returned null from getAttribute() for ANY attribute name
// containing "webkit", and forced navigator.languages to ['en-US','en']
// regardless of the context locale.

import type { BrowserContext } from 'playwright';

export async function applyPlaywrightEvasion(target: BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const g = globalThis as any;
    const nav = navigator as any;

    const props = [
      '__playwright',
      '__playwright__binding__',
      '__pwInitScripts',
      '__pw_manual',
      '__PW_inspect',
      '__CLIKEE',
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
      '__PWAIT_EDITABLE',
    ];
    for (const p of props) {
      try {
        delete g[p];
      } catch {
        /* non-configurable */
      }
    }

    if (g.chrome?.runtime?.onConnect && typeof g.chrome.runtime.onConnect.addListener === 'function') {
      g.chrome.runtime.onConnect.addListener = g.chrome.runtime.onConnect.addListener.bind(
        g.chrome.runtime.onConnect
      );
    }

    try {
      Object.defineProperty(nav, 'webdriver', { get: () => false, configurable: true });
    } catch {
      /* ignore */
    }

    // Only strip attributes that really are automation artifacts.
    const originalGetAttribute = Element.prototype.getAttribute;
    const AUTOMATION_ATTR = /^data-(pw|playwright|selenium|automation)[-\w]*$/i;
    Element.prototype.getAttribute = function (this: Element, name: string) {
      const value = originalGetAttribute.call(this, name);
      if (value === null) return value;
      return AUTOMATION_ATTR.test(name) ? null : value;
    };

    Object.defineProperty(document, 'visibilityState', {
      get: () => (document.hidden ? 'hidden' : 'visible'),
      configurable: true,
    });

    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85, configurable: true });
  });
}

export default { applyPlaywrightEvasion };