// src/main/config/configService.ts
import { AppConfig, AppSettings, BrowserConfig, LoggingConfig, ProxyConfig, SecurityConfig, AutomationConfig, AntiDetectionConfig } from './configTypes';
import type { ProxyRotationStrategy } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Helper function to get the correct base path for app data
const getAppPath = () => {
  try {
    // When packaged, use the directory containing the executable
    if (app.isPackaged) {
      // In packaged apps, the executable is in a different location than the app.asar
      // We want to use the directory where the executable resides for user data
      const exePath = app.getPath('exe');
      if (exePath) {
        return path.dirname(exePath);
      }
      // Fallback to app.getAppPath() if exePath fails
      return app.getAppPath();
    }

    // When not packaged (development), use the current working directory
    // or the directory of the main script
    try {
      // Try to get the app path first
      const appPath = app.getAppPath();
      if (appPath) {
        return appPath;
      }
    } catch (e) {
      // Ignore errors and continue to fallbacks
    }

    // Fallback to current working directory
    return process.cwd();
  } catch (e) {
    // Final fallback to ensure we always return a valid path
    try {
      return path.resolve('.');
    } catch {
      // Last resort - use system temp directory
      return require('os').tmpdir();
    }
  }
};

class ConfigService {
  private static instance: ConfigService;
  private config: AppConfig;
  private envPrefix: string;
  private configFileName: string;

  private constructor(options: { envPrefix?: string; configFileName?: string } = {}) {
    this.envPrefix = options.envPrefix ?? 'APP';
    this.configFileName = options.configFileName ?? 'config.json';
    this.config = this.loadConfiguration();
  }

