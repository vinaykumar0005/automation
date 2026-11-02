// src/main/automation/antidetection/types.ts
import type { ProxyTier } from '../../../shared/types';

/**
 * The `antidetection` config block. All measures are OFF by default and every
 * measure is additive — when `enabled` is false the app behaves byte-for-byte
 * identically to today. See the implementation plan for details.
 */
export interface AntiDetectionConfig {
  /** Master switch for the whole layer. Default false. */
  enabled: boolean;

  /** Input simulation — trusted CDP-backed clicks with bezier cursor jitter
   *  and Poisson inter-action delays. Also replaces synthetic `el.click()` calls
   *  in the consent handlers with trusted locator clicks. Default false. */
  trustedInput: boolean;

  /** Poisson distribution mean (ms) for inter-action delays. Default 250.
   *  Sampled with Knuth's algorithm and clamped to [delayMinMs, delayMaxMs]. */
  poissonMeanMs: number;
  /** Min inter-action delay (ms). Default 90. */
  delayMinMs: number;
  /** Max inter-action delay (ms). Default 900. */
  delayMaxMs: number;
  /** Max cursor offset jitter (px) around the click target center. Default 6. */
  jitterPx: number;
  /** Mouse-move interpolation steps along the bezier path. Default 12. */
  bezierSteps: number;

  /** Proxy hygiene — order the healthy pool to prefer residential/mobile over
   *  datacenter. Only reorders proxies that carry a `tier` tag; an all-unknown
   *  pool is left in existing order (identical to OFF). Default false.
   *  DATACENTER proxies are treated as high-risk: see README. */
  preferResidential: boolean;

  /** Session lifecycle — expose a `resetSession` context method that clears
   *  cookies/localStorage/sessionStorage/IndexedDB/Cache/ServiceWorkers at task
   *  boundaries. Default false. */
  resetSession: boolean;
  /** When resetSession runs, also clear YouTube tracker cookies (YSC,
   *  VISITOR_INFO1_LIVE) for a fresh-identity start. Default false.
   *  Independently useful even when resetSession is off: the consent/navigate
   *  clear path can target these by name instead of nuking all cookies. */
  clearYouTubeTrackerCookies: boolean;

  /** Advanced font fingerprinting protection. Default false. */
  enableFontProtection: boolean;
  /** Advanced audio and video protection. Default false. */
  enableAudioVideoProtection: boolean;
  /** Advanced network and proxy protections. Default false. */
  enableNetworkProtection: boolean;
  /** Playwright/Electron-specific evasion techniques. Default false. */
  enablePlaywrightEvasion: boolean;
  /** Environmental consistency checks (geoip, timezone, hardware, etc.). Default false. */
  enableEnvironmentalConsistency: boolean;
  /** Advanced canvas and WebGL protections. Default false. */
  enableAdvancedCanvasWebGL: boolean;
  /** Header and request randomization. Default false. */
  enableHeaderRandomization: boolean;
  /** Behavioral biometrics spoofing. Default false. */
  enableBehavioralBiometrics: boolean;
  /** Advanced canvas fingerprinting protection. Default false. */
  enableAdvancedCanvasFingerprinting: boolean;
  /** WebGPU protection. Default false. */
  enableWebGPUProtection: boolean;
  /** Network traffic shaping. Default false. */
  enableNetworkTrafficShaping: boolean;
  /** Memory analytics protection. Default false. */
  enableMemoryAnalyticsProtection: boolean;
  /** Sensor spoofing. Default false. */
  enableSensorSpoofing: boolean;
  /** Plugin enumeration deep spoofing. Default false. */
  enablePluginEnumerationSpoofing: boolean;
  /** Storage API protection. Default false. */
  enableStorageApiProtection: boolean;
  /** CSS media query protection. Default false. */
  enableCSSMediaQueryProtection: boolean;
  /** Font rendering variance protection. Default false. */
  enableFontRenderingVariance: boolean;
  /** Content-aware engagement simulation (likes, comments, shares). Default false. */
  enableContentAwareEngagement: boolean;
  /** Advanced session lifecycle simulation (fatigue, breaks, circadian rhythms). Default false. */
  enableAdvancedSessionLifecycle: boolean;
}

/** Off-by-default / conservative settings. Never changes existing behavior. */
export const DEFAULT_ANTIDETECTION_CONFIG: AntiDetectionConfig = {
  enabled: false,
  trustedInput: false,
  poissonMeanMs: 250,
  delayMinMs: 90,
  delayMaxMs: 900,
  jitterPx: 6,
  bezierSteps: 12,
  preferResidential: false,
  resetSession: false,
  clearYouTubeTrackerCookies: false,
  // Advanced features - enabled by default for maximum undetectability
  enableFontProtection: true,
  // Disabled: MediaKeySystemAccess DRM rewrite + AudioContext noise break media decoding.
  enableAudioVideoProtection: false,
  // Disabled: per-read navigator.connection randomization yields an inconsistent fingerprint.
  enableNetworkProtection: false,
  enablePlaywrightEvasion: true,
  enableEnvironmentalConsistency: true,
  enableAdvancedCanvasWebGL: true,
  // Disabled: per-request header reordering is an overt automation signal.
  enableHeaderRandomization: false,
  enableBehavioralBiometrics: true,
  // Disabled: canvas getImageData/position noise breaks media fingerprint consistency.
  enableAdvancedCanvasFingerprinting: false,
  enableWebGPUProtection: true,
  // Disabled: fetch/XHR delays and timer jitter break YouTube player/segment loading.
  enableNetworkTrafficShaping: false,
  enableMemoryAnalyticsProtection: true,
  enableSensorSpoofing: true,
  enablePluginEnumerationSpoofing: true,
  enableStorageApiProtection: true,
  enableCSSMediaQueryProtection: true,
  enableFontRenderingVariance: true,
  // Disabled: automated Like/Comment/Share/Subscribe clicks break playback and send bot signals.
  enableContentAwareEngagement: false,
  // Disabled: timer multiplication (up to ~2.5x) and beforeunload dialogs break player timing and navigation.
  enableAdvancedSessionLifecycle: false,
};

