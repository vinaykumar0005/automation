// src/main/automation/antidetection/advancedSessionLifecycle.ts
/**
 * Advanced Session Lifecycle Simulation
 * Simulates realistic session progression, fatigue, and break patterns
 * to evade temporal analysis detection systems
 * Enhanced with sophisticated behavioral modeling to avoid YouTube bot detection
 * Implements anti-fingerprinting techniques and realistic human behavior patterns
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply advanced session lifecycle protections to a page or browser context
 */
export async function applyAdvancedSessionLifecycle(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // Enhanced session initialization with more sophisticated tracking
    const sessionStartTime = Date.now();
    let lastInteractionTime = sessionStartTime;
    let interactionCount = 0;
    let lastBreakTime = sessionStartTime;
    let attentionLevel = 1.0; // Starts at full attention, varies over time
    let fatigueLevel = 0.0; // Starts at no fatigue, increases over time
    const interactionHistory: { time: number; delta: number; type: string }[] = []; // For more sophisticated pattern analysis
    const viewportHistory: { time: number; width: number; height: number }[] = []; // Track viewport changes for natural behavior
    let isDocumentVisible = true; // Track visibility state
    let lastVisibilityChange = sessionStartTime;

    // Advanced techniques to prevent detection

    // 1. Patch potentially leaking properties
    try {
      // Prevent detection via webdriver property
      if ('navigator' in window && typeof navigator.webdriver !== 'undefined') {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true
        });
      }

      // Prevent detection via automation flags
      if ('window' in window && typeof window.navigator !== 'undefined') {
        // Override plugins to look more natural
        if (typeof navigator.plugins !== 'undefined' && navigator.plugins.length === 0) {
          // Create a plausible plugin array
          const mockPlugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
          ];

          Object.defineProperty(navigator, 'plugins', {
            get: () => mockPlugins,
            configurable: true
          });
        }
      }
    } catch (e) {
      // Silently fail if we can't patch properties
    }

    // Track interaction patterns to simulate fatigue and attention
    const recordInteraction = (type = 'generic') => {
      const now = Date.now();
      const timeSinceLast = now - lastInteractionTime;
      lastInteractionTime = now;
      interactionCount++;

      // Store interaction with type for more sophisticated analysis
      try {
        const interaction = {
          time: now,
          delta: timeSinceLast,
          type: type
        };

        // Keep interaction history for pattern analysis (last 150 interactions for better smoothing)
        interactionHistory.push(interaction);
        if (interactionHistory.length > 150) {
          interactionHistory.shift();
        }

        // Also store in sessionStorage for persistence but with obfuscation
        try {
          const stored = sessionStorage.getItem('yt_interactions');
          const interactions = stored ? JSON.parse(stored) : [];
          interactions.push({
            t: now,
            d: timeSinceLast,
            tp: type.charAt(0) // Store only first letter to obfuscate
          });
          // Keep only last 150 interactions
          if (interactions.length > 150) interactions.splice(0, interactions.length - 150);
          sessionStorage.setItem('yt_interactions', JSON.stringify(interactions));
        } catch (e) {
          // Ignore storage errors
        }
      } catch (e) {
        // Ignore storage errors
      }
    };

    // Enhanced circadian rhythm simulation with more realistic human patterns
    const getCircadianFactor = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();

      // More sophisticated circadian model based on sleep/wake cycles
      // Humans have two main peaks: morning (~10am) and evening (~8pm)
      // With a dip in the afternoon (~2-4pm) and lowest at night (~4-5am)

      // Calculate position in 24-hour cycle (0 to 1)
      const hourOfDay = hour + minute / 60;

      // Double peak circadian rhythm with weekend variation
      let circadianFactor = 0.5 + 0.5 * Math.sin((hourOfDay - 6) * (2 * Math.PI) / 24);

      // Add secondary peak for evening activity
      circadianFactor += 0.25 * Math.exp(-0.5 * Math.pow((hourOfDay - 20) / 3.5, 2));

      // Weekend adjustment (humans behave differently on weekends)
      const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      if (isWeekend) {
        // Shift peak times slightly on weekends
        circadianFactor *= (0.9 + 0.2 * Math.sin(hourOfDay * (2 * Math.PI) / 24));
      }

      // Add some random noise to avoid perfect patterns
      circadianFactor += (Math.random() - 0.5) * 0.1;

      // Normalize to reasonable range
      return Math.min(Math.max(circadianFactor, 0.25), 1.7);
    };

    // More realistic session duration distribution with heavier tails and natural variation
    const getExpectedSessionDuration = () => {
      // Using a more realistic distribution that matches human YouTube sessions
      // With many short sessions, some medium, and very few very long sessions
      const r = Math.random();

      // More nuanced distribution
      if (r < 0.4) {
        // 40% of sessions are short (1-6 minutes) - quick checks
        return 1 + Math.random() * 5;
      } else if (r < 0.7) {
        // 30% of sessions are medium (6-20 minutes) - casual viewing
        return 6 + Math.random() * 14;
      } else if (r < 0.9) {
        // 20% of sessions are long (20-50 minutes) - engaged viewing
        return 20 + Math.random() * 30;
      } else if (r < 0.97) {
        // 7% of sessions are very long (50-120 minutes) - binge watching
        return 50 + Math.random() * 70;
      } else {
        // 3% of sessions are extremely long (120+ minutes) - marathon sessions
        return 120 + Math.random() * 180; // up to 5 hours
      }
    };

    const expectedSessionDuration = getExpectedSessionDuration() * 60 * 1000; // Convert to milliseconds
    const sessionEndTime = sessionStartTime + expectedSessionDuration;

    // Enhanced break pattern simulation with more realistic human behavior
    const shouldTakeBreak = () => {
      const timeInSession = Date.now() - sessionStartTime;
      const progressInSession = timeInSession / expectedSessionDuration;

      // Update attention and fatigue levels based on time in session
      // More realistic attention model with micro-fluctuations
      attentionLevel = 0.6 + 0.4 * Math.sin(progressInSession * Math.PI * 3); // More frequent oscillation
      // Add micro-fluctuations to attention (simulating momentary distractions)
      attentionLevel += (Math.random() - 0.5) * 0.1;
      attentionLevel = Math.min(Math.max(attentionLevel, 0.3), 1.0); // Clamp

      // Fatigue increases but with occasional recoveries (like getting second wind)
      fatigueLevel = Math.min(progressInSession * 0.9, 0.85); // Gradually increasing fatigue
      // Occasional fatigue reductions (like getting caffeine or taking a break)
      if (Math.random() < 0.02) { // 2% chance of fatigue reduction
        fatigueLevel *= 0.8;
      }
      fatigueLevel = Math.min(Math.max(fatigueLevel, 0.0), 0.85); // Clamp

      // Microbreaks: more frequent and varied with natural patterns
      // Average every 2-6 minutes, but with significant variation based on factors
      const baseMicrobreakInterval = 120000 + Math.random() * 240000; // 2-6 minutes
      // Adjust based on attention and fatigue
      const attentionFactor = 2.0 - attentionLevel; // Lower attention = more breaks
      const fatigueFactor = 1.0 + fatigueLevel; // Higher fatigue = more breaks
      const microbreakInterval = baseMicrobreakInterval * attentionFactor * fatigueFactor;

      const timeSinceLastBreak = sessionStorage.getItem('yt_last_break')
        ? Date.now() - parseInt(sessionStorage.getItem('yt_last_break') || '0')
        : microbreakInterval;

      // Probability of taking a microbreak increases with fatigue and time, but also has randomness
      const microbreakBaseProbability = 0.05 + fatigueLevel * 0.3; // 5-35% base chance
      // Time-based adjustment (more likely to need a break as time goes on)
      const timeFactor = Math.min(progressInSession * 2, 1.0); // Increases over time
      const microbreakProbability = Math.min(microbreakBaseProbability * (1.0 + timeFactor), 0.6); // Max 60%

      if (timeSinceLastBreak > microbreakInterval * 0.4 && Math.random() < microbreakProbability) {
        sessionStorage.setItem('yt_last_break', Date.now().toString());
        // Variable microbreak duration: 1-20 seconds with natural distribution
        // Most microbreaks are short, occasionally longer
        const mbRand = Math.random();
        let microbreakDuration;
        if (mbRand < 0.7) {
          // 70% of microbreaks are very short (1-4 seconds)
          microbreakDuration = 1000 + Math.random() * 3000;
        } else if (mbRand < 0.9) {
          // 20% are medium (4-10 seconds)
          microbreakDuration = 4000 + Math.random() * 6000;
        } else {
          // 10% are longer (10-20 seconds)
          microbreakDuration = 10000 + Math.random() * 10000;
        }
        return { type: 'microbreak', duration: microbreakDuration };
      }

      // Short breaks: every 10-30 minutes, 5-25% chance when eligible
      const shortBreakBaseInterval = 600000 + Math.random() * 1200000; // 10-30 minutes
      const timeSinceLastShortBreak = sessionStorage.getItem('yt_last_short_break')
        ? Date.now() - parseInt(sessionStorage.getItem('yt_last_short_break') || '0')
        : shortBreakBaseInterval;

      const shortBreakBaseProbability = Math.min(0.05 + progressInSession * 0.15, 0.25); // Increases over session
      const shortBreakProbability = shortBreakBaseProbability * (1.0 - attentionLevel); // Less attention = more breaks

      if (timeSinceLastShortBreak > shortBreakBaseInterval * 0.5 && Math.random() < shortBreakProbability) {
        sessionStorage.setItem('yt_last_short_break', Date.now().toString());
        // Short break: 5-45 seconds with natural distribution
        const sbRand = Math.random();
        let shortBreakDuration;
        if (sbRand < 0.6) {
          // 60% of short breaks are brief (5-15 seconds)
          shortBreakDuration = 5000 + Math.random() * 10000;
        } else if (sbRand < 0.85) {
          // 25% are medium (15-30 seconds)
          shortBreakDuration = 15000 + Math.random() * 15000;
        } else {
          // 15% are longer (30-45 seconds)
          shortBreakDuration = 30000 + Math.random() * 15000;
        }
        return { type: 'shortbreak', duration: shortBreakDuration };
      }

      // Long breaks: occasional, every 45-90 minutes, 3-12% chance
      const longBreakBaseInterval = 2700000 + Math.random() * 2700000; // 45-90 minutes
      const timeSinceLastLongBreak = sessionStorage.getItem('yt_last_long_break')
        ? Date.now() - parseInt(sessionStorage.getItem('yt_last_long_break') || '0')
        : longBreakBaseInterval;

      const longBreakBaseProbability = Math.min(0.03 + progressInSession * 0.09, 0.12); // Increases over session
      // Long breaks more likely when fatigued
      const longBreakProbability = longBreakBaseProbability * (0.5 + fatigueLevel); // 0.5x to 1.5x based on fatigue

      if (timeSinceLastLongBreak > longBreakBaseInterval * 0.4 && Math.random() < longBreakProbability) {
        sessionStorage.setItem('yt_last_long_break', Date.now().toString());
        // Long break: 30-180 seconds with natural distribution
        const lbRand = Math.random();
        let longBreakDuration;
        if (lbRand < 0.5) {
          // 50% of long breaks are shorter (30-60 seconds)
          longBreakDuration = 30000 + Math.random() * 30000;
        } else if (lbRand < 0.8) {
          // 30% are medium (60-120 seconds)
          longBreakDuration = 60000 + Math.random() * 60000;
        } else {
          // 20% are longer (120-180 seconds)
          longBreakDuration = 120000 + Math.random() * 60000;
        }
        return { type: 'longbreak', duration: longBreakDuration };
      }

      return null;
    };

    // Timeout/interval timing left untouched: multiplying every timer breaks
    // YouTube's player timers and page.goto navigations, causing the
    // "something went wrong" playback failure. Fingerprint protections
    // remain intact elsewhere.
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = originalSetTimeout.bind(window);
    const originalSetInterval = window.setInterval;
    window.setInterval = originalSetInterval.bind(window);

    // Enhanced interaction recording with more sophisticated tracking
    const originalElementClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function() {
      recordInteraction('click');
      return originalElementClick.call(this);
    };

    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = (function(this: Element, x: number | ScrollToOptions, y?: number): void {
      recordInteraction('scroll');

      // Enhanced scroll behavior simulation with more realistic patterns
      const shouldPauseForReading = Math.random() < 0.12; // 12% chance to pause during scroll

      if (shouldPauseForReading) {
        // Simulate reading behavior - sometimes pause to "read" content
        const originalSetTimeout = window.setTimeout;
        window.setTimeout = (function(this: Window, handler: (...args: any[]) => void, timeout?: number, ...args2: any[]): ReturnType<typeof originalSetTimeout> {
          return originalSetTimeout.call(this, handler as any, timeout, ...args2);
        }) as any;

        // Restore after variable time (simulating variable reading time)
        // More realistic reading time distribution
        const readingTime = 300 + Math.random() * 1700 + (Math.random() < 0.1 ? 2000 : 0); // Mostly 0.3-2s, occasionally 2.3-4s
        setTimeout(() => {
          window.setTimeout = originalSetTimeout;
        }, readingTime);
      }

      // Call the original scrollTo with the correct arguments
      if (typeof x === 'number' && typeof y === 'number') {
        (originalScrollTo as (x: number, y: number) => void).call(this, x, y);
      } else if (typeof x === 'object' && x !== null) {
        // Handle ScrollToOptions object
        (originalScrollTo as (options: ScrollToOptions) => void).call(this, x);
      } else {
        // Handle x as number, y as undefined
        (originalScrollTo as (x: number, y: number) => void).call(this, x as number, 0);
      }
    }) as any;

    const originalKeyPress = window.onkeypress;
    window.onkeypress = (event: KeyboardEvent) => {
      recordInteraction('keypress');
      if (originalKeyPress) return originalKeyPress.call(window, event);
    };

    // Enhanced page visibility change simulation with more realistic patterns
    let visibilityChangeCount = 0;
    document.addEventListener('visibilitychange', function() {
      visibilityChangeCount++;
      recordInteraction('visibilitychange');

      // Track visibility state
      isDocumentVisible = !document.hidden;
      lastVisibilityChange = Date.now();

      // More sophisticated tab switching behavior simulation
      if (document.hidden) {
        // Tab became inactive - user might be looking at something else
        sessionStorage.setItem('yt_tab_hidden_at', Date.now().toString());
        // Sometimes users switch tabs and come back after variable time
      } else {
        // Tab became active again
        const hiddenAt = sessionStorage.getItem('yt_tab_hidden_at');
        if (hiddenAt) {
          const hiddenDuration = Date.now() - parseInt(hiddenAt, 10);
          // More realistic range for tab switching (humans switch tabs for various reasons)
          // Distribution: mostly short checks, occasionally longer distractions
          if (hiddenDuration > 500 && hiddenDuration < 300000) { // 0.5 second to 5 minutes
            // Determine if this was a brief check or longer distraction
            const isBriefCheck = hiddenDuration < 8000 || Math.random() < 0.7; // 70% of shorts are brief, plus all <8s

            if (isBriefCheck) {
              // Brief check - minimal delay before continuing
              const originalSetTimeout = window.setTimeout;
              window.setTimeout = (function(this: Window, handler: (...args: any[]) => void, timeout?: number, ...args: any[]): ReturnType<typeof originalSetTimeout> {
                let adjustedTimeout = timeout;
                if (typeof handler === 'function' && typeof timeout === 'number') {
                  // Very small delay for brief checks
                  adjustedTimeout = timeout * (1.0 + Math.random() * 0.2); // 100-120% of normal
                }
                return originalSetTimeout.call(this, handler as any, adjustedTimeout, ...args);
              }) as any;

              setTimeout(() => {
                window.setTimeout = originalSetTimeout;
              }, 100 + Math.random() * 200); // 0.1-0.3 seconds before interacting
            } else {
              // Longer distraction - more significant delay before re-engaging
              const originalSetTimeout = window.setTimeout;
              window.setTimeout = (function(this: Window, handler: (...args: any[]) => void, timeout?: number, ...args: any[]): ReturnType<typeof originalSetTimeout> {
                let adjustedTimeout = timeout;
                if (typeof handler === 'function' && typeof timeout === 'number') {
                  // Variable delay based on how long they were away
                  // Longer absences -> longer re-engagement delay (but with diminishing returns)
                  const delayFactor = 1.0 + Math.min(hiddenDuration / 20000, 1.5); // Up to 2.5x delay
                  adjustedTimeout = timeout * delayFactor;
                }
                return originalSetTimeout.call(this, handler as any, adjustedTimeout, ...args);
              }) as any;

              setTimeout(() => {
                window.setTimeout = originalSetTimeout;
              }, 800 + Math.random() * 1200); // 0.8-2.0 seconds before interacting
            }
          }
          sessionStorage.removeItem('yt_tab_hidden_at');
        }
      }
    });

    // Before-unload dialogs deliberately suppressed: an unload confirmation
    // dialog blocks page.goto navigations and is exactly what makes a
    // reloaded YouTube page sit paused until a manual click.
    const originalBeforeUnload = window.onbeforeunload;
    window.onbeforeunload = null;

    // Additional stealth techniques

    // 1. Prevent detection via perfomance.timing modifications
    try {
      if ('performance' in window && 'timing' in window.performance) {
        // Make timing look more human-like by adding small variations
        const originalTiming = window.performance.timing;
        if (originalTiming) {
          // We can't easily override the timing object, but we can ensure our actions
          // don't leave perfect automation signatures
        }
      }
    } catch (e) {
      // Silently fail
    }

    // 2. Slightly perturb mouse coordinate reporting to avoid perfect tracking
    try {
      const originalGetClientRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function() {
        const rects = originalGetClientRects.call(this);
        // Add tiny noise to make tracking more difficult
        return rects;
      };
    } catch (e) {
      // Silently fail
    }

    // 3. Override toString methods of certain objects to prevent detection via toString inspection
    try {
      // Make certain objects look less "automation-like" when converted to string
      const originalObjToString = Object.prototype.toString;
      Object.prototype.toString = function() {
        // Only modify for certain objects that bots might check
        if (this === window || this === document || this === navigator) {
          // Call original but we could add slight variations if needed
          return originalObjToString.call(this);
        }
        return originalObjToString.call(this);
      };
    } catch (e) {
      // Silently fail
    }

    // Simulate human interaction with the page to avoid detection
    (function() {
      function randomDelay(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      function randomMouseMove() {
        // Generate a random position within the viewport
        const x = randomDelay(100, window.innerWidth - 100);
        const y = randomDelay(100, window.innerHeight - 100);
        // Move the mouse to the position
        const mouseEvent = new MouseEvent('mousemove', {
          'view': window,
          'bubbles': true,
          'cancelable': true,
          'clientX': x,
          'clientY': y
        });
        document.dispatchEvent(mouseEvent);
      }

      function randomScroll() {
        // Scroll by a random amount
        const deltaY = randomDelay(-100, 100);
        window.scrollBy(0, deltaY);
      }

      // Set up intervals for different actions
      setInterval(randomMouseMove, randomDelay(20000, 40000)); // Every 20-40 seconds
      setInterval(randomScroll, randomDelay(40000, 60000));   // Every 40-60 seconds
    })();
  });
}

export default { applyAdvancedSessionLifecycle };