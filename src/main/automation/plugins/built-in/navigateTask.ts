import { IPlugin, ITaskHandler, TaskExecutionContext } from '../basePlugin';
import { setPersistentVideoQuality } from './videoQuality';

export class NavigateTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('NavigateTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      navigate: new NavigateTaskHandler()
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
    const {
      url,
      waitUntil = 'domcontentloaded',
      timeout = 90000, // Increased default timeout for YouTube
      clearSessionFirst = false,
      handleYouTubeConsent = false,
      setVideoQuality = '1080',
    } = task.payload;

    // Parse and validate the URL up front; the hostname is needed for cookie/log scoping below.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`navigate: "${url}" is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `navigate: blocked "${parsed.protocol}" URL — only http:// and https:// are allowed (this task's payload may come from an imported profile)`
      );
    }

    const ctx = context || this.createDefaultContext(tab);

    // Ensure fresh session by clearing cookies for the target domain
    if (clearSessionFirst) {
      await page.context().clearCookies().catch(() => {});
    }

    // Clear site data selectively for fresh session - avoid over-clearing that looks suspicious
    // Gated by clearSessionFirst (matching its intent) and guarded so no storage API can abort navigation
    if (clearSessionFirst) {
      await tab.page.evaluate(() => {
        const safe = (fn: () => void) => {
          try {
            fn();
          } catch {}
        };

        // Clear cookies already handled above via page.context().clearCookies()

        // Clear only specific tracking storages, keep auth/session cookies
        try {
          // Clear localStorage items that look like tracking
          const trackingKeys = ['yt-remote-', 'yt-player-', 'yt-', 'google_ads', '_ga', '_gid', '_gat', 'amp_', '__utma', '__utmb', '__utmc', '__utmz'];
          Object.keys(localStorage).forEach(key => {
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk.toLowerCase()))) {
              localStorage.removeItem(key);
            }
          });
        } catch {}

        try {
          // Clear sessionStorage tracking
          const trackingKeys = ['yt-remote-', 'yt-player-', 'yt-', 'google_ads', '_ga', '_gid', '_gat', 'amp_', '__utma', '__utmb', '__utmc', '__utmz'];
          Object.keys(sessionStorage).forEach(key => {
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk.toLowerCase()))) {
              sessionStorage.removeItem(key);
            }
          });
        } catch {}

        // Note: We don't aggressively clear service workers, cache, or IndexedDB as this
        // looks highly suspicious to websites. Real users don't do this regularly.
        console.log('Selective session data cleared');
      });
    }
    console.log(`Session data cleared for ${parsed.hostname}`);

    if (tab.loopTimer) {
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    // Optionally clear session data for fresh view
    if (clearSessionFirst && ctx.clearSessionData) {
      await ctx.clearSessionData(page);
    }

    // Use longer timeout for YouTube URLs to handle redirects
    const isYouTubeUrl = /youtube\.com|youtu\.be/.test(url);
    const effectiveTimeout = isYouTubeUrl ? 120000 : timeout;
    const effectiveWaitUntil = isYouTubeUrl ? 'networkidle' : waitUntil;

    const urlBefore = page.url();
    try {
      await page.goto(url, { waitUntil: effectiveWaitUntil, timeout: effectiveTimeout });
    } catch (err: any) {
      const message = err?.message ?? '';
      const isTimeout = /Timeout .* exceeded/.test(message);
      const isProxyFailure = /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|net::ERR|401|403|407|502|503|504/.test(message);
      const navigatedAnyway = page.url() !== urlBefore && page.url() !== 'about:blank';

      if (isProxyFailure) {
        // Mark proxy as failed for proxy-specific errors
        if (ctx.markProxyFailed) {
          ctx.markProxyFailed(`Proxy connection failed: ${message}`);
        }
        throw new Error(
          `Proxy connection failed for this tab's assigned proxy — the proxy may be dead or blocking this destination.`
        );
      }
      if (isTimeout && !navigatedAnyway) {
        // Mark proxy as failed for timeout when navigation didn't progress
        if (ctx.markProxyFailed) {
          ctx.markProxyFailed(`Navigation timeout: ${message}`);
        }
      }
      if (!(isTimeout && navigatedAnyway)) throw err;
      console.warn(`navigate timeout on ${url}, but page did load (${page.url()}) — treating as success`);
    }

    // Add delay after navigation to let page settle
    await this.randomDelay(500, 1500);

    // Handle YouTube-specific setup
    if (handleYouTubeConsent && ctx.handleYouTubeConsent) {
      await ctx.handleYouTubeConsent(page);
    }

    // Set video quality for YouTube
    if (setVideoQuality && ctx.setVideoQuality) {
      await ctx.setVideoQuality(page, setVideoQuality);
    }

    // Simulate human behavior after navigation
    if (ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    return { url: page.url() };
  }

  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
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
        // More variable and natural mouse movement
        const targetX = Math.random() * 300 + 100; // 100-400px
        const targetY = Math.random() * 300 + 100; // 100-400px

        // Variable number of steps for more natural movement
        const stepCount = Math.floor(Math.random() * 8) + 3; // 3-10 steps

        await page.mouse.move(
          targetX,
          targetY,
          { steps: stepCount }
        ).catch(() => {});

        // Occasionally add a small click or tap-like movement
        if (Math.random() < 0.3) {
          await page.mouse.move(
            targetX + (Math.random() - 0.5) * 20,
            targetY + (Math.random() - 0.5) * 20,
            { steps: 2 }
          ).catch(() => {});
        }
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