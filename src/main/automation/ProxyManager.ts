// src/main/automation/ProxyManager.ts
import { request } from 'playwright';
import type { ProxyConfig, ProxyRotationStrategy, ProxyStatus, ProxyTier } from './types';
import { EventEmitter } from 'node:events';

const SUPPORTED_SCHEMES = ['http:', 'https:', 'socks5:'];
const VALIDATION_TIMEOUT_MS = 15_000; // Increased from 8s to 15s for slow proxies
const VALIDATION_CONCURRENCY = 3; // Reduced concurrency to avoid overwhelming proxies
const HEALTH_CHECK_INTERVAL_MS = 60_000; // Check every minute
const MAX_FAILURES_BEFORE_REMOVAL = 3;

interface ValidationResult {
  proxy: ProxyConfig;
  ok: boolean;
  reason?: string;
  latency: number;
  ipv4Ip?: string;
  ipv6Leak?: boolean;
  ipv6Ip?: string;
}

interface ProxyHealth {
  proxy: ProxyConfig;
  consecutiveFailures: number;
  lastSuccess: number | null;
  lastCheck: number;
  latency: number;
  isHealthy: boolean;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class ProxyManager extends EventEmitter {
  private proxiesByTier: Map<ProxyTier, ProxyConfig[]> = new Map();
  private healthMap = new Map<string, ProxyHealth>();
  private strategy: ProxyRotationStrategy = 'round-robin';
  private tierCursor = 0;
  private tierCursors: Map<ProxyTier, number> = new Map(); // Per-tier cursor for round-robin
  private cursor = 0; // Legacy cursor for non-tier strategies
  private stickyMap = new Map<string, ProxyConfig>();
  private lastRejected: Array<{ label: string; reason: string }> = [];
  // Antidetection: when true, the healthy pool is reordered to prefer
  // residential/mobile over datacenter. Untagged ('unknown') proxies keep
  // their existing relative order, so an all-unknown pool assigns identically
  // to the pre-antidetection behavior. Lazily set by the controller; defaults
  // to false so ProxyManager standalone stays behaviorally identical.
  private preferResidentialTier = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isRunningHealthChecks = false;
  private tierOrder: ProxyTier[] = ['residential', 'mobile', 'isp', 'datacenter', 'unknown']; // Priority order

  /** Validates each proxy with a real connection test (through Playwright's
   *  lightweight APIRequestContext, not a full browser) and only keeps the
   *  ones that actually work. Unsupported schemes (e.g. socks4) are rejected
   *  immediately without wasting a network round-trip. */
  async setProxiesValidated(
    proxies: ProxyConfig[],
    strategy: ProxyRotationStrategy
  ): Promise<ProxyStatus> {
    const { supported, unsupported } = this.filterSupportedSchemes(proxies);

    const results = await mapWithConcurrency(supported, VALIDATION_CONCURRENCY, (proxy) =>
      this.testProxy(proxy)
    );

    const working = results.filter((r) => r.ok).map((r) => r.proxy);
    const failed = [
      ...unsupported.map((p) => ({ label: p.label, reason: 'Unsupported scheme (only http/https/socks5 supported)' })),
      ...results.filter((r) => !r.ok).map((r) => ({ label: r.proxy.label, reason: r.reason ?? 'Connection failed' })),
    ];

    // Group working proxies by tier
    this.proxiesByTier.clear();
    this.tierCursors.clear();
    for (const proxy of working) {
      const tier = proxy.tier ?? 'unknown';
      if (!this.proxiesByTier.has(tier)) {
        this.proxiesByTier.set(tier, []);
        this.tierCursors.set(tier, 0);
      }
      this.proxiesByTier.get(tier)!.push(proxy);
    }

    this.strategy = strategy;
    this.cursor = 0;
    this.tierCursor = 0;
    this.stickyMap.clear();
    this.lastRejected = failed;

    // Initialize health tracking for working proxies
    for (const proxy of working) {
      this.healthMap.set(proxy.label, {
        proxy,
        consecutiveFailures: 0,
        lastSuccess: Date.now(),
        lastCheck: Date.now(),
        latency: 0,
        isHealthy: true,
      });
    }

    // Start periodic health checks
    this.startHealthChecks();

    return this.getStatus();
  }

  /** Non-validating setter, kept for programmatic/advanced use where the
   *  caller has already confirmed proxies work. */
  setProxies(proxies: ProxyConfig[], strategy: ProxyRotationStrategy) {
    const { supported } = this.filterSupportedSchemes(proxies);
    // Group supported proxies by tier
    this.proxiesByTier.clear();
    this.tierCursors.clear();
    for (const proxy of supported) {
      const tier = proxy.tier ?? 'unknown';
      if (!this.proxiesByTier.has(tier)) {
        this.proxiesByTier.set(tier, []);
        this.tierCursors.set(tier, 0);
      }
      this.proxiesByTier.get(tier)!.push(proxy);
    }

    this.strategy = strategy;
    this.cursor = 0;
    this.tierCursor = 0;
    this.stickyMap.clear();

    // Initialize health tracking
    for (const proxy of supported) {
      this.healthMap.set(proxy.label, {
        proxy,
        consecutiveFailures: 0,
        lastSuccess: Date.now(),
        lastCheck: Date.now(),
        latency: 0,
        isHealthy: true,
      });
    }

    this.startHealthChecks();
  }

  /** Antidetection hook (additive). When pref.preferResidential is true,
   *  assign() reorders the healthy pool to prefer residential/mobile exits.
   *  Never calling this leaves assignment identical to today. */
  setTierPreference(pref: { preferResidential: boolean }): void {
    this.preferResidentialTier = !!pref.preferResidential;
  }

  private filterSupportedSchemes(proxies: ProxyConfig[]) {
    const supported: ProxyConfig[] = [];
    const unsupported: ProxyConfig[] = [];
    for (const p of proxies) {
      try {
        const scheme = new URL(p.server).protocol;
        if (SUPPORTED_SCHEMES.includes(scheme)) {
          supported.push(p);
        } else {
          unsupported.push(p);
        }
      } catch {
        unsupported.push(p);
      }
    }
    return { supported, unsupported };
  }

  private async testProxy(proxy: ProxyConfig): Promise<ValidationResult> {
    const startTime = Date.now();
    let ctx;
    try {
      ctx = await request.newContext({
        proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
        timeout: VALIDATION_TIMEOUT_MS,
      });

      // Test 1: Check IPv4 IP through proxy
      const ipv4Res = await ctx.get('https://api.ipify.org?format=json', {
        timeout: VALIDATION_TIMEOUT_MS,
      });
      const ipv4Ok = ipv4Res.ok();
      let ipv4Ip = '';
      if (ipv4Ok) {
        const ipv4Data = await ipv4Res.json();
        ipv4Ip = ipv4Data.ip || '';
      }

      // Test 2: Check for IPv6 leak (critical for anti-detection)
      // If the proxy is IPv4-only, it should NOT return an IPv6 address
      // We test by checking a service that returns both IPv4 and IPv6
      let ipv6Leak = false;
      let ipv6Ip = '';
      try {
        // Use a service that returns the client's IP (works for both IPv4 and IPv6)
        const ipv6Res = await ctx.get('https://api64.ipify.org?format=json', {
          timeout: VALIDATION_TIMEOUT_MS / 2,
        });
        if (ipv6Res.ok()) {
          const ipv6Data = await ipv6Res.json();
          ipv6Ip = ipv6Data.ip || '';
          // Check if it's an IPv6 address (contains colons)
          if (ipv6Ip.includes(':')) {
            ipv6Leak = true;
          }
        }
      } catch {
        // IPv6 test failed - might be expected for IPv4-only proxies
        // This is actually GOOD if we want to prevent IPv6 leaks
      }

      const latency = Date.now() - startTime;

      const ok = ipv4Ok; // Proxy is OK if basic IPv4 connectivity works
      // NOTE: Disabled aggressive IPv6 leak detection that was marking good IPv6-capable proxies as failed
      // const reason = !ipv4Ok ? (ipv4Res.status() ? `HTTP ${ipv4Res.status()}` : 'Connection failed') :
      //                ipv6Leak ? `IPv6 leak detected: ${ipv6Ip}` : undefined;
      const reason = !ipv4Ok ? (ipv4Res.status() ? `HTTP ${ipv4Res.status()}` : 'Connection failed') : undefined;

      // Update health info
      const health = this.healthMap.get(proxy.label);
      if (health) {
        health.latency = latency;
        health.lastCheck = Date.now();
        // Store additional info
        (health as any).ipv4Ip = ipv4Ip;
        (health as any).ipv6Leak = ipv6Leak;
        if (ok) {
          health.consecutiveFailures = 0;
          health.lastSuccess = Date.now();
          health.isHealthy = true;
        } else {
          health.consecutiveFailures++;
          health.isHealthy = health.consecutiveFailures < MAX_FAILURES_BEFORE_REMOVAL;
        }
      }

      return { proxy, ok, reason, latency, ipv4Ip, ipv6Leak, ipv6Ip };
    } catch (err: any) {
      const latency = Date.now() - startTime;

      // Update health info
      const health = this.healthMap.get(proxy.label);
      if (health) {
        health.latency = latency;
        health.lastCheck = Date.now();
        health.consecutiveFailures++;
        health.isHealthy = health.consecutiveFailures < MAX_FAILURES_BEFORE_REMOVAL;
      }

      return { proxy, ok: false, reason: err?.message?.split('\n')[0] ?? 'Unreachable', latency };
    } finally {
      await ctx?.dispose().catch(() => {});
    }
  }

  /** Start periodic health checks for all proxies */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      if (this.isRunningHealthChecks) return;

      // Get all proxies from tiered storage
      const allProxies: ProxyConfig[] = [];
      this.proxiesByTier.forEach(proxies => {
        allProxies.push(...proxies);
      });

      if (allProxies.length === 0) return;
      this.isRunningHealthChecks = true;

      try {
        for (const proxy of allProxies) {
          const health = this.healthMap.get(proxy.label);
          if (!health) continue;

          // Test the proxy
          await this.testProxy(proxy);

          // If proxy became unhealthy, emit event and potentially remove it
          const updatedHealth = this.healthMap.get(proxy.label);
          if (updatedHealth && !updatedHealth.isHealthy && updatedHealth.consecutiveFailures >= MAX_FAILURES_BEFORE_REMOVAL) {
            this.emit('proxy-unhealthy', { proxy: proxy.label, reason: 'Max consecutive failures reached' });

            // Remove from active proxies (remove from tiered storage)
            this.proxiesByTier.forEach((proxies, tier) => {
              const index = proxies.findIndex(p => p.label === proxy.label);
              if (index !== -1) {
                proxies.splice(index, 1);
                // Clean up empty tiers
                if (proxies.length === 0) {
                  this.proxiesByTier.delete(tier);
                  this.tierCursors.delete(tier);
                }
              }
            });
            this.healthMap.delete(proxy.label);

            // If this proxy was sticky-assigned to tabs, those tabs need new proxies
            for (const [tabId, assignedProxy] of this.stickyMap.entries()) {
              if (assignedProxy.label === proxy.label) {
                this.stickyMap.delete(tabId);
                this.emit('proxy-reassigned', { tabId, oldProxy: proxy.label });
              }
            }
          }
        }
      } finally {
        this.isRunningHealthChecks = false;
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Don't prevent process exit
    this.healthCheckTimer.unref?.();
  }

  /** Stop health checks */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  getStatus(): ProxyStatus {
    // Flatten all proxies by tier for backward compatibility
    const allProxies: ProxyConfig[] = [];
    this.proxiesByTier.forEach(proxies => {
      allProxies.push(...proxies);
    });

    const healthDetails = allProxies.map(p => {
      const h = this.healthMap.get(p.label);
      return {
        label: p.label,
        tier: p.tier ?? 'unknown',
        isHealthy: h?.isHealthy ?? true,
        latency: h?.latency ?? 0,
        consecutiveFailures: h?.consecutiveFailures ?? 0,
        lastSuccess: h?.lastSuccess,
        lastCheck: h?.lastCheck,
        ipv4Ip: (h as any)?.ipv4Ip, // Store the last known IPv4 IP
        ipv6Leak: (h as any)?.ipv6Leak, // Track if IPv6 leak was detected
      };
    });

    return {
      count: allProxies.length,
      strategy: this.strategy,
      labels: allProxies.map((p) => p.label),
      rejected: this.lastRejected,
      health: healthDetails,
    };
  }

  /** Get healthy proxies only */
  getHealthyProxies(): ProxyConfig[] {
    const healthy: ProxyConfig[] = [];
    this.proxiesByTier.forEach(proxies => {
      for (const proxy of proxies) {
        const h = this.healthMap.get(proxy.label);
        if (h?.isHealthy !== false) {
          healthy.push(proxy);
        }
      }
    });
    return healthy;
  }

  /** Lower rank = preferred. 'unknown' ranks last so an all-unknown pool keeps
   *  stable relative order (sorted-last is a no-op for selection ordering). */
  private static tierRank(tier: import('./types').ProxyTier | undefined): number {
    switch (tier) {
      case 'residential': return 0;
      case 'mobile': return 1;
      case 'isp': return 2;
      case 'datacenter': return 3;
      case 'unknown':
      default: return 4;
    }
  }

  /** Reorder the healthy pool to prefer residential/mobile when the
   *  tier-preference flag is set; otherwise return the list unchanged. */
  private orderByTier(healthy: ProxyConfig[]): ProxyConfig[] {
    if (!this.preferResidentialTier) return healthy;
    // Stable sort preserves the cursor's round-robin fairness within a tier.
    return [...healthy].sort(
      (a, b) => ProxyManager.tierRank(a.tier) - ProxyManager.tierRank(b.tier)
    );
  }

  /** Assign a proxy to a tab with automatic failover to healthy proxies */
  assign(tabId: string): ProxyConfig | undefined {
    // For tier-round-robin strategy, implement tier-based rotation
    if (this.strategy === 'tier-round-robin') {
      return this.assignTierRoundRobin(tabId);
    }

    // For other strategies, use existing logic with tier-aware ordering when antidetection is enabled
    const baseHealthy = this.getHealthyProxies();
    if (baseHealthy.length === 0) return undefined;
    const healthyProxies = this.orderByTier(baseHealthy);

    switch (this.strategy) {
      case 'random':
        return healthyProxies[Math.floor(Math.random() * healthyProxies.length)];

      case 'sticky-per-tab': {
        const existing = this.stickyMap.get(tabId);
        // Check if existing sticky proxy is still healthy
        if (existing) {
          const health = this.healthMap.get(existing.label);
          if (health && health.isHealthy) {
            return existing;
          }
          // Existing proxy is unhealthy, fall through to assign new one
        }
        const assigned = healthyProxies[this.cursor % healthyProxies.length];
        this.cursor += 1;
        this.stickyMap.set(tabId, assigned);
        return assigned;
      }

      case 'round-robin':
      default: {
        const assigned = healthyProxies[this.cursor % healthyProxies.length];
        this.cursor += 1;
        return assigned;
      }
    }
  }

  /** Manually mark a proxy as failed for a specific tab */
  markProxyFailed(tabId: string, reason: string): void {
    const stickyProxy = this.stickyMap.get(tabId);
    if (stickyProxy) {
      const health = this.healthMap.get(stickyProxy.label);
      if (health) {
        health.consecutiveFailures++;
        health.isHealthy = health.consecutiveFailures < MAX_FAILURES_BEFORE_REMOVAL;

        if (!health.isHealthy) {
          // Force reassign on next request
          this.stickyMap.delete(tabId);
          this.emit('proxy-failed', { tabId, proxy: stickyProxy.label, reason });
        }
      }
    }
  }

  release(tabId: string) {
    this.stickyMap.delete(tabId);
  }

  /** Assign proxy using tier-based round-robin rotation */
  private assignTierRoundRobin(tabId: string): ProxyConfig | undefined {
    // Check if we already have a sticky assignment for this tab (for failover)
    const existing = this.stickyMap.get(tabId);
    if (existing) {
      const health = this.healthMap.get(existing.label);
      if (health && health.isHealthy) {
        return existing; // Return existing healthy proxy
      }
      // Existing proxy is unhealthy, remove sticky mapping
      this.stickyMap.delete(tabId);
    }

    // Find the next tier that has healthy proxies, starting from tierCursor
    const assignedProxy = this.findAndAssignHealthyProxyInTierOrder(tabId);
    return assignedProxy;
  }

  /** Find a healthy proxy in tier order and assign it using round-robin within the tier */
  private findAndAssignHealthyProxyInTierOrder(tabId: string): ProxyConfig | undefined {
    // Check each tier in order, starting from tierCursor
    for (let i = 0; i < this.tierOrder.length; i++) {
      const tierIndex = (this.tierCursor + i) % this.tierOrder.length;
      const tier = this.tierOrder[tierIndex];

      const proxiesInTier = this.proxiesByTier.get(tier) || [];
      if (proxiesInTier.length === 0) {
        continue; // Skip empty tiers
      }

      // Get or initialize cursor for this tier
      let tierCursor = this.tierCursors.get(tier) ?? 0;

      // Look for a healthy proxy starting from tierCursor
      let checked = 0;
      while (checked < proxiesInTier.length) {
        const proxy = proxiesInTier[tierCursor];
        const health = this.healthMap.get(proxy.label);

        if (health && health.isHealthy) {
          // Found a healthy proxy, assign it
          this.stickyMap.set(tabId, proxy);

          // Advance the tier's cursor for next round-robin selection
          tierCursor++;
          if (tierCursor >= proxiesInTier.length) {
            tierCursor = 0; // Wrap around
          }
          this.tierCursors.set(tier, tierCursor);

          // Advance to next tier for the next assignment (rotate tiers)
          this.tierCursor = (tierIndex + 1) % this.tierOrder.length;

          return proxy;
        }

        // Move to next proxy in this tier
        tierCursor++;
        if (tierCursor >= proxiesInTier.length) {
          tierCursor = 0; // Wrap around
        }
        checked++;
      }

      // No healthy proxies found in this tier, continue to next tier
      this.tierCursors.set(tier, tierCursor); // Save cursor position
    }

    // No healthy proxies found in any tier
    return undefined;
  }

  /** Get proxy health details for monitoring */
  getHealthDetails(): Array<{ label: string; tier: ProxyTier | undefined; healthy: boolean; latency: number; failures: number }> {
    return Array.from(this.healthMap.entries()).map(([label, health]) => {
      // Find the proxy config to get its tier
      let tier: ProxyTier | undefined = undefined;
      this.proxiesByTier.forEach((proxies, t) => {
        if (proxies.some(p => p.label === label)) {
          tier = t as ProxyTier;
        }
      });
      return {
        label,
        tier,
        healthy: health.isHealthy,
        latency: health.latency,
        failures: health.consecutiveFailures,
      };
    });
  }

  /** Dispose and cleanup */
  dispose(): void {
    this.stopHealthChecks();
    this.removeAllListeners();
  }
}