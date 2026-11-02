import { ProxyManager } from '../../../src/main/automation/ProxyManager';
import type { ProxyConfig } from '../../../shared/types';
import { vi } from 'vitest';

describe('ProxyManager Assignment', () => {
  let proxyManager: ProxyManager;

  beforeEach(() => {
    proxyManager = new ProxyManager();
  });

  afterEach(() => {
    proxyManager.dispose();
    vi.restoreAllMocks();
  });

  it('should assign proxies using round-robin strategy', () => {
    // Set up proxies manually (bypass validation)
    const proxy1: ProxyConfig = { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined };
    const proxy2: ProxyConfig = { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: undefined, password: undefined };

    // Manually set up internal state for round-robin
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

    // For round-robin strategy, no sticky mappings should be created
    expect((proxyManager as any)['stickyMap'].size).toBe(0);
  });

  it('should assign proxies using sticky-per-tab strategy', () => {
    // Set up proxies manually (bypass validation)
    const proxy1: ProxyConfig = { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined };
    const proxy2: ProxyConfig = { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: undefined, password: undefined };

    // Manually set up internal state for sticky-per-tab
    (proxyManager as any)['proxiesByTier'] = new Map([['unknown', [proxy1, proxy2]]]);
    (proxyManager as any)['tierCursors'] = new Map([['unknown', 0]]);
    (proxyManager as any)['strategy'] = 'sticky-per-tab';
    (proxyManager as any)['cursor'] = 0;
    (proxyManager as any)['stickyMap'] = new Map();

    // Initialize health tracking
    (proxyManager as any)['healthMap'] = new Map([
      ['Proxy 1', { proxy: proxy1, consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), latency: 50, isHealthy: true }],
      ['Proxy 2', { proxy: proxy2, consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), latency: 60, isHealthy: true }]
    ]);

    // Test sticky-per-tab assignment
    const assigned1 = proxyManager.assign('tab-1');
    const assigned2 = proxyManager.assign('tab-2');
    const assigned3 = proxyManager.assign('tab-1'); // Same tab should get same proxy
    const assigned4 = proxyManager.assign('tab-2'); // Same tab should get same proxy

    expect(assigned1?.label).toBe('Proxy 1');
    expect(assigned2?.label).toBe('Proxy 2');
    expect(assigned3?.label).toBe('Proxy 1'); // Should be same as first assignment
    expect(assigned4?.label).toBe('Proxy 2'); // Should be same as second assignment

    // For sticky-per-tab strategy, stickyMap should have 2 entries (one per unique tab)
    expect((proxyManager as any)['stickyMap'].size).toBe(2);
  });

  it('should handle unhealthy proxies in sticky-per-tab strategy', () => {
    // Set up proxies manually (bypass validation)
    const proxy1: ProxyConfig = { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined };
    const proxy2: ProxyConfig = { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: undefined, password: undefined };

    // Manually set up internal state for sticky-per-tab
    (proxyManager as any)['proxiesByTier'] = new Map([['unknown', [proxy1, proxy2]]]);
    (proxyManager as any)['tierCursors'] = new Map([['unknown', 0]]);
    (proxyManager as any)['strategy'] = 'sticky-per-tab';
    (proxyManager as any)['cursor'] = 0;
    (proxyManager as any)['stickyMap'] = new Map();

    // Initialize health tracking - proxy1 is unhealthy
    (proxyManager as any)['healthMap'] = new Map([
      ['Proxy 1', { proxy: proxy1, consecutiveFailures: 3, lastSuccess: Date.now() - 10000, lastCheck: Date.now(), latency: 50, isHealthy: false }], // Unhealthy
      ['Proxy 2', { proxy: proxy2, consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), latency: 60, isHealthy: true }]
    ]);

    // First assignment should skip unhealthy proxy1 and give proxy2
    const assigned1 = proxyManager.assign('tab-1');
    expect(assigned1?.label).toBe('Proxy 2');

    // Second assignment for same tab should still give proxy2 (now it's the sticky assignment)
    const assigned2 = proxyManager.assign('tab-1');
    expect(assigned2?.label).toBe('Proxy 2');

    // Assignment for different tab should also give proxy2 (first healthy in rotation)
    const assigned3 = proxyManager.assign('tab-2');
    expect(assigned3?.label).toBe('Proxy 2');

    // Now make proxy1 healthy again
    const health1 = (proxyManager as any)['healthMap'].get('Proxy 1');
    if (health1) {
      health1.consecutiveFailures = 0;
      health1.isHealthy = true;
    }

    // New tab should get proxy1 (next in rotation)
    const assigned4 = proxyManager.assign('tab-3');
    expect(assigned4?.label).toBe('Proxy 1');
  });

  it('should return undefined when no healthy proxies are available', () => {
    // Set up proxies manually (bypass validation)
    const proxy1: ProxyConfig = { label: 'Proxy 1', server: 'http://proxy1.test:8080', username: undefined, password: undefined };
    const proxy2: ProxyConfig = { label: 'Proxy 2', server: 'http://proxy2.test:8080', username: undefined, password: undefined };

    // Manually set up internal state
    (proxyManager as any)['proxiesByTier'] = new Map([['unknown', [proxy1, proxy2]]]);
    (proxyManager as any)['tierCursors'] = new Map([['unknown', 0]]);
    (proxyManager as any)['strategy'] = 'round-robin';
    (proxyManager as any)['cursor'] = 0;
    (proxyManager as any)['stickyMap'] = new Map();

    // Initialize health tracking - both proxies unhealthy
    (proxyManager as any)['healthMap'] = new Map([
      ['Proxy 1', { proxy: proxy1, consecutiveFailures: 3, lastSuccess: Date.now() - 10000, lastCheck: Date.now(), latency: 50, isHealthy: false }],
      ['Proxy 2', { proxy: proxy2, consecutiveFailures: 3, lastSuccess: Date.now() - 10000, lastCheck: Date.now(), latency: 60, isHealthy: false }]
    ]);

    // Should return undefined when no healthy proxies
    const assigned = proxyManager.assign('tab-1');
    expect(assigned).toBeUndefined();
  });
});