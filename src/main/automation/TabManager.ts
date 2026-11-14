// src/main/automation/TabManager.ts
/// <reference lib="dom" />
//
// TYPE NOTE: patchright-core bundles its own copy of the playwright-core types,
// so its Browser/BrowserContext are nominally distinct from playwright's. The
// browser handle is `any`; everything else uses playwright's types.
//
// CHANGE: viewport is now explicit. Playwright rejects `deviceScaleFactor`
// together with `viewport: null`, which is why every createTab failed with
// '"deviceScaleFactor" option is not supported with null "viewport"'. The
// outerWidth === innerWidth tell that null viewport would have avoided is
// covered by the hardened init script, which reports the fingerprint geometry.
//
// CHANGE: the codec/Widevine probe now runs on a real https origin. EME needs a
// secure context, so on about:blank `requestMediaKeySystemAccess` always failed
// and widevine reported false even with real Chrome.

import { BrowserContext, Page } from 'playwright';
// @ts-ignore — patchright is API-identical to playwright at runtime
import { chromium as stealthChromium } from 'patchright';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TabState, TabTask, TabEvent } from './types';
import { ProxyManager } from './ProxyManager';
import logger from '../logging/logger';
import { IPluginManager, TaskExecutionContext } from './plugins/basePlugin';
import { setPersistentVideoQuality } from './plugins/built-in/videoQuality';
import { configService } from '../config/configService';
import { applyHardening, readFingerprintReport, type HardenedFingerprint } from './antidetection/hardened';

interface ManagedTab {
  state: TabState;
  context: BrowserContext;
  page: Page;
  closed: boolean;
  loopTimer?: NodeJS.Timeout;
  loopUrl?: string;
  loopVideoState?: { isRunning: boolean; loopCount: number; stopRequested?: boolean };
}

