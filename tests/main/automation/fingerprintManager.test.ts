import { FingerprintManager } from '../fingerprintManager';

// Define expected user agents explicitly for testing
const testUserAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
];

const testFingerprints = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
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
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
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
  },
];

describe('FingerprintManager', () => {
  let fingerprintManager: FingerprintManager;

  beforeEach(() => {
    fingerprintManager = new FingerprintManager();
  });

  it('should generate unique fingerprints', async () => {
    const results: any[] = [];
    // Test with multiple iterations to ensure variety
    for (let i = 0; i < 5; i++) {
      const fingerprint = fingerprintManager.generateFingerprint();
      results.push(fingerprint);
    }
    // Check for duplicates
    const uniqueResults = [...new Set(results.map(JSON.stringify))];
    expect(uniqueResults.length).toBeGreaterThan(1, 'Expected at least some variation in fingerprints');
  });

  it('should generate fingerprint with required properties', () => {
    const fingerprint = fingerprintManager.generateFingerprint();
    expect(fingerprint.userAgent).toBeDefined();
    expect(fingerprint.viewport).toBeDefined();
    expect(fingerprint.viewport.width).toBeGreaterThan(0);
    expect(fingerprint.viewport.height).toBeGreaterThan(0);
    expect(fingerprint.locale).toBeDefined();
    expect(fingerprint.timezoneId).toBeDefined();
    expect(fingerprint.isMobile).toBeDefined();
    expect(fingerprint.hasTouch).toBeDefined();
    expect(fingerprint.platform).toBeDefined();
    expect(fingerprint.webglVendor).toBeDefined();
    expect(fingerprint.webglRenderer).toBeDefined();
    expect(fingerprint.hardwareConcurrency).toBeGreaterThan(0);
    expect(fingerprint.deviceMemory).toBeGreaterThan(0);
  });

  it('should match expected user agents', () => {
    // Test against predefined user agents
    const assignedUserAgent = fingerprintManager.randomUA();
    expect(testUserAgents).toContain(assignedUserAgent,
      `Expected one of predefined user agents, but got: ${assignedUserAgent}`);
  });

  it('should generate realistic viewport dimensions', () => {
    const viewport = fingerprintManager.randomViewport();
    const commonWidths = [1024, 1280, 1440, 1600, 1920];
    const commonHeights = [768, 800, 900, 1080];
    expect(commonWidths).toContain(viewport.width,
      `Expected common width but got: ${viewport.width}`);
    expect(commonHeights).toContain(viewport.height,
      `Expected common height but got: ${viewport.height}`);
  });

  it('should generate valid locales', () => {
    const locales = ['en-US', 'en-GB', 'fr-FR', 'es-ES', 'de-DE'];
    const assignedLocale = fingerprintManager.randomLocale();
    expect(locales).toContain(assignedLocale);
  });

  it('should generate valid timezones', () => {
    const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
    const assignedTimezone = fingerprintManager.randomTimezone();
    expect(timezones).toContain(assignedTimezone);
  });
});