  public static getInstance(options: { envPrefix?: string; configFileName?: string } = {}): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(options);
    }
    return ConfigService.instance;
  }

  private loadConfiguration(): AppConfig {
    // Start with default configuration
    let config = this.getDefaultConfig();

    // Override with environment variables
    config = this.mergeWithEnvironment(config);

    // Override with config file
    config = this.mergeWithConfigFile(config);

    return config;
  }

  private getDefaultConfig(): AppConfig {
    return {
      browser: {
        headless: false,
        maxTabs: 20,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--autoplay-policy=no-user-gesture-required',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
          '--enforce-webrtc-ip-permission-check',
          // Anti-detection flags (added by TabManager.launchBrowser)
          '--disable-ipv6',
          '--disable-features=WebRtcHideLocalIpsWithMdns',
        ],
        bypassCSP: true,
        ignoreHTTPSErrors: true,
        forceIPv4: true,
        stealthMode: true,
      },
      proxy: {
        enabled: true,
        strategy: 'round-robin',
        rotationIntervalMs: 0, // 0 means no rotation, assign once per tab
        list: [],
      },
      logging: {
        level: 'info',
        filePath: 'logs/app.log',
        maxSize: '10mb',
        maxFiles: 5,
      },
      security: {
        enableWebSecurity: true,
        enableRemoteModule: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../preload/index.js'),
        enableEncryption: false,
      },
      automation: {
        defaultTimeout: 30000, // 30 seconds
        retryAttempts: 3,
        retryDelay: 1000, // 1 second
        enablePlugins: true,
      },
      antidetection: {
        enabled: true,
        trustedInput: true,
        poissonMeanMs: 250,
        delayMinMs: 90,
        delayMaxMs: 900,
        jitterPx: 6,
        bezierSteps: 12,
        preferResidential: true,
        resetSession: true,
        clearYouTubeTrackerCookies: true,
        // Advanced anti-detection features
        enableFontProtection: true,
        enableAudioVideoProtection: true,
        enableNetworkProtection: true,
        enablePlaywrightEvasion: true,
        enableEnvironmentalConsistency: true,
        enableAdvancedCanvasWebGL: true,
        enableHeaderRandomization: true,
        enableBehavioralBiometrics: true,
        enableAdvancedCanvasFingerprinting: true,
        enableWebGPUProtection: true,
        enableNetworkTrafficShaping: true,
        enableMemoryAnalyticsProtection: true,
        enableSensorSpoofing: true,
        enablePluginEnumerationSpoofing: true,
        enableStorageApiProtection: true,
        enableCSSMediaQueryProtection: true,
        enableFontRenderingVariance: true,
  // Content-aware engagement simulation (likes, comments, shares)
  enableContentAwareEngagement: true,
      // Advanced session lifecycle simulation (fatigue, breaks, circadian rhythms)
      enableAdvancedSessionLifecycle: true,
      }
    };
  }

  private mergeWithEnvironment(config: AppConfig): AppConfig {
    // Helper to get environment variable with prefix
    const getEnv = (key: string): string | undefined => {
      return process.env[`${this.envPrefix}_${key}`];
    };

    // Browser
    if (getEnv('BROWSER_HEADLESS') !== undefined) {
      config.browser.headless = getEnv('BROWSER_HEADLESS') === 'true';
    }
    if (getEnv('BROWSER_MAXTABS')) {
      config.browser.maxTabs = parseInt(getEnv('BROWSER_MAXTABS')!, 10);
    }
    if (getEnv('BROWSER_BYPASSCSP') !== undefined) {
      config.browser.bypassCSP = getEnv('BROWSER_BYPASSCSP') === 'true';
    }
    if (getEnv('BROWSER_IGNOREHTTPSERRORS') !== undefined) {
      config.browser.ignoreHTTPSErrors = getEnv('BROWSER_IGNOREHTTPSERRORS') === 'true';
    }
    if (getEnv('BROWSER_FORCEIPV4') !== undefined) {
      config.browser.forceIPv4 = getEnv('BROWSER_FORCEIPV4') === 'true';
    }
    if (getEnv('BROWSER_STEALTHMODE') !== undefined) {
      config.browser.stealthMode = getEnv('BROWSER_STEALTHMODE') === 'true';
    }
    // Note: args from environment is complex, we'll skip for now

    // Proxy
    if (getEnv('PROXY_ENABLED') !== undefined) {
      config.proxy.enabled = getEnv('PROXY_ENABLED') === 'true';
    }
    const validStrategies: ProxyRotationStrategy[] = ['round-robin', 'random', 'sticky-per-tab', 'tier-round-robin'];
    const envStrategy = getEnv('PROXY_STRATEGY');
    if (envStrategy) {
      if ((validStrategies as string[]).includes(envStrategy)) {
        config.proxy.strategy = envStrategy as ProxyRotationStrategy;
      } else {
        console.warn(
          `Ignoring invalid ${this.envPrefix}_PROXY_STRATEGY value "${envStrategy}" — must be one of ${validStrategies.join(', ')}`
        );
      }
    }
    if (getEnv('PROXY_ROTATIONINTERVALMS')) {
      config.proxy.rotationIntervalMs = parseInt(getEnv('PROXY_ROTATIONINTERVALMS')!, 10);
    }
    // Proxy list from environment is complex, we'll skip for now

    // Logging
    if (getEnv('LOGGING_LEVEL')) {
      config.logging.level = getEnv('LOGGING_LEVEL') as any;
    }
    if (getEnv('LOGGING_FILEPATH')) {
      config.logging.filePath = getEnv('LOGGING_FILEPATH')!;
    }
    if (getEnv('LOGGING_MAXSIZE')) {
      config.logging.maxSize = getEnv('LOGGING_MAXSIZE')!;
    }
    if (getEnv('LOGGING_MAXFILES')) {
      config.logging.maxFiles = parseInt(getEnv('LOGGING_MAXFILES')!, 10);
    }

    // Security
    if (getEnv('SECURITY_ENABLEWEBSECURITY') !== undefined) {
      config.security.enableWebSecurity = getEnv('SECURITY_ENABLEWEBSECURITY') === 'true';
    }
    if (getEnv('SECURITY_ENABLEREMOTEMODULE') !== undefined) {
      config.security.enableRemoteModule = getEnv('SECURITY_ENABLEREMOTEMODULE') === 'true';
    }
    if (getEnv('SECURITY_CONTEXTISOLATION') !== undefined) {
      config.security.contextIsolation = getEnv('SECURITY_CONTEXTISOLATION') === 'true';
    }
    if (getEnv('SECURITY_NODEINTEGRATION') !== undefined) {
      config.security.nodeIntegration = getEnv('SECURITY_NODEINTEGRATION') === 'true';
    }
    if (getEnv('SECURITY_PRELOAD')) {
      config.security.preload = getEnv('SECURITY_PRELOAD')!;
    }
    if (getEnv('SECURITY_ENABLEENCRYPTION') !== undefined) {
      config.security.enableEncryption = getEnv('SECURITY_ENABLEENCRYPTION') === 'true';
    }

    // Automation
    if (getEnv('AUTOMATION_DEFAULTTIMEOUT')) {
      config.automation.defaultTimeout = parseInt(getEnv('AUTOMATION_DEFAULTTIMEOUT')!, 10);
    }
    if (getEnv('AUTOMATION_RETRYATTEMPTS')) {
      config.automation.retryAttempts = parseInt(getEnv('AUTOMATION_RETRYATTEMPTS')!, 10);
    }
    if (getEnv('AUTOMATION_RETRYDELAY')) {
      config.automation.retryDelay = parseInt(getEnv('AUTOMATION_RETRYDELAY')!, 10);
    }
    if (getEnv('AUTOMATION_ENABLEPLUGINS')) {
      config.automation.enablePlugins = getEnv('AUTOMATION_ENABLEPLUGINS') === 'true';
    }

    // Antidetection (APP_ANTIDETECTION_*). All defaults OFF; env only flips
    // values that are explicitly set, so an unset env var never changes the
    // default — identical to the pre-antidetection runtime path.
    if (getEnv('ANTIDETECTION_ENABLED') !== undefined) {
      config.antidetection.enabled = getEnv('ANTIDETECTION_ENABLED') === 'true';
    }
    if (getEnv('ANTIDETECTION_TRUSTEDINPUT') !== undefined) {
      config.antidetection.trustedInput = getEnv('ANTIDETECTION_TRUSTEDINPUT') === 'true';
    }
    if (getEnv('ANTIDETECTION_POISSONMEANMS')) {
      config.antidetection.poissonMeanMs = parseInt(getEnv('ANTIDETECTION_POISSONMEANMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_DELAYMINMS')) {
      config.antidetection.delayMinMs = parseInt(getEnv('ANTIDETECTION_DELAYMINMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_DELAYMAXMS')) {
      config.antidetection.delayMaxMs = parseInt(getEnv('ANTIDETECTION_DELAYMAXMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_JITTERPX')) {
      config.antidetection.jitterPx = parseInt(getEnv('ANTIDETECTION_JITTERPX')!, 10);
    }
    if (getEnv('ANTIDETECTION_BEZIERSTEPS')) {
      config.antidetection.bezierSteps = parseInt(getEnv('ANTIDETECTION_BEZIERSTEPS')!, 10);
    }
    if (getEnv('ANTIDETECTION_PREFERRESIDENTIAL') !== undefined) {
      config.antidetection.preferResidential = getEnv('ANTIDETECTION_PREFERRESIDENTIAL') === 'true';
    }
    if (getEnv('ANTIDETECTION_RESETSESSION') !== undefined) {
      config.antidetection.resetSession = getEnv('ANTIDETECTION_RESETSESSION') === 'true';
    }
    if (getEnv('ANTIDETECTION_CLEARTRACKERCOOKIES') !== undefined) {
      config.antidetection.clearYouTubeTrackerCookies = getEnv('ANTIDETECTION_CLEARTRACKERCOOKIES') === 'true';
    }

    return config;
  }

  private mergeWithConfigFile(config: AppConfig): AppConfig {
    const configFilePath = path.join(getAppPath(), this.configFileName);
    if (fs.existsSync(configFilePath)) {
      try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        // Simple merge - in a production app you might want to use a proper deep merge library
        return {
          ...config,
          ...fileConfig,
          browser: { ...config.browser, ...(fileConfig.browser || {}) },
          proxy: {
            ...config.proxy,
            ...(fileConfig.proxy || {}),
            list: [...(config.proxy.list || []), ...(fileConfig.proxy?.list || [])] // Merge arrays
          },
          logging: { ...config.logging, ...(fileConfig.logging || {}) },
          security: { ...config.security, ...(fileConfig.security || {}) },
          automation: { ...config.automation, ...(fileConfig.automation || {}) },
          antidetection: { ...config.antidetection, ...(fileConfig.antidetection || {}) }
        };
      } catch (error) {
        console.error(`Error loading config file ${configFilePath}:`, error);
        // If there's an error, we'll stick with the current config (from defaults and env)
      }
    }
    return config;
  }

  // Getters for each section
  getBrowserConfig(): BrowserConfig {
    return { ...this.config.browser };
  }

  getProxyConfig(): { enabled: boolean; strategy: ProxyRotationStrategy; rotationIntervalMs: number; list: ProxyConfig[] } {
    return { ...this.config.proxy };
  }

  getLoggingConfig(): LoggingConfig {
    return { ...this.config.logging };
  }

  getSecurityConfig(): SecurityConfig {
    return { ...this.config.security };
  }

  getAutomationConfig(): AutomationConfig {
    return { ...this.config.automation };
  }

  getAntiDetectionConfig(): AntiDetectionConfig {
    return { ...this.config.antidetection };
  }

  getAppSettings(): AppSettings {
    return {
      browser: {
        headless: this.config.browser.headless,
        maxTabs: this.config.browser.maxTabs,
      },
      automation: { ...this.config.automation },
    };
  }

  updateAppSettings(settings: Partial<AppSettings>): AppSettings {
    this.config = {
      ...this.config,
      browser: {
        ...this.config.browser,
        ...(settings.browser || {}),
      },
      automation: {
        ...this.config.automation,
        ...(settings.automation || {}),
      },
    };

    this.persistConfiguration();
    return this.getAppSettings();
  }

  // For testing or resetting
  reset(): void {
    this.config = this.getDefaultConfig();
  }

  private persistConfiguration(): void {
    const configFilePath = path.join(process.cwd(), this.configFileName);
    const serializableConfig = {
      browser: this.config.browser,
      proxy: this.config.proxy,
      logging: this.config.logging,
      security: this.config.security,
      automation: this.config.automation,
      antidetection: this.config.antidetection,
    };

    fs.writeFileSync(configFilePath, JSON.stringify(serializableConfig, null, 2), 'utf8');
  }
}

// Export a singleton instance
export const configService = ConfigService.getInstance();