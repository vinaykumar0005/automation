// src/main/automation/plugins/built-in/watchDurationTask.ts
import { IPlugin, ITaskHandler, TaskExecutionContext } from '../basePlugin';
import { setPersistentVideoQuality } from './videoQuality';

export class WatchDurationTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('WatchDurationTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      watchDuration: new WatchDurationTaskHandler(),
    };
  }

  dispose(): Promise<void> {
    console.log('WatchDurationTaskPlugin disposed');
    return Promise.resolve();
  }
}

class WatchDurationTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'watchDuration';
  }

  async execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any> {
    const page = tab.page;
    const {
      minWatchTimeMs = 30_000,
      maxWatchTimeMs = 60_000,
      jitterMs = 5_000,
      url,
      selector = 'video.html5-main-video, video',
      enableHumanBehavior = true,
      clearSessionFirst = false,
      setVideoQuality = '1080',
    } = task.payload as {
      minWatchTimeMs?: number;
      maxWatchTimeMs?: number;
      jitterMs?: number;
      url?: string;
      selector?: string;
      enableHumanBehavior?: boolean;
      clearSessionFirst?: boolean;
      setVideoQuality?: string;
    };

    const ctx = context || this.createDefaultContext(tab);

    if (tab.loopTimer) {
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    const watchMin = Math.max(1_000, Math.min(minWatchTimeMs, maxWatchTimeMs));
    const watchMax = Math.max(watchMin, maxWatchTimeMs);
    const duration = Math.floor(watchMin + Math.random() * (watchMax - watchMin));
    const targetUrl = url?.trim() || page.url();

    // Optionally clear session data for fresh view
    if (clearSessionFirst && ctx.clearSessionData) {
      await ctx.clearSessionData(page);
    }

    if (page.url() !== targetUrl) {
      // Use longer timeout for YouTube URLs to handle redirects
      const isYouTubeUrl = /youtube\.com|youtu\.be/.test(targetUrl);
      const effectiveTimeout = isYouTubeUrl ? 90000 : 30_000;
      const effectiveWaitUntil = isYouTubeUrl ? 'networkidle' : 'domcontentloaded';
      await page.goto(targetUrl, { waitUntil: effectiveWaitUntil, timeout: effectiveTimeout });

      // Handle YouTube consent after navigation
      if (ctx.handleYouTubeConsent) {
        await ctx.handleYouTubeConsent(page);
      }
    }

    // Ensure video is playing
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (el && el instanceof HTMLVideoElement) {
        (el as HTMLVideoElement).play().catch(() => {});
      }
    }, selector);

    // Wait for YouTube player API to be ready
    if (isYouTubeUrl) {
      await page.waitForFunction(() => {
        const player = document.getElementById('movie_player') as any || document.querySelector('.html5-video-player') as any;
        return player && typeof player.setPlaybackQuality === 'function';
      }, { timeout: 15000 }).catch(() => {
        ctx.emitEvent('log', 'YouTube player API not fully ready, continuing anyway...');
      });
    }

    // Set video quality for YouTube
    if (setVideoQuality && ctx.setVideoQuality) {
      await ctx.setVideoQuality(page, setVideoQuality);
    }

    // Simulate human behavior before watching
    if (enableHumanBehavior && ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    ctx.emitEvent('log', `Watching video for ${duration}ms at ${targetUrl}`);

    // Watch for the duration
    await this.sleep(duration);

    // Random jitter after watch
    if (jitterMs > 0) {
      await this.sleep(Math.floor(Math.random() * jitterMs));
    }

    // Final human behavior simulation
    if (enableHumanBehavior && ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    return {
      watchedMs: duration,
      targetUrl,
      completedAt: new Date().toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createDefaultContext(tab: any): TaskExecutionContext {
    return {
      isTabValid: () => !tab.closed,
      emitEvent: (kind, data) => console.log(`[${kind}]`, data),
      randomDelay: (minMs: number, maxMs: number) => {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return new Promise(resolve => setTimeout(resolve, delay));
      },
      simulateHumanInteraction: async (page: any) => {
        await page.mouse.move(
          Math.random() * 100 + 50,
          Math.random() * 100 + 50,
          { steps: 5 }
        ).catch(() => {});
      },
      handleYouTubeConsent: async (page: any) => {
        await page.evaluate(() => {
          // Handle YouTube consent/age gate buttons - updated for current YouTube UI (2024+)
// Note: :has-text is not a valid CSS selector in browser environments, so we check textContent manually
          const workingSelectors = [
            'button[aria-label*="Accept all"]',
            'button[aria-label*="Accept everything"]',
            'button[aria-label*="I agree"]',
            'button[aria-label*="Agree"]',
            'button[aria-label*="Accept cookies"]',
            '#accept-button',
            '#agree-button',
            '#yDmH0d button[aria-label*="Accept"]',
            'tp-yt-paper-button[aria-label*="Accept"]',
            'tp-yt-paper-button[aria-label*="Agree"]',
            'ytd-button-renderer[aria-label*="Accept all"]',
            'ytd-button-renderer[aria-label*="I agree"]',
            'ytd-button-renderer[aria-label*="Accept"]',
            'ytd-button-renderer[aria-label*="Agree"]'
          ];

          // Try specific selectors that should work
          workingSelectors.forEach(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach(el => {
                try {
                  (el as HTMLElement).click();
                } catch (e) {
                  // Ignore click errors
                }
              });
            } catch (e) {
              // Ignore selector errors
            }
          });

          // Also check for any button containing consent-related text by examining all buttons
          const allButtons = document.querySelectorAll('button, [role="button"], tp-yt-paper-button, ytd-button-renderer');
          allButtons.forEach(button => {
            const text = button.textContent?.toLowerCase() || '';
            if (text.includes('accept') || text.includes('agree') || text.includes('consent') ||
                text.includes('continue') || text.includes('allow') ||
                text.includes('i agree') || text.includes('accept all') || text.includes('allow all')) {
              try {
                (button as HTMLElement).click();
              } catch (e) {
                // Ignore click errors
              }
            }
          });
        }).catch(() => {});

        // Wait a bit for consent to be processed
        await new Promise(resolve => setTimeout(resolve, 1500));
      },
      clearSessionData: async (page: any) => {
        await page.context().clearCookies();
        await page.evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {}
        });
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