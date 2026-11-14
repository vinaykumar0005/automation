// src/main/automation/plugins/built-in/loopVideoTask.ts
//
// Single-flight loop engine.
//
// Changes in this revision:
//  - Ad awareness. During an ad the player swaps <video> elements and duration
//    is NaN, which the old probe read as "no video" and answered with a reload —
//    straight into another pre-roll. Ad state is now detected from the
//    .ad-showing class on #movie_player, the skip button is clicked, and the
//    watch window is frozen instead of consumed.
//  - The loop will not arm until the player has actually reached a playing
//    state once, so the first tick no longer fires into a half-loaded document.
//
// NOTE: `resolved` is string | null and narrowing is lost inside closures, so it
// is copied into the non-null `activeSelector` immediately.

import { IPlugin, ITaskHandler, TaskExecutionContext } from '../basePlugin';
import { setPersistentVideoQuality } from './videoQuality';
import { mergeLoopPayload, type LoopPayload } from './loopVideoPresets';
import { warmUpToVideo, readReferrer } from './sessionWarmup';
import { attachViewTelemetry, type ViewTelemetry } from './viewTelemetry';

const PS_UNSTARTED = -1;
const PS_ENDED = 0;
const PS_PLAYING = 1;
const PS_PAUSED = 2;
const PS_CUED = 5;

interface PlayerProbe {
  hasPlayer: boolean;
  hasVideo: boolean;
  playerState: number | null;
  hasErrorUi: boolean;
  errorCode: number;
  currentTime: number;
  duration: number;
  readyState: number;
  paused: boolean;
  adShowing: boolean;
}

export class LoopVideoTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('LoopVideoTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      loopVideo: new LoopVideoTaskHandler(),
      stopLoopVideo: new StopLoopVideoTaskHandler(),
    };
  }

  dispose(): Promise<void> {
    console.log('LoopVideoTaskPlugin disposed');
    return Promise.resolve();
  }
}

class LoopVideoTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'loopVideo';
  }

  async execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any> {
    const page = tab.page;

    const {
      selector: initialSelector,
      url,
      maxLoops,
      loopDelayMs,
      enableHumanBehavior,
      setVideoQuality,
      clearSessionFirst,
      useYouTubeLoopUrl,
      minWatchDurationMs,
      maxWatchDurationMs,
      watchPercentMin,
      watchPercentMax,
      reloadEveryLoops,
      useWarmup,
      useSearchEntry,
      searchQuery,
      verifyViews,
    } = mergeLoopPayload(task.payload as LoopPayload | undefined, 'video.html5-main-video, video');

    const ctx = context || this.createDefaultContext(tab);
    this.clearTimer(tab);

    const rawReloadUrl = url?.trim() || page.url();
    if (url?.trim()) {
      let parsed: URL;
      try {
        parsed = new URL(rawReloadUrl);
      } catch {
        throw new Error(`loopVideo: "${rawReloadUrl}" is not a valid URL`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`loopVideo: blocked "${parsed.protocol}" URL — only http:// and https:// are allowed`);
      }
    }

    const reloadUrl = this.buildWatchUrl(rawReloadUrl, useYouTubeLoopUrl);
    const videoId = this.extractVideoId(reloadUrl);
    const isYouTube = !!videoId;
    tab.loopUrl = reloadUrl;

    if (clearSessionFirst && ctx.clearSessionData) {
      await ctx.clearSessionData(page);
    }

    const telemetry: ViewTelemetry = attachViewTelemetry(page);

    if (useWarmup && videoId) {
      const usedClickPath = await warmUpToVideo(page, {
        videoId,
        useSearch: useSearchEntry,
        searchQuery,
        log: (m) => ctx.emitEvent('log', m),
      });
      ctx.emitEvent('log', `entry path: ${usedClickPath ? 'click' : 'direct'}`);

      const referrer = await readReferrer(page);
      if (!referrer) ctx.emitEvent('log', 'warning: empty referrer on watch page');
    } else {
      await this.navigate(page, reloadUrl, isYouTube, ctx);
    }

    const resolved = await this.resolveSelector(page, initialSelector, ctx);
    if (!resolved) throw new Error(this.describeMissingVideo(page.url()));

    let activeSelector: string = resolved;

    if (isYouTube) await this.waitForPlayerApi(page, ctx);
    if (ctx.handleYouTubeConsent) await ctx.handleYouTubeConsent(page);
    if (setVideoQuality && ctx.setVideoQuality) await ctx.setVideoQuality(page, setVideoQuality);

    await this.enableFocusEmulation(page);
    if (enableHumanBehavior) await this.armGesture(page, activeSelector);

    let loopCount = 0;
    let consecutiveErrors = 0;
    let busy = false;
    let stopped = false;
    let everPlayed = false;
    let lastTickAt = Date.now();
    let watchStartedAt = 0;
    let watchTargetMs = this.pickWatchTarget(
      minWatchDurationMs,
      maxWatchDurationMs,
      watchPercentMin,
      watchPercentMax
    );
    let lastDurationSec = 0;

    tab.loopVideoState = { isRunning: true, loopCount: 0, stopRequested: false };

    const stop = (reason: string) => {
      stopped = true;
      telemetry.detach();
      this.clearTimer(tab);
      tab.loopVideoState = { ...tab.loopVideoState, isRunning: false };
      ctx.emitEvent('result', { taskId: task.id, stopped: true, loopsCompleted: loopCount, reason });
    };

    const schedule = (delayMs: number) => {
      if (stopped || tab.closed || tab.loopVideoState?.stopRequested) return;
      this.clearTimer(tab);
      tab.loopTimer = setTimeout(() => {
        void tick();
      }, delayMs) as unknown as NodeJS.Timeout;
    };

    const skipAd = async () => {
      await page
        .evaluate(() => {
          const sels = [
            '.ytp-ad-skip-button-modern',
            '.ytp-ad-skip-button',
            '.ytp-skip-ad-button',
            'button.ytp-ad-skip-button-container',
            '.ytp-ad-survey-answer-button',
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
    };

    const softReplay = async () => {
      await page
        .evaluate(() => {
          const p: any = document.getElementById('movie_player');
          if (p && typeof p.seekTo === 'function') {
            p.seekTo(0, true);
            p.playVideo();
            return;
          }
          const v = document.querySelector('video') as HTMLVideoElement | null;
          if (v) {
            v.currentTime = 0;
            void v.play().catch(() => {});
          }
        })
        .catch(() => {});
    };

    const reloadMedia = async () => {
      if (!videoId) {
        await softReplay();
        return;
      }
      await page
        .evaluate((id: string) => {
          const p: any = document.getElementById('movie_player');
          if (p && typeof p.loadVideoById === 'function') p.loadVideoById(id, 0);
        }, videoId)
        .catch(() => {});
    };

    const hardReload = async () => {
      await page.bringToFront().catch(() => {});
      await this.navigate(page, tab.loopUrl!, isYouTube, ctx);
      const found = await this.resolveSelector(page, activeSelector, ctx);
      if (found) activeSelector = found;
      if (isYouTube) await this.waitForPlayerApi(page, ctx);
      if (ctx.handleYouTubeConsent) await ctx.handleYouTubeConsent(page);
      if (setVideoQuality && ctx.setVideoQuality) await ctx.setVideoQuality(page, setVideoQuality);
      await this.enableFocusEmulation(page);
      await this.armGesture(page, activeSelector);
      everPlayed = false;
    };

    const resetWatch = (durationSec: number) => {
      lastDurationSec = durationSec;
      watchStartedAt = Date.now();
      watchTargetMs = this.pickWatchTarget(
        minWatchDurationMs,
        maxWatchDurationMs,
        watchPercentMin,
        watchPercentMax,
        durationSec
      );
    };

    const completeLoop = async (reason: 'ended' | 'target' | 'error') => {
      const reported = telemetry.playbackPings() > 0 || telemetry.watchtimePings() > 0;

      // No stats ping means YouTube never acknowledged the playback. Retry it
      // instead of burning the IP on a loop that produced nothing.
      if (verifyViews && !reported && reason !== 'error') {
        consecutiveErrors++;
        ctx.emitEvent('log', `no stats ping (${consecutiveErrors}) — retrying playback instead of counting`);
        if (consecutiveErrors >= 3) {
          if (ctx.clearSessionData) await ctx.clearSessionData(page);
          await hardReload();
          consecutiveErrors = 0;
        } else {
          await reloadMedia();
        }
        telemetry.reset();
        resetWatch(lastDurationSec);
        return;
      }

      telemetry.reset();
      loopCount++;
      tab.loopVideoState = { ...tab.loopVideoState, loopCount };
      ctx.emitEvent('result', {
        taskId: task.id,
        loopCount,
        status: 'loop_completed',
        reason,
        playbackPings: telemetry.playbackPings(),
        watchtimePings: telemetry.watchtimePings(),
      });

      if (maxLoops > 0 && loopCount >= maxLoops) {
        stop('max_loops_reached');
        return;
      }

      await ctx.randomDelay(loopDelayMs, loopDelayMs + 2500);

      if (reason === 'error') {
        consecutiveErrors++;
        if (consecutiveErrors >= 4) {
          if (ctx.clearSessionData) await ctx.clearSessionData(page);
          await hardReload();
          consecutiveErrors = 0;
        } else {
          await reloadMedia();
        }
      } else {
        consecutiveErrors = 0;
        if (reloadEveryLoops > 0 && loopCount % reloadEveryLoops === 0) await hardReload();
        else await softReplay();
      }

      resetWatch(lastDurationSec);
    };

    const probe = (): Promise<PlayerProbe> =>
      page.evaluate((sel: string) => {
        const p: any = document.getElementById('movie_player');
        const v = document.querySelector(sel) as HTMLVideoElement | null;
        const errBox = document.querySelector('.ytp-error') as HTMLElement | null;
        const errVisible =
          !!errBox && getComputedStyle(errBox).display !== 'none' && (errBox.textContent || '').trim().length > 0;

        let errorCode = 0;
        try {
          if (p && typeof p.getVideoData === 'function') {
            const d = p.getVideoData();
            if (d && typeof d.errorCode === 'number') errorCode = d.errorCode;
          }
        } catch {
          /* ignore */
        }
        if (!errorCode && v && v.error) errorCode = v.error.code;

        return {
          hasPlayer: !!p,
          hasVideo: !!v,
          playerState: p && typeof p.getPlayerState === 'function' ? p.getPlayerState() : null,
          hasErrorUi: errVisible,
          errorCode,
          currentTime: v ? v.currentTime : 0,
          duration: v && Number.isFinite(v.duration) ? v.duration : 0,
          readyState: v ? v.readyState : 0,
          paused: v ? v.paused : true,
          adShowing: !!p && p.classList.contains('ad-showing'),
        };
      }, activeSelector);

    const resume = async () => {
      await page
        .evaluate(() => {
          const p: any = document.getElementById('movie_player');
          if (p && typeof p.playVideo === 'function') {
            p.playVideo();
            return;
          }
          const v = document.querySelector('video') as HTMLVideoElement | null;
          if (v) void v.play().catch(() => {});
        })
        .catch(() => {});
    };

    const tick = async (): Promise<void> => {
      if (busy) return;
      if (stopped || tab.closed || tab.loopVideoState?.stopRequested) {
        stop('stop_requested');
        return;
      }

      busy = true;
      const now = Date.now();
      try {
        const s = await probe();

        // ---- ad: freeze the window, do not count, do not reload ----
        if (s.adShowing) {
          await skipAd();
          if (watchStartedAt) watchStartedAt += now - lastTickAt;
          ctx.emitEvent('log', 'ad playing — watch clock frozen');
          return;
        }

        // ---- do not arm the loop into a half-loaded document ----
        if (!everPlayed) {
          if (s.playerState === PS_PLAYING && s.readyState >= 2) {
            everPlayed = true;
          } else if (s.hasErrorUi || s.errorCode > 0) {
            everPlayed = true;
          } else {
            return;
          }
        }

        const wedged = s.hasPlayer && s.playerState === PS_CUED && s.readyState === 0 && s.duration === 0;

        if (s.hasErrorUi || s.errorCode > 0 || wedged || !s.hasVideo) {
          ctx.emitEvent('log', `Player error (code=${s.errorCode}, state=${s.playerState})`);
          await completeLoop('error');
          return;
        }

        if (s.playerState === PS_ENDED || (s.duration > 0 && s.duration - s.currentTime < 1.0)) {
          await completeLoop('ended');
          return;
        }

        if (s.duration > 0 && s.duration !== lastDurationSec) lastDurationSec = s.duration;
        if (!watchStartedAt) resetWatch(s.duration);
        if (Date.now() - watchStartedAt >= watchTargetMs) {
          await completeLoop('target');
          return;
        }

        if (s.paused || s.playerState === PS_PAUSED || s.playerState === PS_UNSTARTED) {
          await resume();
          await page.bringToFront().catch(() => {});
        }

        if (enableHumanBehavior && ctx.simulateHumanInteraction && Math.random() < 0.45) {
          await ctx.simulateHumanInteraction(page);
        }

        if (setVideoQuality && Math.random() < 0.15) {
          await page
            .evaluate((q: string) => {
              const p: any = document.getElementById('movie_player');
              if (!p) return;
              try {
                p.setPlaybackQualityRange(q, q);
              } catch {
                /* ignore */
              }
            }, this.qualityLevel(setVideoQuality))
            .catch(() => {});
        }
      } catch (err) {
        ctx.emitEvent('log', `Tick error: ${(err as Error).message}`);
        consecutiveErrors++;
        if (consecutiveErrors >= 6) {
          try {
            await hardReload();
            consecutiveErrors = 0;
          } catch (e) {
            ctx.emitEvent('error', `Hard reload failed: ${(e as Error).message}`);
          }
        }
      } finally {
        lastTickAt = Date.now();
        busy = false;
        schedule(4000 + Math.random() * 3000);
      }
    };

    const first = await probe().catch(() => null);
    resetWatch(first?.duration ?? 0);

    ctx.emitEvent('log', `Loop armed on ${reloadUrl} (watch window ${Math.round(watchTargetMs / 1000)}s)`);
    schedule(1500 + Math.random() * 2000);

    return { looping: true, selector: activeSelector, reloadUrl, loopsCompleted: 0 };
  }

  private clearTimer(tab: any) {
    if (tab.loopTimer) {
      clearTimeout(tab.loopTimer);
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }
  }

  private buildWatchUrl(input: string, enabled: boolean): string {
    if (!enabled) return input;
    try {
      const parsed = new URL(input);
      const id =
        parsed.hostname === 'youtu.be'
          ? parsed.pathname.slice(1).split('?')[0].split('&')[0]
          : parsed.hostname.endsWith('youtube.com') && parsed.pathname === '/watch'
            ? parsed.searchParams.get('v')
            : null;
      if (!id) return input;
      // No list/index/pp: a playlist makes YouTube advance to the next item.
      return `https://www.youtube.com/watch?v=${id}&autoplay=1`;
    } catch {
      return input;
    }
  }

  private extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'youtu.be') {
        return parsed.pathname.slice(1).split('?')[0].split('&')[0] || null;
      }
      if (parsed.hostname.endsWith('youtube.com') && parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }
      return null;
    } catch {
      return null;
    }
  }

  private qualityLevel(q: string): string {
    const map: Record<string, string> = {
      auto: 'highres',
      '1080': 'hd1080',
      '720': 'hd720',
      '480': 'large',
      '360': 'medium',
      '240': 'small',
      '144': 'tiny',
    };
    return map[q] || q;
  }

  private pickWatchTarget(
    minMs: number,
    maxMs: number,
    pctMin: number,
    pctMax: number,
    durationSec?: number
  ): number {
    const shortView = Math.random() < 0.17;
    const pct = shortView ? 0.3 + Math.random() * 0.3 : pctMin + Math.random() * Math.max(0, pctMax - pctMin);

    if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
      return minMs + Math.random() * (maxMs - minMs);
    }
    const target = durationSec * 1000 * pct;
    return Math.min(Math.max(target, minMs), Math.max(maxMs, minMs));
  }

  private isRetryable(message: string): boolean {
    if (/ERR_ABORTED/.test(message)) return false;
    return /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_NAME_NOT_RESOLVED|401|403|407|502|503|504/.test(
      message
    );
  }

  private async navigate(page: any, target: string, isYouTube: boolean, ctx: TaskExecutionContext) {
    const maxAttempts = 3;
    const timeout = isYouTube ? 90_000 : 30_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
        return;
      } catch (err: any) {
        const message = err?.message ?? '';
        ctx.emitEvent('log', `Navigation failed (${attempt}/${maxAttempts}): ${message}`);

        if (attempt === maxAttempts) {
          const landed = await page.evaluate(() => !!document.querySelector('video')).catch(() => false);
          if (landed) return;
          if (this.isRetryable(message) && ctx.markProxyFailed) ctx.markProxyFailed(message);
          throw err;
        }

        if (this.isRetryable(message) && ctx.markProxyFailed) ctx.markProxyFailed(message);
        await ctx.randomDelay(2000, 5000);
      }
    }
  }

  private async resolveSelector(
    page: any,
    preferred: string,
    ctx: TaskExecutionContext
  ): Promise<string | null> {
    const candidates = [
      preferred,
      'video.html5-main-video',
      '#movie_player video',
      '#movie_player .html5-main-video',
      '.html5-video-container video',
      'ytd-player video',
      '#player video',
      'video',
    ];

    const deadline = Date.now() + 15_000;
    let warned = false;

    while (Date.now() < deadline) {
      for (const sel of candidates) {
        const ok = await page
          .evaluate((s: string) => {
            const el = document.querySelector(s);
            return !!el && el instanceof HTMLVideoElement;
          }, sel)
          .catch(() => false);
        if (ok) return sel;
      }

      if (!warned) {
        warned = true;
        ctx.emitEvent('log', 'Video element not present yet — waiting for player…');
      }

      if ((await this.pageFatalState(page)) === 'blocked') break;
      await page.waitForTimeout(500).catch(() => {});
    }
    return null;
  }

  private async waitForPlayerApi(page: any, ctx: TaskExecutionContext) {
    await page
      .waitForFunction(
        () => {
          const p: any = document.getElementById('movie_player');
          return !!p && typeof p.playVideo === 'function' && typeof p.seekTo === 'function';
        },
        { timeout: 15_000 }
      )
      .catch(() => ctx.emitEvent('log', 'Player API not ready — continuing anyway'));
  }

  private async clickConsent(page: any) {
    await page
      .evaluate(() => {
        const candidates = [
          'ytd-consent-bump-v2-lightbox ytd-button-renderer:last-of-type button',
          'tp-yt-paper-dialog ytd-button-renderer:last-of-type button',
          'form[action*="consent"] button',
          'button[aria-label*="Accept all"]',
          'button[aria-label*="Accept everything"]',
          '#consent-bump button:last-of-type',
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el && el.offsetParent !== null) {
            el.click();
            return;
          }
        }
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
  }

  private async pageFatalState(page: any): Promise<'blocked' | 'error' | null> {
    return page
      .evaluate(() => {
        if (location.hostname.includes('google.com') && location.pathname.includes('/sorry/')) return 'blocked';
        if (document.querySelector('#captcha-form')) return 'blocked';
        const err = document.querySelector('.ytp-error') as HTMLElement | null;
        if (err && getComputedStyle(err).display !== 'none') return 'error';
        return null;
      })
      .catch(() => null);
  }

  private describeMissingVideo(pageUrl: string): string {
    if (pageUrl.includes('google.com/sorry/')) return 'No <video> — Google sorry interstitial, proxy is flagged.';
    if (pageUrl.includes('youtube.com')) return 'No <video> — age-gated, unavailable, region-blocked, or player error.';
    return `No <video>. Current URL: ${pageUrl}`;
  }

  private async enableFocusEmulation(page: any) {
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch {
      /* non-Chromium */
    }
  }

  private async armGesture(page: any, selector: string) {
    try {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) return;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps: 8 });
      await page.waitForTimeout(120 + Math.random() * 200);
      await page.mouse.click(x, y);
      await page.waitForTimeout(350);
      await page
        .evaluate(() => {
          const p: any = document.getElementById('movie_player');
          if (p?.getPlayerState?.() === 2) p.playVideo();
        })
        .catch(() => {});
    } catch {
      /* best effort */
    }
  }

  private createDefaultContext(tab: any): TaskExecutionContext {
    const humanMouseMove = async (page: any, w: number, h: number) => {
      const points = 3 + Math.floor(Math.random() * 4);
      const sx = Math.random() * w * 0.8 + w * 0.1;
      const sy = Math.random() * h * 0.8 + h * 0.1;
      const ex = Math.random() * w * 0.8 + w * 0.1;
      const ey = Math.random() * h * 0.8 + h * 0.1;
      const c1x = sx + (Math.random() - 0.5) * 200;
      const c1y = sy + (Math.random() - 0.5) * 200;
      const c2x = ex + (Math.random() - 0.5) * 200;
      const c2y = ey + (Math.random() - 0.5) * 200;

      for (let i = 0; i <= points; i++) {
        const t = i / points;
        const x =
          Math.pow(1 - t, 3) * sx +
          3 * Math.pow(1 - t, 2) * t * c1x +
          3 * (1 - t) * Math.pow(t, 2) * c2x +
          Math.pow(t, 3) * ex;
        const y =
          Math.pow(1 - t, 3) * sy +
          3 * Math.pow(1 - t, 2) * t * c1y +
          3 * (1 - t) * Math.pow(t, 2) * c2y +
          Math.pow(t, 3) * ey;
        await page.mouse
          .move(x, y, { steps: Math.random() < 0.7 ? 5 + Math.floor(Math.random() * 8) : 1 })
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 90));
      }
    };

    return {
      isTabValid: () => !tab.closed,
      emitEvent: (kind: string, data: any) => console.log(`[${kind}]`, data),
      randomDelay: (minMs: number, maxMs: number) => {
        const range = Math.max(0, maxMs - minMs);
        const delay = Math.floor(minMs + Math.pow(Math.random(), 3) * range);
        return new Promise<void>((resolve) => setTimeout(resolve, delay));
      },
      simulateHumanInteraction: async (page: any) => {
        try {
          const size = page.viewportSize?.() ?? { width: 1920, height: 1080 };
          await humanMouseMove(page, size.width, size.height);
          if (Math.random() < 0.25) {
            await page.evaluate((a: number) => window.scrollBy(0, a), (Math.random() - 0.5) * 160).catch(() => {});
          }
          if (Math.random() < 0.2) {
            await page.mouse.move(size.width * 0.5, size.height * 0.72, { steps: 6 }).catch(() => {});
          }
          // No Space press — it toggles play/pause on YouTube.
        } catch {
          /* ignore */
        }
      },
      handleYouTubeConsent: async (page: any) => {
        await this.clickConsent(page);
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
      markProxyFailed: (reason: string) => console.log(`[proxy-failed] ${reason}`),
    };
  }
}

class StopLoopVideoTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'stopLoopVideo';
  }

  async execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any> {
    const ctx = context || {
      isTabValid: () => !tab.closed,
      emitEvent: (kind: string, data: any) => console.log(`[${kind}]`, data),
      randomDelay: () => Promise.resolve(),
    };

    if (tab.loopTimer) {
      clearTimeout(tab.loopTimer);
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    tab.loopVideoState = { ...tab.loopVideoState, stopRequested: true, isRunning: false };

    ctx.emitEvent('log', 'Stopped video loop');
    ctx.emitEvent('result', {
      taskId: task.id,
      stopped: true,
      loopsCompleted: tab.loopVideoState?.loopCount || 0,
    });

    return { stopped: true, loopsCompleted: tab.loopVideoState?.loopCount || 0 };
  }
}