interface Profile {
  uaFullVersion: string;
  locale: string;
  country: string;
  timezoneId: string;
  timezoneOffsetMinutes: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  platform: string;
  platformVersion: string;
  isMobile: boolean;
  hasTouch: boolean;
  maxTouchPoints: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const UA_VERSION = '141.0.7390.55';

function uaFor(platform: string): string {
  if (platform === 'MacIntel') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${UA_VERSION} Safari/537.36`;
  }
  if (platform === 'Linux x86_64') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${UA_VERSION} Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${UA_VERSION} Safari/537.36`;
}

const PROFILES: Profile[] = [
  { uaFullVersion: UA_VERSION, locale: 'en-US', country: 'US', timezoneId: 'America/New_York', timezoneOffsetMinutes: 300, viewportWidth: 1920, viewportHeight: 1080, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 12, deviceMemory: 16, webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-US', country: 'US', timezoneId: 'America/Chicago', timezoneOffsetMinutes: 360, viewportWidth: 1536, viewportHeight: 864, deviceScaleFactor: 1.25, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8, webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-US', country: 'US', timezoneId: 'America/Los_Angeles', timezoneOffsetMinutes: 480, viewportWidth: 1440, viewportHeight: 900, deviceScaleFactor: 2, platform: 'MacIntel', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 10, deviceMemory: 16, webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M1 Metal vs_1_2 ps_1_2)' },
  { uaFullVersion: UA_VERSION, locale: 'en-GB', country: 'GB', timezoneId: 'Europe/London', timezoneOffsetMinutes: 0, viewportWidth: 1366, viewportHeight: 768, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 16, webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-GB', country: 'GB', timezoneId: 'Europe/London', timezoneOffsetMinutes: 0, viewportWidth: 1512, viewportHeight: 982, deviceScaleFactor: 2, platform: 'MacIntel', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 16, webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M2 Metal vs_1_2 ps_1_2)' },
  { uaFullVersion: UA_VERSION, locale: 'de-DE', country: 'DE', timezoneId: 'Europe/Berlin', timezoneOffsetMinutes: -60, viewportWidth: 1920, viewportHeight: 1080, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 16, deviceMemory: 16, webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'de-DE', country: 'DE', timezoneId: 'Europe/Berlin', timezoneOffsetMinutes: -60, viewportWidth: 1366, viewportHeight: 768, deviceScaleFactor: 1, platform: 'Linux x86_64', platformVersion: '6.5.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 16, webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT OpenGL 4.6)' },
  { uaFullVersion: UA_VERSION, locale: 'en-CA', country: 'CA', timezoneId: 'America/Toronto', timezoneOffsetMinutes: 300, viewportWidth: 1600, viewportHeight: 900, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 12, deviceMemory: 16, webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-AU', country: 'AU', timezoneId: 'Australia/Sydney', timezoneOffsetMinutes: -600, viewportWidth: 1920, viewportHeight: 1080, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 16, deviceMemory: 32, webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-IN', country: 'IN', timezoneId: 'Asia/Kolkata', timezoneOffsetMinutes: -330, viewportWidth: 1536, viewportHeight: 864, deviceScaleFactor: 1.25, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8, webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)' },
  { uaFullVersion: UA_VERSION, locale: 'en-IN', country: 'IN', timezoneId: 'Asia/Kolkata', timezoneOffsetMinutes: -330, viewportWidth: 1366, viewportHeight: 768, deviceScaleFactor: 1, platform: 'Linux x86_64', platformVersion: '6.5.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 4, deviceMemory: 8, webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 OpenGL 4.6)' },
  { uaFullVersion: UA_VERSION, locale: 'en-US', country: 'US', timezoneId: 'America/Denver', timezoneOffsetMinutes: 420, viewportWidth: 1280, viewportHeight: 720, deviceScaleFactor: 1, platform: 'Win32', platformVersion: '15.0.0', isMobile: false, hasTouch: false, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 16, webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon 680M Direct3D11 vs_5_0 ps_5_0)' },
];

const profileByProxy = new Map<string, Profile>();

function countryFromLabel(label?: string): string | null {
  if (!label) return null;
  const m = label.toUpperCase().match(/\b([A-Z]{2})\b/);
  return m ? m[1] : null;
}

function pickProfile(proxyLabel?: string): Profile {
  const key = proxyLabel ?? 'default';
  const cached = profileByProxy.get(key);
  if (cached) return cached;

  const country = countryFromLabel(proxyLabel);
  const matching = country ? PROFILES.filter((p) => p.country === country) : [];
  const pool = matching.length > 0 ? matching : PROFILES;
  const picked = pool[Math.floor(Math.random() * pool.length)];

  profileByProxy.set(key, picked);
  return picked;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
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
  private browser: any = null;
  private tabs = new Map<string, ManagedTab>();
  private readonly maxTabs: number;
  private readonly proxyManager: ProxyManager;
  private pluginManager: IPluginManager;
  private readonly browserOptions: TabManagerBrowserOptions;
  private readonly forceIPv4: boolean;
  private readonly stealthMode: boolean;
  private isShuttingDown = false;
  private relaunchAttempts = 0;
  private static readonly MAX_RELAUNCH_ATTEMPTS = 5;
  private static readonly RELAUNCH_BACKOFF_BASE_MS = 2000;
  private onBrowserLaunched: (() => void) | null | undefined = null;
  private launchVia: string | null = null;

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
    this.pluginManager =
      pluginManager ?? ({ getHandler: () => undefined, getAvailableTaskTypes: () => [] } as IPluginManager);
    this.browserOptions = { ...DEFAULT_BROWSER_OPTIONS, ...browserOptions };
    this.onBrowserLaunched = onBrowserLaunched;

    const browserConfig = configService.getBrowserConfig();
    this.forceIPv4 = browserConfig.forceIPv4 ?? true;
    this.stealthMode = browserConfig.stealthMode ?? true;
  }

  async init() {
    await this.launchBrowser();
  }

