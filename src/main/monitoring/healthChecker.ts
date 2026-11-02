// src/main/monitoring/healthChecker.ts
import { HealthCheckResult, HealthChecker, HealthCheckOptions } from './types';

export class HealthCheckerImpl implements HealthChecker {
  private checks: Map<string, () => Promise<boolean>> = new Map();

  registerCheck(name: string, checkFn: () => Promise<boolean>): void {
    this.checks.set(name, checkFn);
  }

  async checkHealth(options: HealthCheckOptions = {}): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const results: Record<string, boolean> = {};
    let overallStatus: HealthCheckResult['status'] = 'pass';

    // Run all registered health checks
    for (const [name, checkFn] of this.checks.entries()) {
      try {
        const result = await checkFn();
        results[name] = result;
        if (!result) {
          overallStatus = 'fail';
        }
      } catch (error) {
        console.error(`Health check ${name} failed:`, error);
        results[name] = false;
        overallStatus = 'fail';
      }
    }

    // Add default checks if none were registered
    if (this.checks.size === 0) {
      // Basic process health checks
      results['memory'] = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal < 0.9;
      results['uptime'] = process.uptime() > 10; // At least 10 seconds uptime

      if (!results['memory']) overallStatus = 'fail';
      if (!results['uptime']) overallStatus = 'warn';
    }

    const responseTime = Date.now() - startTime;

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      checks: results
    };
  }
}

// Export a singleton instance
export const healthChecker = new HealthCheckerImpl();