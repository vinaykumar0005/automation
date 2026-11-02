// src/main/automation/plugins/basePlugin.ts
export interface IPlugin {
  initialize(): Promise<void>;
  getHandlers(): Record<string, ITaskHandler>;
  dispose(): Promise<void>;
}

/** Context passed to task handlers for enhanced capabilities */
export interface TaskExecutionContext {
  /** Check if the tab is still valid and not closed */
  isTabValid: () => boolean;
  /** Emit events to the renderer (status, log, result, error) */
  emitEvent: (kind: 'status' | 'log' | 'result' | 'error', data: unknown) => void;
  /** Get a random delay for human-like behavior */
  randomDelay: (minMs: number, maxMs: number) => Promise<void>;
  /** Simulate human-like interaction on the page */
  simulateHumanInteraction: (page: any) => Promise<void>;
  /** Handle YouTube-specific consent/age gate banners */
  handleYouTubeConsent: (page: any) => Promise<void>;
  /** Clear session data (cookies, localStorage, sessionStorage, IndexedDB, Cache) for fresh session */
  clearSessionData: (page: any) => Promise<void>;
  /** Set video playback quality (YouTube) */
  setVideoQuality: (page: any, quality: string) => Promise<void>;
  /** Mark current tab's proxy as failed to trigger rotation */
  markProxyFailed: (reason: string) => void;
  /** Human-like mouse movement using bezier curves */
  humanMouseMove?: (page: any, w: number, h: number) => Promise<void>;
  /** Human-like scrolling */
  humanScroll?: (page: any) => Promise<void>;
  /** Trusted click via CDP (anti-detection) */
  trustedClick?: (page: import('playwright').Page, selector: string, opts: import('../antidetection/trustedInput').TrustedClickOptions) => Promise<boolean>;
  /** Trusted clicks over selector list (anti-detection consent handling) */
  trustedConsentClick?: (page: import('playwright').Page, selectors: string[], opts: import('../antidetection/trustedInput').TrustedClickOptions) => Promise<number>;
  /** Fresh-identity reset (anti-detection session hygiene) */
  resetSession?: (page: import('playwright').Page, opts?: import('../antidetection/sessionHygiene').ResetSessionOptions) => Promise<void>;
  /** Advanced font fingerprinting protection */
  applyFontProtection?: (page: import('playwright').Page) => Promise<void>;
  /** Advanced audio and video protection */
  applyAudioVideoProtection?: (page: import('playwright').Page) => Promise<void>;
  /** Advanced network and proxy protections */
  applyNetworkProtection?: (page: import('playwright').Page) => Promise<void>;
  /** Playwright/Electron-specific evasion techniques */
  applyPlaywrightEvasion?: (page: import('playwright').Page) => Promise<void>;
  /** Environmental consistency checks */
  applyEnvironmentalConsistency?: (page: import('playwright').Page) => Promise<void>;
  /** Advanced canvas and WebGL protections */
  applyAdvancedCanvasWebGL?: (page: import('playwright').Page) => Promise<void>;
  /** Header and request randomization */
  applyHeaderRandomization?: (page: import('playwright').Page) => Promise<void>;
}

export interface ITaskHandler {
  execute(tab: any, task: any, context?: TaskExecutionContext): Promise<any>;
  canHandle(taskType: string): boolean;
}

export interface IPluginManager {
  getHandler(taskType: string): ITaskHandler | undefined;
  getAvailableTaskTypes(): string[];
}