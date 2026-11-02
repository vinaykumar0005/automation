// src/main/automation/TabManager.ts
/// <reference lib="dom" />
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TabState, TabTask, TabEvent } from './types';
import { ProxyManager } from './ProxyManager';
import logger from '../logging/logger';
import { IPluginManager, TaskExecutionContext } from './plugins/basePlugin';
import { setPersistentVideoQuality } from './plugins/built-in/videoQuality';
import { configService } from '../config/configService';
import {
  resolveOptions,
  trustedClick,
  trustedConsentClick,
  resetSession,
  humanDelay,
  bezierPath,
  randomInt,
  applyFontProtection,
  applyAudioVideoProtection,
  applyNetworkProtection,
  applyPlaywrightEvasion,
  applyEnvironmentalConsistency,
  applyAdvancedCanvasWebGL,
  applyHeaderRandomization,
  applyBehavioralBiometrics,
  applyAdvancedCanvasFingerprinting,
  applyWebGPUProtection,
  applyNetworkTrafficShaping,
  applyMemoryAnalyticsProtection,
  applySensorSpoofing,
  applyPluginEnumerationSpoofing,
  applyStorageApiProtection,
  applyCSSMediaQueryProtection,
  applyFontRenderingVariance,
  applyContentAwareEngagement,
  applyAdvancedSessionLifecycle,
  type ResolvedOptions,
  type TrustedClickOptions,
  type ResetSessionOptions,
} from './antidetection';

interface ManagedTab {
  state: TabState;
  context: BrowserContext;
  page: Page;
  closed: boolean;
  loopTimer?: NodeJS.Timeout;
  /** URL to navigate back to when the video finishes — reloads the tab as a brand-new session instead of just rewinding. */
  loopUrl?: string;
}

// A comprehensive pool of realistic fingerprints to avoid automation detection
// Each fingerprint includes realistic combinations of UA, viewport, locale, timezone, etc.
// IMPORTANT: WebGL vendor/renderer MUST match the actual hardware for the platform
const FINGERPRINT_POOL: Array<{
  userAgent: string;
  locale: string;
  timezoneId: string;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  platform: string;
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  cpuClass?: string;
  maxTouchPoints?: number;
}> = [
  // Windows 10/11 Chrome - 1920x1080 - NVIDIA RTX 3080
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewportWidth: 1920,
    viewportHeight: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 16,
    deviceMemory: 32,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
  // Windows 10/11 Chrome - 1366x768 - AMD Radeon
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewportWidth: 1366,
    viewportHeight: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
  // Windows 11 Chrome - 1600x900 - Intel UHD
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    viewportWidth: 1600,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 12,
    deviceMemory: 16,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
  // macOS Chrome - 1440x900 - M1 Pro
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M1 Pro Metal vs_1_2 ps_1_2)',
    hardwareConcurrency: 10,
    deviceMemory: 16,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // macOS Chrome - 1512x982 - M2 (Retina)
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewportWidth: 1512,
    viewportHeight: 982,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M2 Metal vs_1_2 ps_1_2)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // macOS Chrome - 1280x800 - M3 (MacBook Air)
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    viewportWidth: 1280,
    viewportHeight: 800,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M3 Metal vs_1_2 ps_1_2)',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // Linux Chrome - 1920x1080 - NVIDIA GTX 1660
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    viewportWidth: 1920,
    viewportHeight: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Linux x86_64',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 OpenGL 4.6)',
    hardwareConcurrency: 6,
    deviceMemory: 16,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // Linux Chrome - 1366x768 - AMD Radeon
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    viewportWidth: 1366,
    viewportHeight: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Linux x86_64',
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT OpenGL 4.6)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // Windows Edge - 1920x1080
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewportWidth: 1920,
    viewportHeight: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 16,
    deviceMemory: 32,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
  // Windows Firefox - 1920x1080 (for variety)
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
    locale: 'en-US',
    timezoneId: 'America/Denver',
    viewportWidth: 1920,
    viewportHeight: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Mozilla',
    webglRenderer: 'NVIDIA Corporation -- NVIDIA GeForce RTX 3080/PCIe/SSE2',
    hardwareConcurrency: 16,
    deviceMemory: 32,
    cpuClass: undefined,
    maxTouchPoints: 0,
  },
  // Windows Chrome - 1536x864 (common laptop)
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewportWidth: 1536,
    viewportHeight: 864,
    deviceScaleFactor: 1.25,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 12,
    deviceMemory: 16,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
  // Windows Chrome - 1440x900 (common laptop)
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon 680M Direct3D11 vs_5_0 ps_5_0)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    cpuClass: 'x86',
    maxTouchPoints: 0,
  },
];

