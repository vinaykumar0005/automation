import { ProxyManager } from '../../../src/main/automation/ProxyManager';
import type { ProxyConfig } from '../../../shared/types';
import { vi } from 'vitest';

describe('ProxyManager Validation', () => {
  let proxyManager: ProxyManager;

  beforeEach(() => {
    proxyManager = new ProxyManager();
  });

  afterEach(() => {
    proxyManager.dispose();
    vi.restoreAllMocks();
  });

  it('should validate working proxies and reject invalid ones', async () => {
    // Mock the testProxy method to avoid real network calls in unit tests
    const originalTestProxy = (proxyManager as any)['testProxy'];
    const mockTestProxy = vi.fn().mockImplementation(async (proxy) => {
      return {
        proxy,
        ok: proxy.label === 'Good Proxy',
        reason: proxy.label === 'Good Proxy' ? undefined : 'Connection failed',
        latency: 100,
        ipv4Ip: '1.2.3.4',
        ipv6Leak: false,
        ipv6Ip: ''
      };
    });
    (proxyManager as any)['testProxy'] = mockTestProxy;

    try {
      const testProxies: ProxyConfig[] = [
        { label: 'Good Proxy', server: 'http://httpbin.org', username: undefined, password: undefined },
        { label: 'Bad Proxy', server: 'http://10.255.255.1:8080', username: undefined, password: undefined } // Likely invalid
      ];

      const result = await proxyManager.setProxiesValidated(testProxies, 'round-robin');

      expect(result.count).toBe(1);
      expect(result.labels).toContain('Good Proxy');
      expect(result.rejected?.[0]?.label).toBe('Bad Proxy');
      expect(result.rejected?.[0]?.reason).toBe('Connection failed');

      // Verify the mock was called
      expect(mockTestProxy).toHaveBeenCalledTimes(2);
    } finally {
      // Restore original method
      (proxyManager as any)['testProxy'] = originalTestProxy;
    }
  });

  it('should filter unsupported proxy schemes', async () => {
    // Mock the testProxy method
    const originalTestProxy = (proxyManager as any)['testProxy'];
    const mockTestProxy = vi.fn().mockImplementation(async (proxy) => ({
      proxy, // Return the actual proxy that was passed in
      ok: true,
      reason: undefined,
      latency: 100,
      ipv4Ip: '1.2.3.4',
      ipv6Leak: false,
      ipv6Ip: ''
    }));
    (proxyManager as any)['testProxy'] = mockTestProxy;

    try {
      const testProxies: ProxyConfig[] = [
        { label: 'HTTP Proxy', server: 'http://test.proxy:8080', username: undefined, password: undefined },
        { label: 'HTTPS Proxy', server: 'https://test.proxy:8080', username: undefined, password: undefined },
        { label: 'SOCKS5 Proxy', server: 'socks5://test.proxy:1080', username: undefined, password: undefined },
        { label: 'SOCKS4 Proxy', server: 'socks4://test.proxy:1080', username: undefined, password: undefined }, // Unsupported
        { label: 'Invalid Proxy', server: 'invalid://test.proxy:8080', username: undefined, password: undefined } // Unsupported
      ];

      const result = await proxyManager.setProxiesValidated(testProxies, 'round-robin');

      // Should have 3 supported proxies (HTTP, HTTPS, SOCKS5)
      expect(result.count).toBe(3);
      expect(result.labels).toContain('HTTP Proxy');
      expect(result.labels).toContain('HTTPS Proxy');
      expect(result.labels).toContain('SOCKS5 Proxy');

      // Should have 2 rejected proxies (SOCKS4 and Invalid)
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected?.[0]?.label).toBe('SOCKS4 Proxy');
      expect(result.rejected?.[0]?.reason).toBe('Unsupported scheme (only http/https/socks5 supported)');
      expect(result.rejected?.[1]?.label).toBe('Invalid Proxy');
      expect(result.rejected?.[1]?.reason).toBe('Unsupported scheme (only http/https/socks5 supported)');

      // Verify the mock was called for supported proxies only
      expect(mockTestProxy).toHaveBeenCalledTimes(3);
    } finally {
      // Restore original method
      (proxyManager as any)['testProxy'] = originalTestProxy;
    }
  });

  it('should initialize health tracking for working proxies', async () => {
    // Mock the testProxy method
    const originalTestProxy = (proxyManager as any)['testProxy'];
    const mockTestProxy = vi.fn().mockImplementation(async (proxy) => {
      return {
        proxy,
        ok: true,
        reason: undefined,
        latency: 50 + Math.random() * 100, // Random latency between 50-150ms
        ipv4Ip: '1.2.3.4',
        ipv6Leak: false,
        ipv6Ip: ''
      };
    });
    (proxyManager as any)['testProxy'] = mockTestProxy;

    try {
      const testProxies: ProxyConfig[] = [
        { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined },
        { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: 'user', password: 'pass' }
      ];

      const result = await proxyManager.setProxiesValidated(testProxies, 'round-robin');

      // Check that health tracking was initialized
      expect(result.count).toBe(2);
      expect(result.health).toHaveLength(2);

      const health1 = result.health?.find(h => h.label === 'Proxy 1');
      const health2 = result.health?.find(h => h.label === 'Proxy 2');

      expect(health1).toBeDefined();
      expect(health2).toBeDefined();
      expect(health1?.isHealthy).toBe(true);
      expect(health2?.isHealthy).toBe(true);
      expect(health1?.latency).toBeGreaterThanOrEqual(0);
      expect(health2?.latency).toBeGreaterThanOrEqual(0);
      expect(health1?.consecutiveFailures).toBe(0);
      expect(health2?.consecutiveFailures).toBe(0);

      // Verify the mock was called
      expect(mockTestProxy).toHaveBeenCalledTimes(2);
    } finally {
      // Restore original method
      (proxyManager as any)['testProxy'] = originalTestProxy;
    }
  });

  it('should assign proxies using round-robin strategy', () => {
    // Manually set up proxies (bypass validation for testing)
    const proxy1: ProxyConfig = { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined };
    const proxy2: ProxyConfig = { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: undefined, password: undefined };

    // Set up internal state
    (proxyManager as any)['proxiesByTier'] = new Map([['unknown', [proxy1, proxy2]]]);
    (proxyManager as any)['tierCursors'] = new Map([['unknown', 0]]);
    (proxyManager as any)['strategy'] = 'round-robin';
    (proxyManager as any)['cursor'] = 0;
    (proxyManager as any)['stickyMap'] = new Map();

    // Initialize health tracking
    (proxyManager as any)['healthMap'] = new Map([
      ['Proxy 1', { proxy: proxy1, consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), latency: 50, isHealthy: true }],
      ['Proxy 2', { proxy: proxy2, consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), latency: 60, isHealthy: true }]
    ]);

    // Test round-robin assignment
    const assigned1 = proxyManager.assign('tab-1');
    const assigned2 = proxyManager.assign('tab-2');
    const assigned3 = proxyManager.assign('tab-3');
    const assigned4 = proxyManager.assign('tab-4');

    expect(assigned1?.label).toBe('Proxy 1');
    expect(assigned2?.label).toBe('Proxy 2');
    expect(assigned3?.label).toBe('Proxy 1'); // Should wrap around
    expect(assigned4?.label).toBe('Proxy 2');

    // Debug: Check what's actually in the stickyMap
    const stickyMapSize = (proxyManager as any)['stickyMap'].size;
    console.log('Sticky map size:', stickyMapSize);
    console.log('Sticky map entries:', Array.from((proxyManager as any)['stickyMap'].entries()));

    // For round-robin strategy, no sticky mappings should be created
    expect(stickyMapSize).toBe(0);
  });
});