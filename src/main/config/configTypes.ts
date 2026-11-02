// src/main/config/configTypes.ts
import type { AntiDetectionConfig } from '../automation/antidetection/types';
import type { ProxyRotationStrategy, ProxyTier } from '../../shared/types';

// Re-export AntiDetectionConfig so it can be used by other modules
export { AntiDetectionConfig };

export interface BrowserConfig {
  headless: boolean;
  maxTabs: number;
  args: string[];
  /** Playwright context option — bypasses page CSP. Defaults to true (existing behavior). */
  bypassCSP: boolean;
  /** Playwright context option — ignores TLS certificate errors. Needed for some
   *  proxy providers that present self-signed certs, but means a malicious/
   *  compromised proxy can MITM traffic undetected. Defaults to true (existing
   *  behavior); expose a way to turn it off for security-sensitive use. */
  ignoreHTTPSErrors: boolean;
  /** Anti-detection: Force IPv4 only to prevent IPv6 leaks with IPv4 proxies */
  forceIPv4: boolean;
  /** Anti-detection: Enable advanced stealth mode with comprehensive fingerprinting protection */
  stealthMode: boolean;
}

export interface ProxyConfig {
  label: string;
  server: string;
  username?: string;
  password?: string;
  /** Source category for tier-aware rotation. Optional and additive; omitting it
   *  leaves ProxyManager assignment order identical to today. See `ProxyTier`. */
  tier?: ProxyTier;
}

export interface ProxyRotationStrategyOptions {
  // Strategy-specific options can be added here
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  filePath: string;
  maxSize: string; // e.g., '10mb'
  maxFiles: number;
}

export interface SecurityConfig {
  enableWebSecurity: boolean;
  enableRemoteModule: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  preload: string; // path to preload script
  enableEncryption: boolean;
}

export interface AutomationConfig {
  defaultTimeout: number; // in milliseconds
  retryAttempts: number;
  retryDelay: number; // in milliseconds
  enablePlugins: boolean;
}

export interface AppConfig {
  browser: BrowserConfig;
  proxy: {
    enabled: boolean;
    strategy: ProxyRotationStrategy;
    rotationIntervalMs: number;
    list: ProxyConfig[];
  };
  logging: LoggingConfig;
  security: SecurityConfig;
  automation: AutomationConfig;
  /** YouTube/automation anti-detection hardening layer. All measures OFF by
   *  default; the app is behaviorally identical to pre-antidetection builds
   *  while `enabled` is false. See AntiDetectionConfig for per-toggle docs. */
  antidetection: AntiDetectionConfig;
}

export interface AppSettings {
  browser: Pick<BrowserConfig, 'headless' | 'maxTabs'>;
  automation: AutomationConfig;
}