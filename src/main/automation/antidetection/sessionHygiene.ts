// src/main/automation/antidetection/sessionHygiene.ts
import type { Page } from 'playwright';
import { YOUTUBE_TRACKER_COOKIES } from './types';

export interface ResetSessionOptions {
  /** When true, only clear the YouTube tracker cookies (YSC, VISITOR_INFO1_LIVE)
   *  by name instead of nuking every cookie. Storage is still fully cleared. */
  trackerOnly?: boolean;
}

/**
 * Per-worker fresh-identity reset. Clears, in order: YouTube tracker cookies
 * (or all cookies), localStorage, sessionStorage, IndexedDB databases, Cache
 * Storage, and ServiceWorker registrations.
 *
 * Each storage primitive is individually wrapped in try/catch — an opaque-origin
 * document (e.g. the initial `about:blank`) throws `SecurityError` on
 * `localStorage`/`IndexedDB` access and must not abort the rest of the routine.
 * This mirrors the individually-safe pattern already used by the navigate
 * task's `clearSessionFirst` block, so the behavior contract is identical.
 *
 * Never throws. NOT a challenge/captcha bypass — it only discards tracker
 * state for a fresh per-session identity.
 */
export async function resetSession(
  page: Page,
  opts: ResetSessionOptions = {}
): Promise<void> {
  // --- Cookies ---
  try {
    if (opts.trackerOnly) {
      const cookies = await page.context().cookies();
      const target = cookies.filter((c) => YOUTUBE_TRACKER_COOKIES.includes(c.name));
      if (target.length > 0) {
        // Clear all then restore the keep-set, which is safe because no other task
        // is mutating this context concurrently (the per-tab TaskQueue serializes work).
        const keep = cookies.filter((c) => !YOUTUBE_TRACKER_COOKIES.includes(c.name));
        await page.context().clearCookies();
        if (keep.length > 0) {
          await page.context().addCookies(keep);
        }
      }
    } else {
      await page.context().clearCookies();
    }
  } catch {
    // context may be closing; non-fatal
  }

  // --- Storage + workers (page-side, wrapped individually) ---
  await page.evaluate(async () => {
    const safe = (fn: () => void) => {
      try { fn(); } catch { /* SecurityError on opaque origins — expected, ignore */ }
    };
    safe(() => localStorage.clear());
    safe(() => sessionStorage.clear());
    if ('indexedDB' in window) {
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          const dbName = db.name;
          if (dbName !== undefined) {
            try {
              await indexedDB.deleteDatabase(dbName);
            } catch {}
          }
        }
      } catch {}
    }
    const cacheStorage: any = (navigator as any).caches;
    if (cacheStorage) {
      try {
        const names = await cacheStorage.keys();
        const nameArray = names || [];
        for (const name of nameArray) {
          await cacheStorage.delete(name);
        }
      } catch {}
    }
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister().catch(() => {});
        }
      } catch {}
    }
  }).catch(() => {
    // page may have navigated/closed mid-evaluate; non-fatal
  });
}
