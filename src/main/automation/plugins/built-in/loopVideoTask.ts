// src/main/automation/plugins/built-in/loopVideoTask.ts
import { IPlugin, ITaskHandler, TaskExecutionContext } from '../basePlugin';
import { setPersistentVideoQuality } from './videoQuality';

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
      selector: initialSelector = 'video.html5-main-video, video',
      url,
      maxLoops = 0, // 0 = infinite
      loopDelayMs = 2000, // delay between loops
      enableHumanBehavior = true,
      setVideoQuality = '1080',
      clearSessionFirst = true,
      useYouTubeLoopUrl = true,
      minWatchDurationMs = 0, // Minimum time to watch before reloading (default: 0, will randomize)
      rotateDeviceProfile = false, // Rotate device fingerprint on each loop iteration
    } = task.payload as {
      selector?: string;
      url?: string;
      maxLoops?: number;
      loopDelayMs?: number;
      enableHumanBehavior?: boolean;
      setVideoQuality?: string;
      clearSessionFirst?: boolean;
      useYouTubeLoopUrl?: boolean;
      minWatchDurationMs?: number;
      rotateDeviceProfile?: boolean;
    };

    // Ensure context is available for tab validity checking and event emission
    const ctx = context || this.createDefaultContext(tab);

    // Clear any existing loop timer
    if (tab.loopTimer) {
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    // Remember which URL to reload when the video ends.
    // Prefer the explicitly-passed URL; fall back to whatever is loaded right now.
    const rawReloadUrl = url?.trim() || page.url();
    if (url?.trim()) {
      try {
        const parsed = new URL(rawReloadUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error(
            `loopVideo: blocked "${parsed.protocol}" URL — only http:// and https:// are allowed`
          );
        }
      } catch (err) {
        if (err instanceof TypeError) {
          throw new Error(`loopVideo: "${rawReloadUrl}" is not a valid URL`);
        }
        throw err;
      }
    }

    // For YouTube URLs, extract video ID and construct canonical URL with playlist loop parameter
    // This forces YouTube to replay the SAME video instead of showing recommendations
    function buildYouTubeLoopUrl(inputUrl: string): string {
      if (!useYouTubeLoopUrl) return inputUrl;
      try {
        const parsed = new URL(inputUrl);
        // Handle youtu.be short URLs
        if (parsed.hostname === 'youtu.be') {
          const videoId = parsed.pathname.slice(1).split('?')[0].split('&')[0];
          return `https://www.youtube.com/watch?v=${videoId}&autoplay=1&playlist=${videoId}&loop=1`;
        }
        // Handle youtube.com/watch URLs
        if (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com') {
          if (parsed.pathname === '/watch') {
            const videoId = parsed.searchParams.get('v');
            if (videoId) {
              // Build URL with playlist loop to prevent recommendations
              return `https://www.youtube.com/watch?v=${videoId}&autoplay=1&playlist=${videoId}&loop=1`;
            }
          }
        }
        return inputUrl;
      } catch {
        return inputUrl;
      }
    }

    const reloadUrl = buildYouTubeLoopUrl(rawReloadUrl);
    tab.loopUrl = reloadUrl;

    // Optionally clear session data for fresh view
    if (clearSessionFirst && ctx.clearSessionData) {
      await ctx.clearSessionData(page);
    }

    // Navigate to the video URL if not already there
    // Use longer timeout for YouTube URLs to handle redirects
    const isYouTubeUrl = /youtube\.com|youtu\.be/.test(reloadUrl);
    const effectiveTimeout = isYouTubeUrl ? 120000 : 30_000;
    // Use 'load' (not 'networkidle') for YouTube: an actively streaming / long-run page
    // may never sit network-idle, which used to make page.goto time out after 90s and
    // leave the loop in a half-loaded state. The video is waited for explicitly below.
    const effectiveWaitUntil = isYouTubeUrl ? 'load' : 'domcontentloaded';

    // Retry navigation on failure with proxy rotation
    let initialNavSuccess = false;
    let initialNavAttempts = 0;
    const maxInitialNavAttempts = 3;

    while (!initialNavSuccess && initialNavAttempts < maxInitialNavAttempts) {
      try {
        if (page.url() !== reloadUrl) {
          await page.goto(reloadUrl, { waitUntil: effectiveWaitUntil, timeout: effectiveTimeout });
        }

        // Handle YouTube consent/age gates
        if (ctx.handleYouTubeConsent) {
          await ctx.handleYouTubeConsent(page);
        }

        initialNavSuccess = true;
      } catch (navErr: any) {
        initialNavAttempts++;
        const message = navErr?.message ?? '';
        // Check for any network/proxy/error that might benefit from retry
        // ERR_INVALID_ARGUMENT is a configuration error (invalid URL/proxy config/navigation options),
        // not a transient network failure - don't retry on it
        const isRetryableError = /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|net::ERR|401|403|407|502|503|504/.test(message);

        if (isRetryableError && initialNavAttempts < maxInitialNavAttempts) {
          ctx.emitEvent('log', `Initial navigation failed (attempt ${initialNavAttempts}/${maxInitialNavAttempts}), marking proxy failed: ${navErr.message}`);
          // Mark proxy as failed so it gets rotated
          if (ctx.markProxyFailed) {
            ctx.markProxyFailed(`Navigation failed: ${navErr.message}`);
          }
          // The proxy manager should handle rotation, try again
          await ctx.randomDelay(2000, 5000);
          continue;
        }
        throw navErr;
      }
    }

    if (!initialNavSuccess) {
      throw new Error(`Failed to navigate after ${maxInitialNavAttempts} attempts`);
    }

    // Check if the video element exists and is actually a video element
    // Try multiple selectors for YouTube's various player implementations
    const videoSelectors = [
      initialSelector,
      'video.html5-main-video',
      'video[class*="html5-main-video"]',
      'video.html5-video-player',
      'video[data-is-autoplayable]',
      '#movie_player video',
      '.html5-video-container video',
      '#movie_player .html5-main-video',
      'ytd-player video',
      '#player video',
      'video', // Fallback to any video element
    ];

    let selector = initialSelector; // Will be updated to the working selector
    let videoElement = null;
    let usedSelector = '';

    // First attempt: immediate check
    for (const sel of videoSelectors) {
      const exists = await page.evaluate((s: string) => {
        const el = document.querySelector(s);
        return el && el instanceof HTMLVideoElement;
      }, sel);
      if (exists) {
        videoElement = sel;
        usedSelector = sel;
        break;
      }
    }

    // If not found, wait for YouTube player to fully initialize
    // YouTube loads the player asynchronously, so we need to wait longer
    if (!videoElement) {
      ctx.emitEvent('log', 'Video element not found immediately, waiting for player to initialize...');
      // Wait up to 15 seconds for video element, checking every 500ms
      const startWait = Date.now();
      const maxWait = 15000;
      while (!videoElement && Date.now() - startWait < maxWait) {
        await page.waitForTimeout(500);

        // Check if we're on an error page that would prevent video loading
        const pageState = await page.evaluate(() => {
          // Check for Google sad page (sorry/interstitial)
          if (window.location.hostname.includes('google.com') &&
              window.location.pathname.includes('/sorry/index')) {
            return { type: 'google_sorry', message: 'Google blocking requests' };
          }

          // Check for CAPTCHA
          const captchaSelectors = [
            '#captcha-form',
            '.captcha-box',
            '[aria-label*="CAPTCHA"]',
            '[aria-label*="captcha"]',
            'iframe[src*="recaptcha"]',
            'iframe[src*="google.com/recaptcha"]'
          ];
          for (const selector of captchaSelectors) {
            if (document.querySelector(selector)) {
              return { type: 'captcha', message: 'CAPTCHA detected' };
            }
          }

          // Check for YouTube unavailable messages
          const unavailableMessages = [
            'Video unavailable',
            'This video is not available',
            'Please sign in to confirm your age',
            'This content is not available',
            'Video not available',
            'Sign in to confirm you’re not a bot',
            'To continue to YouTube',
            'Check your connection'
          ];
          const pageText = document.body.innerText || '';
          for (const msg of unavailableMessages) {
            if (pageText.includes(msg)) {
              return { type: 'unavailable', message: msg };
            }
          }

          // Check if we're on a consent/age gate page
          const consentSelectors = [
            'tp-yt-paper-dialog',
            '#consent-bump',
            '.consent-bump',
            '[data-testid="consent-bump"]',
            'ytd-consent-lightspeed-button-renderer',
            'div[role="dialog"]'
          ];
          for (const selector of consentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              // Additional check for age confirmation dialogs
              const text = element.textContent?.toLowerCase() || '';
              if (text.includes('confirm your age') || text.includes('sign in to confirm your age')) {
                return { type: 'consent', message: 'Consent/age gate required' };
              }
              // If it's a general consent dialog without specific age text, still treat as consent
              if (selector === 'tp-yt-paper-dialog' || selector === '#consent-bump' ||
                  selector === '.consent-bump' || selector === '[data-testid="consent-bump"]' ||
                  selector === 'ytd-consent-lightspeed-button-renderer') {
                return { type: 'consent', message: 'Consent/age gate required' };
              }
            }
          }

          return null;
        });

        if (pageState) {
          ctx.emitEvent('log', `Detected ${pageState.type}: ${pageState.message}`);
          // For certain states, we might want to break early or handle differently
          if (pageState.type === 'google_sorry' || pageState.type === 'captcha') {
            break; // Stop waiting as these won't resolve by waiting for video
          }
          // For consent/unavailable, continue waiting as they might resolve
        }

        for (const sel of videoSelectors) {
          const exists = await page.evaluate((s: string) => {
            const el = document.querySelector(s);
            return el && el instanceof HTMLVideoElement;
          }, sel);
          if (exists) {
            videoElement = sel;
            usedSelector = sel;
            break;
          }
        }
      }
    }

    if (!videoElement) {
      // Provide more specific error information
      const pageUrl = page.url();
      let errorMessage = `No <video> element found for any selector (tried: ${videoSelectors.join(', ')})`;
      if (pageUrl.includes('google.com/sorry/index')) {
        errorMessage += ' - YouTube is blocking requests (showing Google sorry page). Proxy may be blocked or flagged.';
      } else if (pageUrl.includes('youtube.com')) {
        errorMessage += ' - On YouTube but no video element found. May be age-restricted, unavailable, or blocked.';
      } else {
        errorMessage += ` - Current URL: ${pageUrl}`;
      }
      throw new Error(errorMessage);
    }

    // Update the selector for subsequent operations
    selector = usedSelector;

    // Wait for YouTube player API to be ready (the player may not be interactive immediately)
    if (isYouTubeUrl) {
      ctx.emitEvent('log', 'Waiting for YouTube player API to initialize...');
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

    // Handle YouTube consent/age gates before starting
    if (ctx.handleYouTubeConsent) {
      await ctx.handleYouTubeConsent(page);
    }

    let loopCount = 0;
    let isStopped = false;

    // Store loop state on tab for stopLoopVideo to access
    tab.loopVideoState = {
      isRunning: true,
      loopCount: 0,
      stopRequested: false,
    };

    // Named function so it can reschedule itself cleanly after a full-page reload.
    const tick = async (): Promise<void> => {
      // Check if tab is still valid - use both context check and direct tab check for robustness
      const contextValid = ctx.isTabValid ? ctx.isTabValid() : true;
      if (!contextValid || tab.closed || tab.loopVideoState?.stopRequested) {
        if (tab.loopTimer) {
          clearInterval(tab.loopTimer);
          tab.loopTimer = undefined;
        }
        tab.loopVideoState = { ...tab.loopVideoState, isRunning: false };
        ctx.emitEvent('result', { taskId: task.id, stopped: true, loopsCompleted: loopCount });
        return;
      }

      try {
        // Re-detect video element if not found with current selector (page structure may have changed)
        let videoState = await page.evaluate((sel: string): { state: string; currentTime: number; duration: number } => {
          const el = document.querySelector(sel);
          if (!el || !(el instanceof HTMLVideoElement)) {
            return { state: 'no-video', currentTime: 0, duration: 0 };
          }
          const video = el as HTMLVideoElement;
          if (!video.duration || Number.isNaN(video.duration)) return { state: 'no-video', currentTime: 0, duration: 0 };
          if (video.error) {
            return { state: 'error', currentTime: video.currentTime, duration: video.duration };
          }

          // Check for YouTube error messages in the page
          const pageText = document.body.innerText || '';
          if (pageText.toLowerCase().includes('something went wrong')) {
            return { state: 'error', currentTime: video.currentTime, duration: video.duration };
          }

          const remaining = video.duration - video.currentTime;
          if (remaining < 0.75 || video.ended) return { state: 'ended', currentTime: video.currentTime, duration: video.duration };
          if (video.paused && !video.seeking) video.play().catch(() => {});
          return { state: 'playing', currentTime: video.currentTime, duration: video.duration };
        }, selector);

        // If video element not found, try to re-detect it
        if (videoState.state === 'no-video') {
          ctx.emitEvent('log', 'Video element not found with current selector, re-detecting...');
          const videoSelectors = [
            selector,
            'video.html5-main-video',
            'video[class*="html5-main-video"]',
            'video.html5-video-player',
            'video[data-is-autoplayable]',
            '#movie_player video',
            '.html5-video-container video',
            '#movie_player .html5-main-video',
            'ytd-player video',
            '#player video',
            'video',
          ];

          for (const sel of videoSelectors) {
            videoState = await page.evaluate((s: string): { state: string; currentTime: number; duration: number } => {
              const el = document.querySelector(s);
              if (!el || !(el instanceof HTMLVideoElement)) {
                return { state: 'no-video', currentTime: 0, duration: 0 };
              }
              const video = el as HTMLVideoElement;
              if (!video.duration || Number.isNaN(video.duration)) return { state: 'no-video', currentTime: 0, duration: 0 };
              if (video.error) {
                return { state: 'error', currentTime: video.currentTime, duration: video.duration };
              }

              // Check for YouTube error messages in the page
              const pageText = document.body.innerText || '';
              if (pageText.toLowerCase().includes('something went wrong')) {
                return { state: 'error', currentTime: video.currentTime, duration: video.duration };
              }

              const remaining = video.duration - video.currentTime;
              if (remaining < 0.75 || video.ended) return { state: 'ended', currentTime: video.currentTime, duration: video.duration };
              if (video.paused && !video.seeking) video.play().catch(() => {});
              return { state: 'playing', currentTime: video.currentTime, duration: video.duration };
            }, sel);

            if (videoState.state !== 'no-video') {
              selector = sel; // Update selector for future ticks
              break;
            }
          }
        }

        if ((videoState.state === 'ended' || videoState.state === 'error' || videoState.state === 'no-video') && !tab.closed && !tab.loopVideoState?.stopRequested) {
          // Pause polling while we reload the page as a fresh session.
          if (tab.loopTimer) {
            clearInterval(tab.loopTimer);
            tab.loopTimer = undefined;
          }

          ctx.emitEvent('log', `Video ${videoState.state}, restarting tab for loop ${loopCount + 1}`);

          // Human-like delay before reload (simulate user thinking/clicking)
          await ctx.randomDelay(1500, 4000);

          // Bring the tab to the foreground before reloading. In a backgrounded tab Chromium
          // (a) throttles timers down to ~1/min, which stalls the navigation below, and
          // (b) blocks YouTube's autoplay-with-sound for a freshly loaded document (no user
          //     gesture), dropping the player into the paused "[Press space] to play" overlay —
          //     the exact "I have to click the tab to start it" behaviour. Making the page the
          //     active tab before navigating lets the reloaded page autoplay normally and lets
          //     the navigation complete unthrottled.
          await page.bringToFront().catch(() => {});

          // Occasional mouse movement before navigation
          if (enableHumanBehavior && ctx.simulateHumanInteraction && Math.random() < 0.7) {
            await ctx.simulateHumanInteraction(page);
          }

          const target = tab.loopUrl!;

          // DEVICE PROFILE ROTATION - If enabled, simulate a new device fingerprint
          // by overriding navigator properties before navigation
          if (rotateDeviceProfile) {
            await page.evaluate(() => {
              // Generate a randomized device profile
              const deviceProfiles = [
                // Mobile devices
                {
                  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                  viewport: { width: 390, height: 844 },
                  deviceScaleFactor: 3,
                  isMobile: true,
                },
                {
                  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
                  viewport: { width: 412, height: 915 },
                  deviceScaleFactor: 3.5,
                  isMobile: true,
                },
                // Desktop devices
                {
                  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                  viewport: { width: 1920, height: 1080 },
                  deviceScaleFactor: 1,
                  isMobile: false,
                },
                {
                  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                  viewport: { width: 1440, height: 900 },
                  deviceScaleFactor: 2,
                  isMobile: false,
                },
                {
                  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                  viewport: { width: 1366, height: 768 },
                  deviceScaleFactor: 1,
                  isMobile: false,
                }
              ];

              const profile = deviceProfiles[Math.floor(Math.random() * deviceProfiles.length)];

              // Override navigator properties to simulate different device
              if ('navigator' in globalThis) {
                Object.defineProperty(navigator, 'userAgent', {
                  get: () => profile.userAgent,
                  configurable: true
                });

                Object.defineProperty(navigator, 'platform', {
                  get: () => profile.userAgent.includes('Windows') ? 'Win32' :
                           profile.userAgent.includes('Macintosh') ? 'MacIntel' :
                           profile.userAgent.includes('Linux') ? 'Linux x86_64' : 'Win32',
                  configurable: true
                });

                Object.defineProperty(navigator, 'hardwareConcurrency', {
                  get: () => profile.isMobile ? 4 + Math.floor(Math.random() * 4) : 8 + Math.floor(Math.random() * 16),
                  configurable: true
                });

                Object.defineProperty(navigator, 'deviceMemory', {
                  get: () => profile.isMobile ? 4 + Math.floor(Math.random() * 4) : 8 + Math.floor(Math.random() * 32),
                  configurable: true
                });
              }

              // Override screen properties
              if ('screen' in globalThis) {
                Object.defineProperty(screen, 'width', {
                  get: () => profile.viewport.width,
                  configurable: true
                });

                Object.defineProperty(screen, 'height', {
                  get: () => profile.viewport.height,
                  configurable: true
                });

                Object.defineProperty(screen, 'availWidth', {
                  get: () => profile.viewport.width,
                  configurable: true
                });

                Object.defineProperty(screen, 'availHeight', {
                  get: () => profile.viewport.height - 40,
                  configurable: true
                });
              }
            });
          }

          try {
            // PARTIAL session clear - only clear tracking data, keep cookies for session persistence
            // Full clearing looks suspicious; real users don't clear everything on every reload
            // Keep cookies for session persistence - cleared selectively via localStorage/sessionStorage if needed

            // Clear only specific tracking storages, keep auth/session cookies
            await page.evaluate(() => {
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
            }).catch(() => {});

            // Full page navigation — browser discards all in-page state,
            // starts a brand-new request/session to the site.
            let navigationSuccess = false;
            let navAttempts = 0;
            const maxNavAttempts = 3;
            const isYouTubeUrl = /youtube\.com|youtu\.be/.test(target);
            const navTimeout = isYouTubeUrl ? 90000 : 30_000;
            // Use 'load' (not 'networkidle') for YouTube: an actively streaming / long-run page
            // may never sit network-idle, which used to make page.goto time out after 90s and
            // leave the loop in a half-loaded state. The video is waited for explicitly below.
            const navWaitUntil = isYouTubeUrl ? 'load' : 'domcontentloaded';

            while (!navigationSuccess && navAttempts < maxNavAttempts) {
              try {
                await page.goto(target, { waitUntil: navWaitUntil, timeout: navTimeout });
                navigationSuccess = true;
              } catch (navErr: any) {
                navAttempts++;
                const message = navErr?.message ?? '';
                // Check for any network/proxy/error that might benefit from retry
                // ERR_INVALID_ARGUMENT is a configuration error (invalid URL/proxy config/navigation options),
                // not a transient network failure - don't retry on it
                const isRetryableError = /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|net::ERR|401|403|407|502|503|504/.test(message);

                if (isRetryableError && navAttempts < maxNavAttempts) {
                  ctx.emitEvent('log', `Navigation failed (attempt ${navAttempts}/${maxNavAttempts}), marking proxy failed: ${navErr.message}`);
                  // Mark proxy as failed so it gets rotated
                  if (ctx.markProxyFailed) {
                    ctx.markProxyFailed(`Navigation failed: ${navErr.message}`);
                  }
                  // The proxy manager should handle rotation, try again
                  await ctx.randomDelay(2000, 5000);
                  continue;
                }
                throw navErr;
              }
            }

            if (!navigationSuccess) {
              throw new Error(`Failed to navigate after ${maxNavAttempts} attempts`);
            }

            // Re-detect video element after reload (page structure might change)
            // Try multiple selectors for YouTube's various player implementations
            const videoSelectors = [
              selector, // Try the previously working selector first
              'video.html5-main-video',
              'video[class*="html5-main-video"]',
              'video.html5-video-player',
              'video[data-is-autoplayable]',
              '#movie_player video',
              '.html5-video-container video',
              '#movie_player .html5-main-video',
              'ytd-player video',
              '#player video',
              'video', // Fallback to any video element
            ];

            let videoFound = false;
            let usedSelector = selector;
            for (const sel of videoSelectors) {
              const exists = await page.evaluate((s: string) => {
                const el = document.querySelector(s);
                return el && el instanceof HTMLVideoElement;
              }, sel);
              if (exists) {
                videoFound = true;
                usedSelector = sel;
                break;
              }
            }

            // If not found immediately, wait for YouTube player to fully initialize
            if (!videoFound) {
              ctx.emitEvent('log', 'Video element not found after reload, waiting for player to initialize...');
              // Wait up to 15 seconds for video element, checking every 500ms
              const startWait = Date.now();
              const maxWait = 15000;
              while (!videoFound && Date.now() - startWait < maxWait) {
                await page.waitForTimeout(500);

                // Check if we're on an error page that would prevent video loading
                const pageState = await page.evaluate(() => {
                  // Check for Google sad page (sorry/interstitial)
                  if (window.location.hostname.includes('google.com') &&
                      window.location.pathname.includes('/sorry/index')) {
                    return { type: 'google_sorry', message: 'Google blocking requests' };
                  }

                  // Check for CAPTCHA
                  const captchaSelectors = [
                    '#captcha-form',
                    '.captcha-box',
                    '[aria-label*="CAPTCHA"]',
                    '[aria-label*="captcha"]',
                    'iframe[src*="recaptcha"]',
                    'iframe[src*="google.com/recaptcha"]'
                  ];
                  for (const selector of captchaSelectors) {
                    if (document.querySelector(selector)) {
                      return { type: 'captcha', message: 'CAPTCHA detected' };
                    }
                  }

                  // Check for YouTube unavailable messages
                  const pageText = document.body.innerText || '';
                  // Check for "something went wrong" error
                  if (pageText.toLowerCase().includes('something went wrong')) {
                    return { type: 'error', message: 'Something went wrong' };
                  }
                  const unavailableMessages = [
                    'Video unavailable',
                    'This video is not available',
                    'Please sign in to confirm your age',
                    'This content is not available',
                    'Video not available',
                    'Sign in to confirm you’re not a bot',
                    'To continue to YouTube',
                    'Check your connection'
                  ];
                  for (const msg of unavailableMessages) {
                    if (pageText.includes(msg)) {
                      return { type: 'unavailable', message: msg };
                    }
                  }

                  // Check if we're on a consent/age gate page
                  const consentSelectors = [
                    'tp-yt-paper-dialog',
                    '#consent-bump',
                    '.consent-bump',
                    '[data-testid="consent-bump"]',
                    'ytd-consent-lightspeed-button-renderer',
                    'div[role="dialog"]'
                  ];
                  for (const selector of consentSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                      // Additional check for age confirmation dialogs
                      const text = element.textContent?.toLowerCase() || '';
                      if (text.includes('confirm your age') || text.includes('sign in to confirm your age')) {
                        return { type: 'consent', message: 'Consent/age gate required' };
                      }
                      // If it's a general consent dialog without specific age text, still treat as consent
                      if (selector === 'tp-yt-paper-dialog' || selector === '#consent-bump' ||
                          selector === '.consent-bump' || selector === '[data-testid="consent-bump"]' ||
                          selector === 'ytd-consent-lightspeed-button-renderer') {
                        return { type: 'consent', message: 'Consent/age gate required' };
                      }
                    }
                  }

                  return null;
                });

                if (pageState) {
                  ctx.emitEvent('log', `Detected ${pageState.type}: ${pageState.message}`);
                  // For certain states, we might want to break early or handle differently
                  if (pageState.type === 'google_sorry' || pageState.type === 'captcha') {
                    break; // Stop waiting as these won't resolve by waiting for video
                  }
                  // For consent/unavailable, continue waiting as they might resolve
                }

                for (const sel of videoSelectors) {
                  const exists = await page.evaluate((s: string) => {
                    const el = document.querySelector(s);
                    return el && el instanceof HTMLVideoElement;
                  }, sel);
                  if (exists) {
                    videoFound = true;
                    usedSelector = sel;
                    break;
                  }
                }
              }
            }

            if (!videoFound) {
              // Provide more specific error information
              const pageUrl = page.url();
              let errorMessage = `No <video> element found after reload for any selector (tried: ${videoSelectors.join(', ')})`;
              if (pageUrl.includes('google.com/sorry/index')) {
                errorMessage += ' - YouTube is blocking requests (showing Google sorry page). Proxy may be blocked or flagged.';
              } else if (pageUrl.includes('youtube.com')) {
                errorMessage += ' - On YouTube but no video element found. May be age-restricted, unavailable, or blocked.';
              } else {
                errorMessage += ` - Current URL: ${pageUrl}`;
              }
              throw new Error(errorMessage);
            }

            // Update the selector for subsequent operations
            selector = usedSelector;

            // Handle YouTube consent/age gates after reload
            if (ctx.handleYouTubeConsent) {
              await ctx.handleYouTubeConsent(page);
            }

            // Wait for YouTube player API to be ready
            if (isYouTubeUrl) {
              await page.waitForFunction(() => {
                const player = document.getElementById('movie_player') as any || document.querySelector('.html5-video-player') as any;
                return player && typeof player.setPlaybackQuality === 'function';
              }, { timeout: 15000 }).catch(() => {
                ctx.emitEvent('log', 'YouTube player API not fully ready after reload, continuing anyway...');
              });
            }

            // Set video quality on reload
            if (setVideoQuality && ctx.setVideoQuality) {
              await ctx.setVideoQuality(page, setVideoQuality);
            }

            // Attempt to start playback.
            await page.evaluate((sel: string) => {
              const el = document.querySelector(sel);
              if (el && el instanceof HTMLVideoElement) {
                (el as HTMLVideoElement).play().catch(() => {});
              }
            }, selector).catch(() => {});

            // A fresh page (new document) has no user-gesture history, so its autoplay may have
            // been blocked and left the player paused ("[Press space] to play"). Verify it is
            // actually playing; if not, bring the page to front (grants it activation) and
            // replay. Without this the reload "succeeded" but sat paused until a manual click.
            await page
              .evaluate((sel: string) => {
                const el = document.querySelector(sel);
                return !!(el && el instanceof HTMLVideoElement && !el.paused);
              }, selector)
              .then(async (playing: boolean) => {
                if (!playing) {
                  await page.bringToFront().catch(() => {});
                  await page
                    .evaluate((sel: string) => {
                      const el = document.querySelector(sel);
                      if (el && el instanceof HTMLVideoElement) {
                        (el as HTMLVideoElement)
                          .play()
                          .then(() => {})
                          .catch((e: any) => undefined);
                      }
                    }, selector)
                    .catch(() => {});
                }
              })
              .catch(() => {});

            // WATCH DURATION TRACKING WITH REALISTIC SCROLL BEHAVIOR - Ensure minimum watch time before counting as loop
            let effectiveMinWatchDuration = minWatchDurationMs;
            if (effectiveMinWatchDuration <= 0) {
              // Randomize between 60-90 seconds if not specified
              effectiveMinWatchDuration = 60000 + Math.floor(Math.random() * 30000);
            }

            // Scroll behavior during video playback - makes viewing look more natural
            ctx.emitEvent('log', `View started - ensuring minimum watch duration of ${effectiveMinWatchDuration}ms with realistic scroll behavior`);

            // Break the watch duration into smaller intervals with periodic scrolling
            const totalDuration = effectiveMinWatchDuration;
            let elapsedTime = 0;
            const scrollIntervalBase = 8000; // Base interval between scrolls (8 seconds)
            const scrollIntervalVariance = 4000; // +/- 4 seconds variance

            while (elapsedTime < totalDuration && !tab.closed && !tab.loopVideoState?.stopRequested) {
              // Calculate remaining time
              const remainingTime = totalDuration - elapsedTime;

              // Determine next interval - either a scroll interval or the remaining time if it's short
              const nextInterval = Math.min(
                scrollIntervalBase + Math.floor(Math.random() * scrollIntervalVariance * 2) - scrollIntervalVariance,
                remainingTime
              );

              // Wait for the interval
              if (nextInterval > 100) { // Only wait if interval is meaningful
                await ctx.randomDelay(nextInterval, nextInterval + 500); // Small jitter
                elapsedTime += nextInterval;
              }

              // If we've reached the total duration, break
              if (elapsedTime >= totalDuration) {
                break;
              }

              // Perform realistic scroll behavior during playback (simulate user engagement)
              if (enableHumanBehavior && ctx.simulateHumanInteraction && Math.random() < 0.7) { // 70% chance to scroll
                try {
                  // Occasionally perform more complex scroll patterns
                  if (Math.random() < 0.3) { // 30% chance for complex scroll pattern
                    await page.evaluate(() => {
                      // Simulate reading comments or related videos by scrolling in a pattern
                      const scrollPatterns = [
                        () => window.scrollBy(0, 100), // Scroll down
                        () => window.scrollBy(0, -50), // Scroll up slightly
                        () => window.scrollBy(0, 200), // Scroll down more
                        () => window.scrollBy(0, -100), // Scroll up
                        () => { /* pause */ }
                      ];

                      const patternLength = Math.floor(Math.random() * 3) + 2; // 2-4 actions
                      for (let i = 0; i < patternLength; i++) {
                        const actionIndex = Math.floor(Math.random() * scrollPatterns.length);
                        if (scrollPatterns[actionIndex]) {
                          scrollPatterns[actionIndex]();
                        }
                        // Small delay between scroll actions
                        const scrollDelay = 300 + Math.random() * 700;
                        return new Promise(resolve => setTimeout(resolve, scrollDelay));
                      }
                    }).catch(() => {});
                  } else {
                    // Simple scroll action
                    await ctx.simulateHumanInteraction(page);
                  }
                } catch (scrollErr) {
                  // Ignore scroll errors to prevent interrupting playback
                  ctx.emitEvent('log', `Scroll behavior error: ${(scrollErr as Error).message}`);
                }
              }

              // Periodically check and maintain tab visibility/focus to prevent YouTube from detecting hidden playback
              if (enableHumanBehavior && ctx.simulateHumanInteraction && Math.random() < 0.2) { // 20% chance
                try {
                  const visibilityState = await page.evaluate(() => {
                    return {
                      hidden: document.hidden,
                      visibilityState: document.visibilityState,
                      hasFocus: document.hasFocus()
                    };
                  });

                  if (visibilityState.hidden || visibilityState.visibilityState !== 'visible' || !visibilityState.hasFocus) {
                    // Tab is not visible or not focused, bring to front and engage
                    await page.bringToFront().catch(() => {});

                    // Simulate user interaction to re-engage
                    if (ctx.simulateHumanInteraction) {
                      await ctx.simulateHumanInteraction(page);
                    }

                    // Small pause after bringing to front
                    await ctx.randomDelay(500, 1500);
                  }
                } catch (visibilityErr) {
                  // Ignore visibility errors to prevent interrupting playback
                  ctx.emitEvent('log', `Tab visibility check error: ${(visibilityErr as Error).message}`);
                }
              }
            }

            loopCount++;
            tab.loopVideoState = { ...tab.loopVideoState, loopCount };

            ctx.emitEvent('result', { taskId: task.id, loopCount, status: 'loop_completed' });

            // Check if we've reached max loops
            if (maxLoops > 0 && loopCount >= maxLoops) {
              ctx.emitEvent('log', `Reached max loops (${maxLoops}), stopping`);
              isStopped = true;
              tab.loopVideoState = { ...tab.loopVideoState, isRunning: false };
              // Tear down the polling interval so the loop actually stays stopped
              // (otherwise tick keeps firing and the video restarts forever).
              if (tab.loopTimer) {
                clearInterval(tab.loopTimer);
                tab.loopTimer = undefined;
              }
              ctx.emitEvent('result', { taskId: task.id, stopped: true, loopsCompleted: loopCount, reason: 'max_loops_reached' });
              return;
            }

            // Add delay between loops with jitter to look less robotic - use more human-like distribution
            const baseDelay = loopDelayMs + Math.floor(Math.random() * 3000);
            // Add some rare longer pauses (simulate user taking a break)
            const finalDelay = Math.random() < 0.05 ? baseDelay * 3 + Math.random() * 10000 : baseDelay;
            await ctx.randomDelay(finalDelay, finalDelay + 2000);

          } catch (err) {
            ctx.emitEvent('error', `Loop navigation failed: ${err}`);
            // Navigation failed; we'll retry on next cycle
          }

          // Restart polling only if the tab is still alive after reload and not stopped.
          // Use variable polling interval (simulate human checking)
          if (!tab.closed && !tab.loopVideoState?.stopRequested && !isStopped) {
            // Variable interval: sometimes quick check, sometimes slower
            const baseInterval = 8000 + Math.random() * 4000; // 8000-12000ms
            // Rarely much longer (user distraction)
            const interval = Math.random() < 0.005 ? baseInterval * 8 : baseInterval;
            // Occasional quick check for responsiveness
            const finalInterval = Math.random() < 0.01 ? baseInterval * 0.2 : interval;
            tab.loopTimer = setInterval(tick, finalInterval);

            // Simulate human behavior on new page load
            if (enableHumanBehavior && ctx.simulateHumanInteraction) {
              await ctx.simulateHumanInteraction(page);
            }
          }
        }
      } catch (err) {
        // Page mid-navigation — safe to skip a tick, but don't silently swallow errors
        ctx.emitEvent('log', `Tick check error: ${err}`);
      }
    };

    // Initial delay before starting the loop with human-like jitter - longer and variable
    await ctx.randomDelay(2000, 5000);

    // Check if tab is still valid before starting - use both context check and direct tab check
    // The context check might fail temporarily during navigation, so we also check tab.closed directly
    if ((ctx.isTabValid && !ctx.isTabValid()) && tab.closed) {
      throw new Error('Tab closed before loop could start');
    }
    if (tab.closed) {
      throw new Error('Tab closed before loop could start');
    }

    // Initial human behavior simulation
    if (enableHumanBehavior && ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    // Start the polling interval - variable interval
    const baseInterval = 8000 + Math.random() * 4000;
    const interval = Math.random() < 0.005 ? baseInterval * 8 : baseInterval;
    tab.loopTimer = setInterval(tick, interval);

    // Simulate initial human behavior
    if (enableHumanBehavior && ctx.simulateHumanInteraction) {
      await ctx.simulateHumanInteraction(page);
    }

    ctx.emitEvent('log', `Started video loop on ${reloadUrl}`);

    // The loop is driven entirely by the polling timer (tab.loopTimer). It must
    // NOT hold the per-tab task queue open: a `stopLoopVideo` task queues behind
    // this one on the same tab, so this promise has to resolve immediately to let
    // the stop handler run (it sets stopRequested and clears the timer). Tab
    // closure and max-loops are reconciled inside `tick` itself.
    return { looping: true, selector, reloadUrl, loopsCompleted: loopCount };
  }

  private createDefaultContext(tab: any): TaskExecutionContext {
    // Generate a unique session ID for this loop to track persistent behavior
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Local helper functions for human-like behavior
    const humanMouseMove = async (page: any, w: number, h: number) => {
      const points = 3 + Math.floor(Math.random() * 5); // 3-7 points
      const startX = Math.random() * w * 0.8 + w * 0.1;
      const startY = Math.random() * h * 0.8 + h * 0.1;
      const endX = Math.random() * w * 0.8 + w * 0.1;
      const endY = Math.random() * h * 0.8 + h * 0.1;

      // Generate bezier control points
      const controlX1 = startX + (Math.random() - 0.5) * 200;
      const controlY1 = startY + (Math.random() - 0.5) * 200;
      const controlX2 = endX + (Math.random() - 0.5) * 200;
      const controlY2 = endY + (Math.random() - 0.5) * 200;

      // Move through the curve with variable steps for more natural movement
      for (let i = 0; i <= points; i++) {
        const t = i / points;
        const x = Math.pow(1-t, 3) * startX + 3*Math.pow(1-t, 2)*t * controlX1 + 3*(1-t)*Math.pow(t, 2) * controlX2 + Math.pow(t, 3) * endX;
        const y = Math.pow(1-t, 3) * startY + 3*Math.pow(1-t, 2)*t * controlY1 + 3*(1-t)*Math.pow(t, 2) * controlY2 + Math.pow(t, 3) * endY;

        // Variable number of steps: sometimes smooth (5-15 steps), sometimes direct (1 step)
        const stepCount = Math.random() < 0.7 ? Math.floor(Math.random() * 10) + 5 : 1;
        await page.mouse.move(x, y, { steps: stepCount }).catch(() => {});

        // Variable delay that follows more human-like distribution (skewed toward shorter delays)
        const baseDelay = 20 + Math.random() * 80;
        const delayVariation = Math.pow(Math.random(), 2) * 100; // Skewed toward 0
        const delay = baseDelay + delayVariation;
        await new Promise(r => setTimeout(r, delay));
      }
    };

    const humanScroll = async (page: any) => {
      // Variable scroll amount with more natural distribution
      const scrollRange = Math.random() < 0.8 ? 200 : 500; // Mostly small scrolls, occasional large ones
      const scrollAmount = (Math.random() - 0.5) * scrollRange;

      // Variable number of steps with more natural timing
      const stepCount = Math.floor(Math.random() * 5) + 2; // 2-6 steps

      for (let i = 0; i < stepCount; i++) {
        // Variable step size - not uniform distribution
        const stepAmount = scrollAmount / stepCount + (Math.random() - 0.5) * 20;
        await page.evaluate((amt: number) => window.scrollBy(0, amt), stepAmount).catch(() => {});

        // More human-like delay distribution
        const baseDelay = 30 + Math.random() * 100;
        const delayVariation = Math.pow(Math.random(), 1.5) * 50; // Skewed toward shorter delays
        const delay = baseDelay + delayVariation;
        await new Promise(r => setTimeout(r, delay));
      }
    };

    return {
      isTabValid: () => !tab.closed,
      emitEvent: (kind, data) => {
        // We can't emit events directly here without access to the emitter
        // This will be properly connected when called from TabManager
        console.log(`[${kind}]`, data);
      },
      randomDelay: (minMs: number, maxMs: number) => {
        // Use more human-like delay distribution (log-normal-ish)
        const range = maxMs - minMs;
        const skew = Math.pow(Math.random(), 3); // Skew toward shorter delays
        const delay = Math.floor(minMs + skew * range);
        return new Promise(resolve => setTimeout(resolve, delay));
      },
      simulateHumanInteraction: async (page: any) => {
        try {
          // More realistic human behavior: compound actions with variable timing
          const viewportWidth = 1920; // default, will be overridden by actual
          const viewportHeight = 1080;

          // Human-like mouse movement with bezier curves
          await humanMouseMove(page, viewportWidth, viewportHeight);

          // Occasional realistic scroll patterns
          if (Math.random() < 0.3) {
            await humanScroll(page);
          }

          // Rare keyboard interaction
          if (Math.random() < 0.1) {
            await page.keyboard.press('Space').catch(() => {});
          }

          // Occasional focus change simulation
          if (Math.random() < 0.15) {
            await page.evaluate(() => {
              window.dispatchEvent(new Event('blur'));
              setTimeout(() => window.dispatchEvent(new Event('focus')), 100 + Math.random() * 500);
            });
          }
        } catch (e) {
          // Ignore errors in human simulation
        }
      },
      handleYouTubeConsent: async (page: any) => {
        await page.evaluate(() => {
          // Handle YouTube consent/age gate buttons - updated for current YouTube UI (2024+)
          const selectors = [
            // Main consent dialog
            'button[aria-label*="Accept all"]',
            'button[aria-label*="Accept everything"]',
            'button[aria-label*="I agree"]',
            'button[aria-label*="Agree"]',
            'button:contains("Accept all")',
            'button:contains("Accept everything")',
            'button:contains("I agree")',
            'button:contains("Agree")',
            'ytd-button-renderer:contains("Accept all")',
            'ytd-button-renderer:contains("I agree")',
            'ytd-button-renderer:contains("Accept")',
            'ytd-button-renderer:contains("Agree")',
            // Material design buttons
            'tp-yt-paper-button[aria-label*="Accept"]',
            'tp-yt-paper-button[aria-label*="Agree"]',
            'tp-yt-paper-button:contains("Accept all")',
            'tp-yt-paper-button:contains("I agree")',
            // IDs
            '#accept-button',
            '#agree-button',
            '#yDmH0d button[aria-label*="Accept"]',
            // Cookie consent (EU)
            'button[aria-label*="Accept cookies"]',
            'button:contains("Accept cookies")',
          ];

          // Note: :contains is not a standard CSS selector, so we need to filter manually
          const allButtons = document.querySelectorAll('button, [role="button"], tp-yt-paper-button, ytd-button-renderer');
          allButtons.forEach(button => {
            const text = button.textContent?.toLowerCase() || '';
            if (text.includes('accept') || text.includes('agree') || text.includes('consent') ||
                text.includes('continue') || text.includes('allow')) {
              try {
                (button as HTMLElement).click();
              } catch (e) {
                // Ignore click errors
              }
            }
          });

          // Also try specific selectors that should work
          const workingSelectors = [
            'button[aria-label*="Accept all"]',
            'button[aria-label*="Accept everything"]',
            'button[aria-label*="I agree"]',
            'button[aria-label*="Agree"]',
            '#accept-button',
            '#agree-button',
            'ytd-button-renderer[aria-label*="Accept all"]',
            'ytd-button-renderer[aria-label*="I agree"]'
          ];

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
        }).catch(() => {});

        // Wait a bit for consent to be processed
        await new Promise(resolve => setTimeout(resolve, 1500));
      },
      clearSessionData: async (page: any) => {
        // Clear cookies for this context
        await page.context().clearCookies();

        // Clear localStorage and sessionStorage
        await page.evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {}
        });

        // Also clear IndexedDB if present
        await page.evaluate(() => {
          try {
            if ('indexedDB' in window) {
              indexedDB.databases().then(dbs => {
                dbs.forEach(db => {
                  if (db.name) {
                    indexedDB.deleteDatabase(db.name);
                  }
                });
              });
            }
          } catch {}
        });

        // Clear Cache Storage
        await page.evaluate(() => {
          try {
            if ('caches' in window) {
              caches.keys().then(names => {
                names.forEach(name => caches.delete(name));
              });
            }
          } catch {}
        });

        // Clear SharedWorker and ServiceWorker
        await page.evaluate(() => {
          try {
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(reg => reg.unregister());
              });
            }
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

class StopLoopVideoTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'stopLoopVideo';
  }

  async execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any> {
    // Default selector for video element, can be overridden via task payload
    const selector = task.payload?.selector || 'video.html5-main-video, video';

    const ctx = context || {
      isTabValid: () => true,
      emitEvent: (kind: string, data: any) => console.log(`[${kind}]`, data),
      randomDelay: (minMs: number, maxMs: number) => Promise.resolve(),
      simulateHumanInteraction: async (page: any) => {
        try {
          // Random mouse movement to simulate user presence
          await page.mouse.move(
            Math.random() * 500 + 100,
            Math.random() * 500 + 100,
            {
              steps: 5,
              duration: 500 + Math.random() * 1000
            }
          );

          // Scroll into view to ensure video is visible
          await page.evaluate(async (sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              el.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
            }
          }, selector);

          // Click video element to simulate user interaction
          await page.click(selector);

          // Random pause to mimic human behavior
          await page.waitForTimeout(Math.random() * 2000 + 1000);
        } catch {}
      },
      handleYouTubeConsent: async () => {},
      clearSessionData: async () => {},
      setVideoQuality: async () => {},
    };

    if (tab.loopTimer) {
      clearInterval(tab.loopTimer);
      tab.loopTimer = undefined;
    }

    tab.loopVideoState = {
      ...tab.loopVideoState,
      stopRequested: true,
      isRunning: false
    };

    ctx.emitEvent('log', 'Stopped video loop');
    ctx.emitEvent('result', { taskId: task.id, stopped: true, loopsCompleted: tab.loopVideoState?.loopCount || 0 });

    return { stopped: true, loopsCompleted: tab.loopVideoState?.loopCount || 0 };
  }
}