  private buildArgs(): string[] {
    const args = [
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--enforce-webrtc-ip-permission-check',
      '--disable-features=TranslateUI,BlinkGenPropertyTrial,WebRtcHideLocalIpsWithMdns,AudioServiceOutOfProcess',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-service-autorun',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-component-extensions-with-background-pages',
      '--exclude-switches=enable-automation',
    ];

    if (this.forceIPv4) args.push('--disable-ipv6');
    if (this.stealthMode) args.push('--disable-infobars', '--disable-field-trial-config');

    return args;
  }

  private async launchBrowser(): Promise<void> {
    const args = this.buildArgs();

    const attempts: Array<{ label: string; run: () => Promise<any> }> = [
      {
        label: 'patchright+channel:chrome',
        run: () => stealthChromium.launch({ headless: this.browserOptions.headless, args, channel: 'chrome' }),
      },
      ...CHROME_CANDIDATES.filter(Boolean).map((executablePath) => ({
        label: `patchright+${executablePath}`,
        run: () => stealthChromium.launch({ headless: this.browserOptions.headless, args, executablePath }),
      })),
      {
        label: 'patchright+bundled',
        run: () => stealthChromium.launch({ headless: this.browserOptions.headless, args }),
      },
    ];

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        this.browser = await attempt.run();
        this.launchVia = attempt.label;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!this.browser) {
      throw new Error(`Could not launch any browser: ${(lastError as Error)?.message ?? 'unknown'}`);
    }

    logger.info(`Browser launched via ${this.launchVia}`);
    await this.assertCodecSupport();