/** YouTube identity/tracker cookies cleared for a fresh-identity start.
 *  `YSC` is the session tracker; `VISITOR_INFO1_LIVE` is the long-lived A/B
 *  identity cookie YouTube uses to select experimental features. Clearing both
 *  yields a fresh per-session identity WITHOUT bypassing any login or challenge
 *  (out of scope — never implemented here). */
export const YOUTUBE_TRACKER_COOKIES: readonly string[] = ['YSC', 'VISITOR_INFO1_LIVE'];

/** Frozen snapshot of the resolved antidetection options handed to
 *  TabManager/ProxyManager at worker boundaries. `enabled:false` ⇒ all
 *  booleans are false and consumers must take the existing path untouched. */
export interface ResolvedOptions {
  readonly enabled: boolean;
  readonly trustedInput: boolean;
  readonly poissonMeanMs: number;
  readonly delayMinMs: number;
  readonly delayMaxMs: number;
  readonly jitterPx: number;
  readonly bezierSteps: number;
  readonly preferResidential: boolean;
  readonly resetSession: boolean;
  readonly clearYouTubeTrackerCookies: boolean;
  readonly enableFontProtection: boolean;
  readonly enableAudioVideoProtection: boolean;
  readonly enableNetworkProtection: boolean;
  readonly enablePlaywrightEvasion: boolean;
  readonly enableEnvironmentalConsistency: boolean;
  readonly enableAdvancedCanvasWebGL: boolean;
  readonly enableHeaderRandomization: boolean;
  readonly enableBehavioralBiometrics: boolean;
  readonly enableAdvancedCanvasFingerprinting: boolean;
  readonly enableWebGPUProtection: boolean;
  readonly enableNetworkTrafficShaping: boolean;
  readonly enableMemoryAnalyticsProtection: boolean;
  readonly enableSensorSpoofing: boolean;
  readonly enablePluginEnumerationSpoofing: boolean;
  readonly enableStorageApiProtection: boolean;
  readonly enableCSSMediaQueryProtection: boolean;
  readonly enableFontRenderingVariance: boolean;
  readonly enableContentAwareEngagement: boolean;
  readonly enableAdvancedSessionLifecycle: boolean;
}

/** Coerce a partial/incoming config to a complete ResolvedOptions, filling
 *  missing fields with defaults and clamping numerics to sane ranges. Pure. */
export function resolveOptions(cfg: Partial<AntiDetectionConfig> | undefined): ResolvedOptions {
  const base = { ...DEFAULT_ANTIDETECTION_CONFIG, ...(cfg ?? {}) };
  const clampInt = (n: number, lo: number, hi: number) =>
    Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : lo;
  return {
    enabled: !!base.enabled,
    trustedInput: !!base.trustedInput,
    poissonMeanMs: clampInt(base.poissonMeanMs, 1, 60_000),
    delayMinMs: clampInt(base.delayMinMs, 0, 60_000),
    delayMaxMs: clampInt(base.delayMaxMs, base.delayMinMs, 60_000),
    jitterPx: clampInt(base.jitterPx, 0, 100),
    bezierSteps: clampInt(base.bezierSteps, 1, 200),
    preferResidential: !!base.preferResidential,
    resetSession: !!base.resetSession,
    clearYouTubeTrackerCookies: !!base.clearYouTubeTrackerCookies,
    enableFontProtection: !!base.enableFontProtection,
    enableAudioVideoProtection: !!base.enableAudioVideoProtection,
    enableNetworkProtection: !!base.enableNetworkProtection,
    enablePlaywrightEvasion: !!base.enablePlaywrightEvasion,
    enableEnvironmentalConsistency: !!base.enableEnvironmentalConsistency,
    enableAdvancedCanvasWebGL: !!base.enableAdvancedCanvasWebGL,
    enableHeaderRandomization: !!base.enableHeaderRandomization,
    enableBehavioralBiometrics: !!base.enableBehavioralBiometrics,
    enableAdvancedCanvasFingerprinting: !!base.enableAdvancedCanvasFingerprinting,
    enableWebGPUProtection: !!base.enableWebGPUProtection,
    enableNetworkTrafficShaping: !!base.enableNetworkTrafficShaping,
    enableMemoryAnalyticsProtection: !!base.enableMemoryAnalyticsProtection,
    enableSensorSpoofing: !!base.enableSensorSpoofing,
    enablePluginEnumerationSpoofing: !!base.enablePluginEnumerationSpoofing,
    enableStorageApiProtection: !!base.enableStorageApiProtection,
    enableCSSMediaQueryProtection: !!base.enableCSSMediaQueryProtection,
    enableFontRenderingVariance: !!base.enableFontRenderingVariance,
    enableContentAwareEngagement: !!base.enableContentAwareEngagement,
    enableAdvancedSessionLifecycle: !!base.enableAdvancedSessionLifecycle,
  };
}