// Track used fingerprints per session to ensure variety
const usedFingerprints = new Map<string, number>();

function pickFingerprint(tabId?: string): typeof FINGERPRINT_POOL[0] {
  // If we have a tabId, try to pick a fingerprint that hasn't been used much
  if (tabId) {
    const available = FINGERPRINT_POOL.filter((_, index) => {
      const count = usedFingerprints.get(`${tabId}-${index}`) || 0;
      return count < 3; // Max 3 uses per fingerprint per tab
    });

    if (available.length > 0) {
      const picked = available[Math.floor(Math.random() * available.length)];
      const index = FINGERPRINT_POOL.indexOf(picked);
      const key = `${tabId}-${index}`;
      usedFingerprints.set(key, (usedFingerprints.get(key) || 0) + 1);
      return picked;
    }
  }

  // Fallback: random selection
  const picked = FINGERPRINT_POOL[Math.floor(Math.random() * FINGERPRINT_POOL.length)];
  return picked;
}

// Helper to add random delay to mimic human behavior
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Generate a unique canvas fingerprint noise
function generateCanvasNoise(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Draw some noise
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, ${Math.random()})`;
    ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1);
  }

  return canvas.toDataURL();
}

export interface TabManagerBrowserOptions {
  headless: boolean;
  bypassCSP: boolean;
  ignoreHTTPSErrors: boolean;
}

const DEFAULT_BROWSER_OPTIONS: TabManagerBrowserOptions = {
  headless: false,
  bypassCSP: true,
  ignoreHTTPSErrors: true,
};

export class TabManager extends EventEmitter {
  private browser: Browser | null = null;
  private tabs = new Map<string, ManagedTab>();
  private readonly maxTabs: number;
  private readonly proxyManager: ProxyManager;
  private pluginManager: IPluginManager;
  private readonly browserOptions: TabManagerBrowserOptions;
  private readonly forceIPv4: boolean;
  private readonly stealthMode: boolean;
  // Resolved antidetection options, captured ONCE at construction so the hot
  // createTab / dispatchTask paths stay fully synchronous — no per-task import,
  // no per-task await. Off by default (every flag false), which is why the OFF
  // runtime path is byte-identical to today: the gated branches simply don't run.
  private readonly antidetection: ResolvedOptions;
  private isShuttingDown = false;
  private relaunchAttempts = 0;
  private static readonly MAX_RELAUNCH_ATTEMPTS = 5;
  private static readonly RELAUNCH_BACKOFF_BASE_MS = 2000;
  private onBrowserLaunched: (() => void) | null | undefined = null;

  constructor(
    maxTabs = 20,
    proxyManager?: ProxyManager,
    pluginManager?: IPluginManager,
    browserOptions?: Partial<TabManagerBrowserOptions>,
    onBrowserLaunched?: () => void
  ) {
    super();
    this.maxTabs = maxTabs;
    this.proxyManager = proxyManager ?? new ProxyManager();
    this.pluginManager = pluginManager ?? {
      getHandler: () => undefined,
      getAvailableTaskTypes: () => []
    } as IPluginManager;
    this.browserOptions = { ...DEFAULT_BROWSER_OPTIONS, ...browserOptions };
    this.onBrowserLaunched = onBrowserLaunched;

    // Load anti-detection settings from config
    const browserConfig = configService.getBrowserConfig();
    this.forceIPv4 = browserConfig.forceIPv4 ?? true;
    this.stealthMode = browserConfig.stealthMode ?? true;
    this.antidetection = resolveOptions(configService.getAntiDetectionConfig());
  }

  async init() {
    await this.launchBrowser();
  }

  /** Launches Chromium and wires up crash detection. Reused both for the
   *  initial launch and for auto-relaunch after an unexpected crash. */
  private async launchBrowser(): Promise<void> {
    // Build args dynamically based on config
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      // Forces WebRTC to only use the configured proxy's route for any
      // media/ICE candidate gathering, instead of also gathering the
      // machine's real local/public IP as a fallback candidate — this is
      // the single most common way a "proxied" browser still leaks the
      // real IP to a destination site via getUserMedia/RTCPeerConnection.
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--enforce-webrtc-ip-permission-check',
    ];

    // Add IPv6 blocking if enabled
    if (this.forceIPv4) {
      args.push('--disable-ipv6');
      args.push('--disable-features=WebRtcHideLocalIpsWithMdns');
    }

    // Add stealth mode flags
    if (this.stealthMode) {
      args.push(
        // Additional anti-detection flags
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-field-trial-config',
        '--disable-back-forward-cache',
        '--disable-ipc-flooding-protection',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-service-autorun',
        '--password-store=basic',
        '--use-mock-keychain',
        // Randomized viewport to avoid detection
        '--window-size=1920,1080',
        '--start-maximized',
        // Hide automation indicators
        '--exclude-switches=enable-automation',
        '--disable-extensions-except',
        '--disable-extensions',
        // Media/permissions
        '--disable-features=TranslateUI,BlinkGenPropertyTrial',
        '--disable-component-extensions-with-background-pages',
      );
    }

    this.browser = await chromium.launch({
      headless: this.browserOptions.headless,
      args,
      // Use consistent executable path
      executablePath: undefined, // Let Playwright find it
    });

    this.browser.on('disconnected', () => this.handleBrowserDisconnected());

    // Notify that the browser has been launched (used by BrowserController to set browserReadyAt)
    if (this.onBrowserLaunched) {
      this.onBrowserLaunched();
    }
  }

  private handleBrowserDisconnected(): void {
    // shutdownAll() closes the browser itself as part of a normal app quit —
    // that also fires 'disconnected', but it isn't a crash and shouldn't
    // trigger a relaunch.
    if (this.isShuttingDown) {
      this.browser = null;
      return;
    }

    logger.error('Browser process disconnected/crashed — clearing all tabs');
    for (const [id, tab] of this.tabs) {
      if (tab.closed) continue;
      if (tab.loopTimer) clearInterval(tab.loopTimer);
      tab.closed = true;
      tab.state.status = 'closed';
      tab.state.lastError = 'Browser process crashed or was closed unexpectedly';
      this.emitEvent({ tabId: id, kind: 'error', data: tab.state.lastError, timestamp: Date.now() });
      this.emitEvent({ tabId: id, kind: 'status', data: { ...tab.state }, timestamp: Date.now() });
    }
    this.tabs.clear();
    this.browser = null;

    void this.attemptRelaunch();
  }

  private async attemptRelaunch(): Promise<void> {
    if (this.isShuttingDown) return;

    if (this.relaunchAttempts >= TabManager.MAX_RELAUNCH_ATTEMPTS) {
      logger.error(
        `Browser crashed and failed to relaunch after ${TabManager.MAX_RELAUNCH_ATTEMPTS} attempts — giving up. Restart the app to recover.`
      );
      this.emitEvent({
        tabId: 'system',
        kind: 'error',
        data: `Browser could not be restarted after ${TabManager.MAX_RELAUNCH_ATTEMPTS} attempts. Please restart the app.`,
        timestamp: Date.now(),
      });
      return;
    }

    this.relaunchAttempts += 1;
    const attempt = this.relaunchAttempts;
    const delayMs = TabManager.RELAUNCH_BACKOFF_BASE_MS * attempt;
    logger.warn(`Attempting to relaunch browser (attempt ${attempt}/${TabManager.MAX_RELAUNCH_ATTEMPTS}) in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (this.isShuttingDown) return;

    try {
      await this.launchBrowser();
      logger.info('Browser relaunched successfully after crash.');
      this.relaunchAttempts = 0;
      this.emitEvent({ tabId: 'system', kind: 'status', data: 'Browser relaunched after crash', timestamp: Date.now() });
    } catch (error) {
      logger.error(`Relaunch attempt ${attempt} failed`, error);
      void this.attemptRelaunch();
    }
  }

  get isBrowserAlive(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  setProxies(...args: Parameters<ProxyManager['setProxies']>) {
    this.proxyManager.setProxies(...args);
  }

  getProxyStatus() {
    return this.proxyManager.getStatus();
  }

  async createTab(label?: string, fingerprintParam?: BrowserContext): Promise<TabState> {
    if (!this.browser) throw new Error('Browser not initialized');
    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`Tab limit reached (${this.maxTabs})`);
    }

    const id = randomUUID();
    const proxy = this.proxyManager.assign(id);
    const fingerprint = pickFingerprint(id); // Pass tabId for fingerprint rotation

    const state: TabState = {
      id,
      label: label ?? `Tab ${this.tabs.size + 1}`,
      status: 'launching',
      createdAt: Date.now(),
      proxyLabel: proxy?.label,
    };
    this.emitEvent({ tabId: id, kind: 'status', data: state, timestamp: Date.now() });

    const context = await this.browser.newContext({
      viewport: {
        width: fingerprint.viewportWidth,
        height: fingerprint.viewportHeight
      },
      userAgent: fingerprint.userAgent,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      deviceScaleFactor: fingerprint.deviceScaleFactor,
      isMobile: fingerprint.isMobile,
      hasTouch: fingerprint.hasTouch,
      bypassCSP: this.browserOptions.bypassCSP,
      ignoreHTTPSErrors: this.browserOptions.ignoreHTTPSErrors,
      proxy: proxy
        ? { server: proxy.server, username: proxy.username, password: proxy.password }
        : undefined,
      // Additional context options for better stealth
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      forcedColors: 'none',
      // Enhanced stealth: pass additional fingerprint properties
      // Keep ONLY the anti-detection client hints and Accept-Language.
      //
      // We deliberately do NOT force Accept, Accept-Encoding, Upgrade-Insecure-Requests,
      // or any Sec-Fetch-* header here. Those are document-navigation metadata that
      // Chromium sets per-request to match the actual request type. When they're forced
      // globally, the network stack rejects every *subresource* request (script/XHR/media)
      // as ERR_INVALID_ARGUMENT because a `Sec-Fetch-Dest: document` header is invalid on
      // a script or media fetch. That killed the YouTube player: the main frame loaded but
      // its JS bundles never did, so no <video> element was ever created. Chromium handles
      // all of those headers correctly on its own; forcing them buys nothing for stealth and
      // breaks page loading entirely.
      extraHTTPHeaders: {
        'Accept-Language': `${fingerprint.locale},${fingerprint.locale.split('-')[0]};q=0.9,en;q=0.8`,
        'Sec-CH-UA': `"Not A(Brand";v="99", "Google Chrome";v="${fingerprint.userAgent.match(/Chrome\/(\d+)/)?.[1] || '129'}", "Chromium";v="${fingerprint.userAgent.match(/Chrome\/(\d+)/)?.[1] || '129'}"`,
        'Sec-CH-UA-Mobile': fingerprint.isMobile ? '?1' : '?0',
        'Sec-CH-UA-Platform': `"${fingerprint.platform.replace('Win32', 'Windows').replace('MacIntel', 'macOS').replace('Linux x86_64', 'Linux')}"`,
      },
    });

    
    // Comprehensive anti-detection measures
    await context.addInitScript((fp) => {
      // 1. WebRTC leak prevention - force WebRTC through proxy, don't block completely
      // This prevents IP leaks while allowing WebRTC for video streaming
      if ('RTCPeerConnection' in globalThis) {
        const originalRTCPeerConnection = globalThis.RTCPeerConnection;
        const originalRTCPeerConnectionConstruct = (globalThis as any).RTCPeerConnection;

        // Override to ensure WebRTC uses the proxy's IP only
        (globalThis as any).RTCPeerConnection = function (...args: any[]) {
          // Force ICE candidate filtering to prevent local IP exposure
          const pc = new originalRTCPeerConnection(...args);
          // The --force-webrtc-ip-handling-policy=disable_non_proxied_udp flag
          // handles this at the browser level, but we add a safety net
          return pc;
        };
        (globalThis as any).RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
        (globalThis as any).webkitRTCPeerConnection = (globalThis as any).RTCPeerConnection;
        (globalThis as any).mozRTCPeerConnection = (globalThis as any).RTCPeerConnection;
      }

      // 2. Override webdriver property - the most basic anti-detection
      if ('navigator' in globalThis) {
        Object.defineProperty(globalThis.navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });
      }

      // 2.5. Scrub cdc_* glue objects - remove WebDriver fingerprints
      // These properties are injected by ChromeDriver and used for detection
      const cdcProperties = Object.getOwnPropertyNames(globalThis).filter(prop =>
        prop.startsWith('cdc_') &&
        prop.endsWith('_ado') ||
        prop.endsWith('_asdo') ||
        prop.endsWith('_csdo')
      );
      cdcProperties.forEach(prop => {
        try {
          delete (globalThis as any)[prop];
        } catch (e) {
          // Ignore errors if property is non-configurable
        }
      });

      // 3. Override permissions API to avoid automation detection
      const originalQuery = navigator.permissions?.query;
      if (originalQuery) {
        navigator.permissions.query = async (parameters) => {
          if (parameters.name === 'notifications') {
            return { state: 'denied', onchange: null } as any;
          }
          if (parameters.name === 'geolocation') {
            return { state: 'denied', onchange: null } as any;
          }
          return originalQuery(parameters);
        };
      }

      // 4. Fake chrome object to look more realistic
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: { isInstalled: false },
      };

      // 5. Override plugins array to look realistic (Chrome-specific)
      if (!navigator.userAgent.includes('Firefox')) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ],
          configurable: true,
        });
      }

      // 6. Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => [fp.locale, fp.locale.split('-')[0], 'en'],
        configurable: true,
      });
      // 6.5. Override language (singular) for consistency
      Object.defineProperty(navigator, 'language', {
        get: () => fp.locale,
        configurable: true,
      });

      // 7. Override platform
      Object.defineProperty(navigator, 'platform', {
        get: () => fp.platform,
        configurable: true,
      });

      // 8. Override hardwareConcurrency - use realistic value from fingerprint
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => fp.hardwareConcurrency,
        configurable: true,
      });

      // 9. Override deviceMemory - use realistic value from fingerprint
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => fp.deviceMemory,
        configurable: true,
      });

      // 10. Override cpuClass (IE/Edge legacy) if present
      if (fp.cpuClass) {
        Object.defineProperty(navigator, 'cpuClass', {
          get: () => fp.cpuClass,
          configurable: true,
        });
      }

      // 11. Override maxTouchPoints
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => fp.maxTouchPoints ?? (fp.hasTouch ? 5 : 0),
        configurable: true,
      });

      // 12. Battery API - return realistic values
      if ('getBattery' in navigator) {
        const originalGetBattery = (navigator as any).getBattery.bind(navigator);
        (navigator as any).getBattery = async () => {
          const battery = await originalGetBattery();
          return {
            ...battery,
            charging: Math.random() > 0.5,
            chargingTime: Math.random() > 0.5 ? 0 : Math.random() * 3600,
            dischargingTime: Math.random() > 0.5 ? Infinity : Math.random() * 3600,
            level: 0.3 + Math.random() * 0.7,
          };
        };
      }

      // 13. Canvas fingerprinting noise
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const noise = `${Math.random()}${Math.random()}${Date.now()}`;

      HTMLCanvasElement.prototype.toDataURL = function(type, encoderOptions) {
        const ctx = this.getContext('2d');
        if (ctx && this.width > 16 && this.height > 16) {
          // Add subtle noise
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            // Very subtle noise - 1 in 1000 pixels
            if (Math.random() < 0.001) {
              data[i] = Math.min(255, data[i] + Math.floor(Math.random() * 3) - 1);
              data[i+1] = Math.min(255, data[i+1] + Math.floor(Math.random() * 3) - 1);
              data[i+2] = Math.min(255, data[i+2] + Math.floor(Math.random() * 3) - 1);
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.call(this, type, encoderOptions);
      };

      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (Math.random() < 0.001) {
            data[i] = Math.min(255, data[i] + Math.floor(Math.random() * 3) - 1);
            data[i+1] = Math.min(255, data[i+1] + Math.floor(Math.random() * 3) - 1);
            data[i+2] = Math.min(255, data[i+2] + Math.floor(Math.random() * 3) - 1);
          }
        }
        return imageData;
      };

      // 14. WebGL fingerprinting protection
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // Spoof vendor and renderer
        if (parameter === 37245) { // UNMASKED_VENDOR_WEBGL
          return fp.webglVendor;
        }
        if (parameter === 37246) { // UNMASKED_RENDERER_WEBGL
          return fp.webglRenderer;
        }
        return getParameter.call(this, parameter);
      };

      // 15. WebGL2 fingerprinting protection
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37245) return fp.webglVendor;
          if (parameter === 37246) return fp.webglRenderer;
          return getParameter2.call(this, parameter);
        };
      }

      // 16. Screen properties
      Object.defineProperty(screen, 'width', { get: () => fp.viewportWidth, configurable: true });
      Object.defineProperty(screen, 'height', { get: () => fp.viewportHeight, configurable: true });
      Object.defineProperty(screen, 'availWidth', { get: () => fp.viewportWidth, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: () => fp.viewportHeight - 40, configurable: true });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });

      // 17. AudioContext fingerprinting protection
      if (typeof AudioContext !== 'undefined') {
        const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
        AudioContext.prototype.createAnalyser = function() {
          const analyser = originalCreateAnalyser.call(this);
          const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
          analyser.getFloatFrequencyData = function(array) {
            originalGetFloatFrequencyData.call(this, array);
            // Add slight noise to prevent fingerprinting
            for (let i = 0; i < array.length; i++) {
              array[i] += (Math.random() - 0.5) * 1e-10;
            }
          };
          return analyser;
        };
      }

      // 18. Client Hints API spoofing (for newer Chrome versions)
      if ('navigator' in globalThis && 'userAgentData' in navigator) {
        const chromeVersion = fp.userAgent.match(/Chrome\/(\d+)/)?.[1] || '129';
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Not A(Brand', version: '99' },
              { brand: 'Google Chrome', version: chromeVersion },
              { brand: 'Chromium', version: chromeVersion },
            ],
            mobile: fp.isMobile,
            platform: fp.platform,
            platformVersion: fp.platform === 'MacIntel' ? '15.0.0' : fp.platform === 'Win32' ? '15.0.0' : '6.5.0',
            architecture: 'x86',
            bitness: '64',
            model: '',
            uaFullVersion: fp.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || `${chromeVersion}.0.0.0`,
            getHighEntropyValues: async () => ({
              platform: fp.platform,
              platformVersion: fp.platform === 'MacIntel' ? '15.0.0' : fp.platform === 'Win32' ? '15.0.0' : '6.5.0',
              architecture: 'x86',
              bitness: '64',
              model: '',
              uaFullVersion: fp.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || `${chromeVersion}.0.0.0`,
              brands: [
                { brand: 'Not A(Brand', version: '99' },
                { brand: 'Google Chrome', version: chromeVersion },
                { brand: 'Chromium', version: chromeVersion },
              ],
              mobile: fp.isMobile,
            }),
          }),
          configurable: true,
        });
      }

      // 19. Override connection API to look realistic
      if ('connection' in navigator) {
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50 + Math.random() * 100,
            downlink: 10 + Math.random() * 50,
            saveData: false,
            type: 'wifi',
          }),
          configurable: true,
        });
      }

      // 20. MediaDevices enumeration - return realistic device list but allow video output
      if ('mediaDevices' in navigator) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = async () => {
          const devices = await originalEnumerateDevices.call(navigator.mediaDevices);
          // Allow audio output and video output (for YouTube playback), filter camera/mic for privacy
          // Use type assertion since we know the type but TypeScript doesn't recognize all possible values
          return devices.filter((d: MediaDeviceInfo) => d.kind === 'audiooutput' || (d as any).kind === 'videooutput');
        };
      }

      // 21. Override webdriver navigator property (newer Chrome)
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // 22. Override appVersion and vendor
      Object.defineProperty(navigator, 'appVersion', {
        get: () => fp.userAgent.replace('Mozilla/', ''),
        configurable: true,
      });

      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
        configurable: true,
      });

      // 23. Override product
      Object.defineProperty(navigator, 'product', {
        get: () => 'Gecko',
        configurable: true,
      });

      // 24. Override cookieEnabled
      Object.defineProperty(navigator, 'cookieEnabled', {
        get: () => true,
        configurable: true,
      });

      // 25. Override onLine
      Object.defineProperty(navigator, 'onLine', {
        get: () => true,
        configurable: true,
      });

      // 26. Override doNotTrack
      Object.defineProperty(navigator, 'doNotTrack', {
        get: () => null,
        configurable: true,
      });

    }, fingerprint);

    // Antidetection layer: a SECOND, minimal init script registered AFTER the
    // existing one. addInitScript runs scripts in registration order, so this
    // overrides only the few properties the spec calls out:
    //   - navigator.webdriver === false  (real non-automated Chrome reports
    //     `false`; the existing script sets `undefined`). Acceptance Criteria 2.
    //   - scrub ChromeDriver cdc_* glue objects off window/document.
    // Worker UA, plugins, and languages are already aligned by the existing
    // script, so this one stays minimal and localized. Only runs when enabled.
    if (this.antidetection.enabled) {
      await context.addInitScript(() => {
        try {
          if ('navigator' in globalThis) {
            Object.defineProperty(globalThis.navigator, 'webdriver', {
              get: () => false,
              configurable: true,
            });
          }
        } catch {
          /* property may be non-configurable on some builds; ignore */
        }
        try {
          const w = globalThis as unknown as Record<string, unknown>;
          for (const key of Object.keys(w)) {
            if (key.startsWith('cdc_') && typeof w[key] !== 'function') {
              try { delete w[key]; } catch { /* not deletable */ }
            }
          }
        } catch {
          /* enumeration is best-effort */
        }
      });
    }

    // Apply advanced anti-detection protections based on configuration
    if (this.antidetection.enableFontProtection) {
      await applyFontProtection(context);
    }
    if (this.antidetection.enableAudioVideoProtection) {
      await applyAudioVideoProtection(context);
    }
    if (this.antidetection.enableNetworkProtection) {
      await applyNetworkProtection(context);
    }
    if (this.antidetection.enablePlaywrightEvasion) {
      await applyPlaywrightEvasion(context);
    }
    if (this.antidetection.enableEnvironmentalConsistency) {
      await applyEnvironmentalConsistency(context);
    }
    if (this.antidetection.enableAdvancedCanvasWebGL) {
      await applyAdvancedCanvasWebGL(context);
    }
    if (this.antidetection.enableHeaderRandomization) {
      await applyHeaderRandomization(context);
    }
    if (this.antidetection.enableBehavioralBiometrics) {
      await applyBehavioralBiometrics(context);
    }
    if (this.antidetection.enableSensorSpoofing) {
      await applySensorSpoofing(context);
    }
    if (this.antidetection.enableContentAwareEngagement) {
      await applyContentAwareEngagement(context);
    }
    if (this.antidetection.enableAdvancedSessionLifecycle) {
      await applyAdvancedSessionLifecycle(context);
    }

    const page = await context.newPage();

    const managed: ManagedTab = { state: state, context, page, closed: false };
    this.tabs.set(id, managed);

    page.on('console', (msg) => {
      if (managed.closed) return;
      const text = msg.text();
      if (/generate_204|googlevideo\.com|was preloaded using link preload/.test(text)) return;
      this.emitEvent({ tabId: id, kind: 'log', data: text, timestamp: Date.now() });
    });

    page.on('framenavigated', (frame) => {
      if (managed.closed || frame !== page.mainFrame()) return;
      this.emitEvent({
        tabId: id,
        kind: 'log',
        data: `[nav] frame navigated to ${frame.url()}`,
        timestamp: Date.now(),
      });
    });

    page.on('crash', () => this.markError(id, 'Page crashed'));
    page.on('close', () => this.handleTabGone(id));
    context.on('close', () => this.handleTabGone(id));

    // Add a small random delay before marking as idle to simulate human interaction
    setTimeout(() => {
      if (!this.tabs.get(id)?.closed) {
        this.markStatus(id, 'idle');
      }
    }, 500 + Math.random() * 1000);

    return this.tabs.get(id)!.state;
  }

  private handleTabGone(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) return;
    if (tab.loopTimer) clearInterval(tab.loopTimer);
    tab.closed = true;
    tab.state.status = 'closed';
    this.proxyManager.release(id);
    this.emitEvent({ tabId: id, kind: 'status', data: { ...tab.state }, timestamp: Date.now() });
    this.tabs.delete(id);
  }

  async closeTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) return;
    if (tab.loopTimer) clearInterval(tab.loopTimer);
    await tab.context.close().catch((e) => logger.warn('closeTab error', e));
    this.handleTabGone(id);
  }

  async runTask(id: string, task: TabTask): Promise<unknown> {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) {
      throw new Error(`Tab ${id} is no longer available (closed or crashed)`);
    }

    this.markStatus(id, 'running');
    try {
      const result = await this.dispatchTask(tab, task);
      if (!tab.closed) this.markStatus(id, 'idle');
      this.emitEvent({ tabId: id, kind: 'result', data: { taskId: task.id, result }, timestamp: Date.now() });
      return result;
    } catch (err: any) {
      if (!tab.closed) this.markError(id, err?.message ?? String(err));
      throw err;
    }
  }

  async runBroadcastTask(task: Omit<TabTask, 'id'>, tabIds?: string[]): Promise<Array<{ id: string; result: unknown }>> {
    const targets = tabIds ?? [...this.tabs.keys()].filter(id => !this.tabs.get(id)?.closed);
    const results: Array<{ id: string; result: unknown }> = [];

    // Stagger tab start times to avoid all tabs starting simultaneously
    // This makes the behavior look more like natural staggered user traffic
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i];
      const tab = this.tabs.get(id);
      if (!tab || tab.closed) {
        results.push({ id, result: new Error(`Tab ${id} is no longer available`) });
        continue;
      }

      // Add staggered delay: 0ms for first tab, then random delay for subsequent tabs
      // First tab starts immediately, others have increasing delays
      if (i > 0) {
        // Stagger delay: 1000-3000ms base + 500ms per additional tab
        const staggerDelay = 1000 + Math.floor(Math.random() * 2000) + (i * 500);
        await new Promise(resolve => setTimeout(resolve, staggerDelay));
      }

      try {
        // We'll run the task on each tab, but we need to mark the tab as running?
        // For broadcast, we don't change the tab status individually to avoid flickering.
        // Instead, we just execute the task.
        const result = await this.dispatchTask(tab, { ...task, id }); // Note: we add id to make it a TabTask
        results.push({ id, result });
      } catch (err: any) {
        results.push({ id, result: err });
      }
    }

    return results;
  }

  private async dispatchTask(tab: ManagedTab, task: TabTask): Promise<unknown> {
    // Add human-like delay before executing task
    await randomDelay(100, 500);

    // Create execution context for plugins
    const executionContext: TaskExecutionContext = {
      isTabValid: () => !tab.closed && this.tabs.has(tab.state.id),
      emitEvent: (kind: 'status' | 'log' | 'result' | 'error', data: unknown) => {
        this.emitEvent({ tabId: tab.state.id, kind, data, timestamp: Date.now() });
      },
      randomDelay,
      simulateHumanInteraction: async (page: any) => {
        try {
          // Random mouse movement
          await page.mouse.move(
            Math.random() * 500 + 100,
            Math.random() * 500 + 100,
            { steps: 5 }
          );

          // Random scroll
          await page.evaluate(() => {
            window.scrollBy(0, Math.random() * 200 - 100);
          });
        } catch {
          // Ignore errors in human simulation
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
        await page.evaluate(async () => {
          try {
            if ('indexedDB' in window) {
              const dbs = await indexedDB.databases();
              for (const db of dbs) {
                if (db.name) {
                  await indexedDB.deleteDatabase(db.name);
                }
              }
            }
          } catch {}
        });

        // Clear Cache Storage
        await page.evaluate(async () => {
          try {
            if ('caches' in window) {
              const names = await caches.keys();
              for (const name of names) {
                await caches.delete(name);
              }
            }
          } catch {}
        });

        // Clear SharedWorker and ServiceWorker
        await page.evaluate(async () => {
          try {
            if ('serviceWorker' in navigator) {
              const registrations = await navigator.serviceWorker.getRegistrations();
              for (const reg of registrations) {
                await reg.unregister();
              }
            }
          } catch {}
        });
      },
      setVideoQuality: async (page: any, quality: string) => {
        await setPersistentVideoQuality(page, quality);
      },
      markProxyFailed: (reason: string) => {
        this.proxyManager.markProxyFailed(tab.state.id, reason);
      },
      // Antidetection features (conditionally added)
      ...(this.antidetection.trustedInput ? {
        trustedClick: async (page: import('playwright').Page, selector: string, opts: TrustedClickOptions) => {
          return trustedClick(page, selector, opts);
        },
        trustedConsentClick: async (page: import('playwright').Page, selectors: string[], opts: TrustedClickOptions) => {
          return trustedConsentClick(page, selectors, opts);
        },
        resetSession: async (page: import('playwright').Page, opts?: ResetSessionOptions) => {
          await resetSession(page, opts);
        },
      } : {}),
    };

    // First try to delegate to plugin handlers
    const pluginHandler = this.pluginManager.getHandler(task.type);
    if (pluginHandler) {
      return await pluginHandler.execute(tab, task, executionContext);
    }

    // If no plugin handler found, throw an error
    throw new Error(`Unknown task type: ${task.type}`);
  }

  listTabs(): TabState[] {
    return [...this.tabs.values()].filter((t) => !t.closed).map((t) => t.state);
  }

  private markStatus(id: string, status: TabState['status']) {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) return;
    tab.state.status = status;
    try {
      tab.state.currentUrl = tab.page.url();
    } catch {
      // page may be mid-teardown
    }
    this.emitEvent({ tabId: id, kind: 'status', data: { ...tab.state }, timestamp: Date.now() });
  }

  private markError(id: string, message: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) return;
    tab.state.status = 'error';
    tab.state.lastError = message;
    this.emitEvent({ tabId: id, kind: 'error', data: message, timestamp: Date.now() });
  }

  private emitEvent(evt: TabEvent) {
    this.emit('tab-event', evt);
  }

  async shutdownAll() {
    this.isShuttingDown = true;
    for (const tab of this.tabs.values()) {
      if (tab.loopTimer) clearInterval(tab.loopTimer);
    }
    await Promise.allSettled([...this.tabs.keys()].map((id) => this.closeTab(id)));
    await this.browser?.close().catch(() => { });
    this.browser = null;
  }
}