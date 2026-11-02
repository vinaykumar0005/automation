// src/main/automation/antidetection/environmental.ts
/**
 * Environmental consistency checks
 * Ensures geoip, timezone, language, and hardware properties are plausible and consistent
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply environmental consistency protections to a page
 */
export async function applyEnvironmentalConsistency(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Ensure timezone matches locale where possible
    // We'll accept any timezone but ensure it's a valid IANA timezone string
    // (no need to modify if already set by fingerprint)

    // 2. Spoof languages to be consistent with locale
    if ('navigator' in window) {
      const locale = navigator.language || 'en-US';
      // Derive Accept-Language header value from locale
      const langValues = [
        locale,
        locale.split('-')[0], // primary language
        'en'
      ].filter((v, i, arr) => arr.indexOf(v) === i); // unique
      Object.defineProperty(navigator, 'languages', {
        get: () => langValues,
        configurable: true
      });
    }

    // 3. Ensure hardware concurrency is plausible for the platform
    if ('navigator' in window) {
      // Get user agent to guess platform
      const ua = navigator.userAgent || '';
      let expectedCores = 4; // default fallback
      if (/Windows NT/.test(ua)) {
        expectedCores = 4; // typical desktop
      } else if (/Macintosh|Mac OS X/.test(ua)) {
        expectedCores = 8; // typical Mac
      } else if (/Linux|X11/.test(ua)) {
        expectedCores = 4;
      } else if (/Android/.test(ua)) {
        expectedCores = 4;
      } else if (/iPhone|iPad|iPod/.test(ua)) {
        expectedCores = 6; // typical mobile
      }

      // Clamp reported hardwareConcurrency to a plausible range
      const reported = navigator.hardwareConcurrency || expectedCores;
      const plausible = Math.max(2, Math.min(reported, 32)); // 2-32 cores
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => plausible,
        configurable: true
      });
    }

    // 4. Ensure deviceMemory is plausible
    if ('navigator' in window) {
      // Typical device memory values: 2,4,8,16,32 GB
      const typicalMemory = [2, 4, 8, 16, 32];
      const reported = (navigator as any).deviceMemory || 8;
      // Find closest typical value
      const closest = typicalMemory.reduce((prev, curr) =>
        Math.abs(curr - reported) < Math.abs(prev - reported) ? curr : prev
      );
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => closest,
        configurable: true
      });
    }

    // 5. Ensure maxTouchPoints is consistent with touch capability
    if ('navigator' in window) {
      const hasTouch = navigator.maxTouchPoints > 0;
      const reported = navigator.maxTouchPoints || (hasTouch ? 5 : 0);
      // Ensure it's either 0 (no touch) or a plausible touch count (1-10)
      const plausible = hasTouch ? Math.min(Math.max(reported, 1), 10) : 0;
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => plausible,
        configurable: true
      });
    }

    // 6. Ensure platform is consistent with user agent
    if ('navigator' in window) {
      const ua = navigator.userAgent || '';
      let platform = navigator.platform;
      // Override platform to match UA if mismatched
      if (/Windows NT/.test(ua) && !/Win32|Win64/.test(platform)) {
        platform = 'Win32';
      } else if (/Macintosh|Mac OS X/.test(ua) && !/Mac/.test(platform)) {
        platform = 'MacIntel';
      } else if (/Linux|X11/.test(ua) && !/Linux/.test(platform)) {
        platform = 'Linux x86_64';
      } else if (/Android/.test(ua) && !/Linux/.test(platform)) {
        platform = 'Linux armv7l'; // common for Android in UA
      } else if (/iPhone|iPad|iPod/.test(ua) && !/iPhone|iPad|iPod/.test(platform)) {
        platform = 'iPhone';
      }
      Object.defineProperty(navigator, 'platform', {
        get: () => platform,
        configurable: true
      });
    }

    // 7. Ensure cpuClass is consistent with platform (legacy IE)
    if ('navigator' in window) {
      const platform = navigator.platform || '';
      let cpuClass = (navigator as any).cpuClass;
      if (!cpuClass) {
        // Derive from platform
        if (/Win/.test(platform)) {
          cpuClass = 'x86';
        } else if (/Mac/.test(platform)) {
          cpuClass = undefined; // Apple doesn't expose
        } else if (/Linux/.test(platform)) {
          cpuClass = undefined; // Linux varies
        }
      }
      // Only set if we have a definite value
      if (cpuClass) {
        Object.defineProperty(navigator, 'cpuClass', {
          get: () => cpuClass,
          configurable: true
        });
      }
    }

    // 8. Ensure cookieEnabled is true (most browsers have it enabled)
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'cookieEnabled', {
        get: () => true,
        configurable: true
      });
    }

    // 9. Ensure onLine is true (we assume online)
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'onLine', {
        get: () => true,
        configurable: true
      });
    }

    // 10. Ensure doNotTrack is null (not enabled by default)
    if ('navigator' in window) {
      Object.defineProperty(navigator, 'doNotTrack', {
        get: () => null,
        configurable: true
      });
    }
  });
}

export default { applyEnvironmentalConsistency };