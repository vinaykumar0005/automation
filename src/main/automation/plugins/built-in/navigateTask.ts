// src/main/automation/plugins/built-in/navigateTask.ts
//
// Changes:
//  - Session is only cleared when the context has no cookies yet. Clearing on
//    every navigation dropped VISITOR_INFO1_LIVE / YSC / PREF / SOCS, so every
//    visit looked like first-ever traffic and repeat views were deduped.
//  - The old code cleared cookies, then cleared tracking keys, then called
//    ctx.clearSessionData() which cleared cookies again. One path now.
//  - YouTube playlist parameters are stripped from /watch URLs. With
//    `list=` + `index=` present, YouTube auto-advances to the next playlist
//    item when the video ends, so the tab silently leaves the target video.
//  - waitUntil is 'load' for YouTube instead of 'networkidle'. A streaming
//    page can sit non-idle for the full 120 s timeout.
//  - Consent handling defaults on for YouTube URLs.

import { IPlugin, ITaskHandler, TaskExecutionContext } from '../basePlugin';
import { setPersistentVideoQuality } from './videoQuality';

/** Strip playlist/index/pp so the watch page is a single-video page. */
function normalizeYouTubeUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0].split('&')[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.hostname.endsWith('youtube.com') && u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
  } catch {
    /* not a URL */
  }
  return input;
}

export class NavigateTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('NavigateTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      navigate: new NavigateTaskHandler(),
    };
  }

  dispose(): Promise<void> {
    console.log('NavigateTaskPlugin disposed');
    return Promise.resolve();
  }
}

class NavigateTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'navigate';
  }

  async execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any> {
    const page = tab.page;
    const payload = task.payload ?? {};

    const {
      waitUntil = 'domcontentloaded',
      timeout = 90_000,
      clearSessionFirst = false,
      handleYouTubeConsent = true,
      setVideoQuality,
    } = payload;

    let parsed: URL;
    try {
      parsed = new URL(payload.url);
    } catch {
      throw new Error(`navigate: "${payload.url}" is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `navigate: blocked "${parsed.protocol}" URL — only http:// and https:// are allowed (this task's payload may come from an imported profile)`
      );
    }

    const isYouTubeUrl = /youtube\.com|youtu\.be/.test(payload.url);
    const target = isYouTubeUrl ? normalizeYouTubeUrl(payload.url) : payload.url;

    const ctx = context || this.createDefaultContext(tab);

    // ---- session ---------------------------------------------------------
    // Only clear when there is nothing to preserve. A tab that already carries
    // cookies is an established visitor and should keep them.
    const existingCookies = await page.context().cookies().catch(() => []);
    const freshSession = existingCookies.length === 0;

    if (clearSessionFirst && freshSession) {
      if (ctx.clearSessionData) {
        await ctx.clearSessionData(page);
      }
      ctx.emitEvent('log', 'fresh session — cookies and storage cleared');
    } else if (clearSessionFirst) {
      // Established session: drop only player/tracking keys, keep identity.
      await page
        .evaluate(() => {
          const keys = ['yt-remote-', 'yt-player-', 'yt-img-', 'google_ads', '_ga', '_gid'];
          for (const store of [localStorage, sessionStorage]) {
            try {
              Object.keys(store).forEach((k) => {
                if (keys.some((t) => k.toLowerCase().includes(t))) store.removeItem(k);
              });
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {});
      ctx.emitEvent('log', 'existing session — player keys only');
    }

    if (tab.loopTimer) {
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    // ---- navigate --------------------------------------------------------
    const effectiveTimeout = isYouTubeUrl ? 90_000 : timeout;
    const effectiveWaitUntil = isYouTubeUrl ? 'load' : waitUntil;

    const urlBefore = page.url();
    try {
      await page.goto(target, { waitUntil: effectiveWaitUntil, timeout: effectiveTimeout });
    } catch (err: any) {
      const message = err?.message ?? '';
      const isTimeout = /Timeout .* exceeded/.test(message);
      const isProxyFailure =
        /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|net::ERR|401|403|407|502|503|504/.test(
          message
        );
      const navigatedAnyway = page.url() !== urlBefore && page.url() !== 'about:blank';

      if (isProxyFailure && !navigatedAnyway) {
        if (ctx.markProxyFailed) ctx.markProxyFailed(`Proxy connection failed: ${message}`);
        throw new Error(
          'Proxy connection failed for this tab — the proxy may be dead, out of DNS, or blocking this destination.'
        );
      }
      if (isTimeout && navigatedAnyway) {
        ctx.emitEvent('log', `navigate timeout but page loaded (${page.url()}) — continuing`);
      } else {
        if (isTimeout && ctx.markProxyFailed) ctx.markProxyFailed(`Navigation timeout: ${message}`);
        if (!navigatedAnyway) throw err;
      }
    }

    await this.randomDelay(500, 1500);

    if (isYouTubeUrl && handleYouTubeConsent && ctx.handleYouTubeConsent) {
      await ctx.handleYouTubeConsent(page);
    }

    if (setVideoQuality && ctx.setVideoQuality) {
      await ctx.setVideoQuality(page, setVideoQuality);
    }

    if (ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    return { url: page.url(), normalized: target !== payload.url };
  }

  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private createDefaultContext(tab: any): TaskExecutionContext {
    return {
      isTabValid: () => !tab.closed,
      emitEvent: (kind, data) => console.log(`[${kind}]`, data),
      randomDelay: (minMs: number, maxMs: number) => {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return new Promise((resolve) => setTimeout(resolve, delay));
      },
      simulateHumanInteraction: async (page: any) => {
        const targetX = Math.random() * 300 + 100;
        const targetY = Math.random() * 300 + 100;
        await page.mouse.move(targetX, targetY, { steps: Math.floor(Math.random() * 8) + 3 }).catch(() => {});
      },
      handleYouTubeConsent: async (page: any) => {
        await page
          .evaluate(() => {
            const sels = [
              'ytd-consent-bump-v2-lightbox ytd-button-renderer:last-of-type button',
              'tp-yt-paper-dialog ytd-button-renderer:last-of-type button',
              'form[action*="consent"] button',
              'button[aria-label*="Accept all"]',
              'button[aria-label*="Alle akzeptieren"]',
              '#consent-bump button:last-of-type',
            ];
            for (const s of sels) {
              const el = document.querySelector(s) as HTMLElement | null;
              if (el && el.offsetParent !== null) {
                el.click();
                return;
              }
            }
          })
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 700));
      },
      clearSessionData: async (page: any) => {
        await page.context().clearCookies().catch(() => {});
        await page
          .evaluate(async () => {
            try {
              localStorage.clear();
              sessionStorage.clear();
            } catch {
              /* ignore */
            }
            try {
              if ('indexedDB' in window) {
                const dbs = await indexedDB.databases();
                for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
              }
            } catch {
              /* ignore */
            }
            try {
              if ('caches' in window) for (const n of await caches.keys()) await caches.delete(n);
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
      },
      setVideoQuality: async (page: any, quality: string) => {
        await setPersistentVideoQuality(page, quality);
      },
      markProxyFailed: (reason: string) => {
        console.log(`[proxy-failed] ${reason}`);
      },
    };
  }
}