    this.browser.on('disconnected', () => this.handleBrowserDisconnected());
    this.onBrowserLaunched?.();
  }

  private async assertCodecSupport(): Promise<void> {
    if (!this.browser) return;
    let ctx: any = null;
    try {
      ctx = await this.browser.newContext();
      const page = await ctx.newPage();

      // EME needs a secure context; about:blank is not one.
      await page
        .goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 25_000 })
        .catch(() => {});

      const caps = await page.evaluate(async () => {
        const v = document.createElement('video');
        let widevine = false;
        try {
          await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
            { initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] },
          ]);
          widevine = true;
        } catch {
          /* unavailable */
        }
        return {
          secure: window.isSecureContext,
          h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
          aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
          vp9: v.canPlayType('video/webm; codecs="vp9"'),
          av1: v.canPlayType('video/mp4; codecs="av01.0.05M.08"'),
          widevine,
        };
      });

      logger.info(
        `Codecs h264="${caps.h264}" aac="${caps.aac}" vp9="${caps.vp9}" av1="${caps.av1}" widevine=${caps.widevine}`
      );

      if (!caps.h264 || !caps.aac) {
        this.emitEvent({
          tabId: 'system',
          kind: 'error',
          data: 'Browser cannot decode H.264/AAC — install Google Chrome. YouTube returns player error 5 without it.',
          timestamp: Date.now(),
        });
      }
      if (!caps.widevine) {
        logger.warn('Widevine unavailable — DRM-protected videos will fail. Non-DRM videos are unaffected.');
      }
    } catch (err) {
      logger.warn('Codec probe failed', err);
    } finally {
      await ctx?.close().catch(() => {});
    }
  }

  private handleBrowserDisconnected(): void {
    if (this.isShuttingDown) {
      this.browser = null;
      return;
    }

    logger.error('Browser disconnected — clearing tabs');
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
      logger.error(`Browser failed to relaunch after ${TabManager.MAX_RELAUNCH_ATTEMPTS} attempts`);
      this.emitEvent({
        tabId: 'system',
        kind: 'error',
        data: `Browser could not be restarted after ${TabManager.MAX_RELAUNCH_ATTEMPTS} attempts. Restart the app.`,
        timestamp: Date.now(),
      });
      return;
    }

    this.relaunchAttempts += 1;
    const attempt = this.relaunchAttempts;
    await new Promise((r) => setTimeout(r, TabManager.RELAUNCH_BACKOFF_BASE_MS * attempt));
    if (this.isShuttingDown) return;

    try {
      await this.launchBrowser();
      this.relaunchAttempts = 0;
      this.emitEvent({ tabId: 'system', kind: 'status', data: 'Browser relaunched after crash', timestamp: Date.now() });
    } catch (err) {
      logger.error(`Relaunch ${attempt} failed`, err);
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

  private storagePathFor(proxyLabel?: string): string {
    const key = (proxyLabel ?? 'default').replace(/[^a-z0-9]+/gi, '_');
    return path.join(process.cwd(), 'profiles', `${key}.json`);
  }

  async createTab(label?: string, _fp?: BrowserContext): Promise<TabState> {
    if (!this.browser) throw new Error('Browser not initialized');
    if (this.tabs.size >= this.maxTabs) throw new Error(`Tab limit reached (${this.maxTabs})`);

    const id = randomUUID();
    const proxy = this.proxyManager.assign(id);
    const profile = pickProfile(proxy?.label);

    const state: TabState = {
      id,
      label: label ?? `Tab ${this.tabs.size + 1}`,
      status: 'launching',
      createdAt: Date.now(),
      proxyLabel: proxy?.label,
    };
    this.emitEvent({ tabId: id, kind: 'status', data: state, timestamp: Date.now() });

    // Restore the stored session for this proxy so the visitor identity survives
    // app restarts. First run for a proxy has nothing to restore.
    const statePath = this.storagePathFor(proxy?.label);
    let restoredState: any = undefined;
    try {
      restoredState = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch {
      /* first run */
    }

    // Explicit viewport: deviceScaleFactor is rejected with viewport: null.
    const context: BrowserContext = await this.browser.newContext({
      viewport: { width: profile.viewportWidth, height: profile.viewportHeight },
      screen: { width: profile.viewportWidth, height: profile.viewportHeight },
      userAgent: uaFor(profile.platform),
      locale: profile.locale,
      timezoneId: profile.timezoneId,
      deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      bypassCSP: this.browserOptions.bypassCSP,
      ignoreHTTPSErrors: this.browserOptions.ignoreHTTPSErrors,
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      forcedColors: 'none',
      storageState: restoredState,
      extraHTTPHeaders: {
        'Accept-Language': `${profile.locale},${profile.locale.split('-')[0]};q=0.9,en;q=0.8`,
      },
    });

    const seed = Math.floor(Math.random() * 0xffffffff);
    const hardened: HardenedFingerprint = {
      userAgent: uaFor(profile.platform),
      uaFullVersion: profile.uaFullVersion,
      locale: profile.locale,
      timezoneId: profile.timezoneId,
      timezoneOffsetMinutes: profile.timezoneOffsetMinutes,
      viewportWidth: profile.viewportWidth,
      viewportHeight: profile.viewportHeight,
      deviceScaleFactor: profile.deviceScaleFactor,
      platform: profile.platform,
      platformVersion: profile.platformVersion,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      maxTouchPoints: profile.maxTouchPoints,
      hardwareConcurrency: profile.hardwareConcurrency,
      deviceMemory: profile.deviceMemory,
      webglVendor: profile.webglVendor,
      webglRenderer: profile.webglRenderer,
      audioSampleRate: 48000,
      canvasSeed: seed,
      seed,
    };

    await applyHardening(context as unknown as import('patchright').BrowserContext, hardened);

    const page: Page = await context.newPage();

    const managed: ManagedTab = { state, context, page, closed: false };
    this.tabs.set(id, managed);

    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    } catch {
      /* non-Chromium */
    }

    page.on('console', (msg) => {
      if (managed.closed) return;
      const text = msg.text();
      if (/generate_204|googlevideo\.com|was preloaded using link preload/.test(text)) return;
      this.emitEvent({ tabId: id, kind: 'log', data: text, timestamp: Date.now() });
    });

    page.on('framenavigated', (frame) => {
      if (managed.closed || frame !== page.mainFrame()) return;
      this.emitEvent({ tabId: id, kind: 'log', data: `[nav] ${frame.url()}`, timestamp: Date.now() });
    });

    page.on('crash', () => this.markError(id, 'Page crashed'));
    page.on('close', () => this.handleTabGone(id));
    context.on('close', () => this.handleTabGone(id));

    setTimeout(() => {
      if (!this.tabs.get(id)?.closed) this.markStatus(id, 'idle');
    }, 500 + Math.random() * 1000);

    return this.tabs.get(id)!.state;
  }

  async fingerprintReport(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error(`Tab ${id} not found`);
    return readFingerprintReport(tab.page as unknown as import('patchright').Page);
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

    try {
      const target = this.storagePathFor(tab.state.proxyLabel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify(await tab.context.storageState()), 'utf8');
    } catch (e) {
      logger.warn('storageState save failed', e);
    }

    await tab.context.close().catch((e) => logger.warn('closeTab error', e));
    this.handleTabGone(id);
  }

  async runTask(id: string, task: TabTask): Promise<unknown> {
    const tab = this.tabs.get(id);
    if (!tab || tab.closed) throw new Error(`Tab ${id} is no longer available (closed or crashed)`);

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

  async runBroadcastTask(
    task: Omit<TabTask, 'id'>,
    tabIds?: string[]
  ): Promise<Array<{ id: string; result: unknown }>> {
    const targets = tabIds ?? [...this.tabs.keys()].filter((id) => !this.tabs.get(id)?.closed);
    const results: Array<{ id: string; result: unknown }> = [];

    for (let i = 0; i < targets.length; i++) {
      const id = targets[i];
      const tab = this.tabs.get(id);
      if (!tab || tab.closed) {
        results.push({ id, result: new Error(`Tab ${id} is no longer available`) });
        continue;
      }
      if (i > 0) await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 6000) + i * 900));
      try {
        results.push({ id, result: await this.dispatchTask(tab, { ...task, id }) });
      } catch (err: any) {
        results.push({ id, result: err });
      }
    }

    return results;
  }

  private async dispatchTask(tab: ManagedTab, task: TabTask): Promise<unknown> {
    await randomDelay(100, 500);

    const executionContext: TaskExecutionContext = {
      isTabValid: () => !tab.closed && this.tabs.has(tab.state.id),
      emitEvent: (kind, data) => {
        this.emitEvent({ tabId: tab.state.id, kind, data, timestamp: Date.now() });
      },
      randomDelay,
      simulateHumanInteraction: async (page: any) => {
        try {
          const size = page.viewportSize?.() ?? { width: 1280, height: 720 };
          await page.mouse.move(
            Math.random() * size.width * 0.7 + size.width * 0.15,
            Math.random() * size.height * 0.7 + size.height * 0.15,
            { steps: 5 + Math.floor(Math.random() * 10) }
          );
          if (Math.random() < 0.3) await page.evaluate(() => window.scrollBy(0, Math.random() * 120 - 40));
        } catch {
          /* ignore */
        }
      },
      handleYouTubeConsent: async (page: any) => {
        await page
          .evaluate(() => {
            const sels = [
              'ytd-consent-bump-v2-lightbox ytd-button-renderer:last-of-type button',
              'tp-yt-paper-dialog ytd-button-renderer:last-of-type button',
              'form[action*="consent"] button',
              'button[aria-label*="Accept all"]',
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
        await new Promise((r) => setTimeout(r, 800));
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
        this.proxyManager.markProxyFailed(tab.state.id, reason);
      },
    };

    const handler = this.pluginManager.getHandler(task.type);
    if (handler) return await handler.execute(tab, task, executionContext);

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
      /* mid-teardown */
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
    for (const tab of this.tabs.values()) if (tab.loopTimer) clearInterval(tab.loopTimer);
    await Promise.allSettled([...this.tabs.keys()].map((id) => this.closeTab(id)));
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}