// src/main/monitoring/types.ts
export interface Counter {
  value: number;
  help: string;
  inc(value?: number): void;
  add(value: number): void;
  reset(): void;
}

export interface Gauge {
  value: number;
  help: string;
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
}

export interface Histogram {
  buckets: number[];
  count: number;
  sum: number;
  bucketCounts: number[];
  help: string;
  observe(value: number): void;
  startTimer(): () => void;
}

export interface CounterOptions {
  name: string;
  help?: string;
  labelNames?: string[];
}

export interface GaugeOptions {
  name: string;
  help?: string;
  labelNames?: string[];
}

export interface HistogramOptions {
  name: string;
  help?: string;
  labelNames?: string[];
  buckets?: number[];
}

export interface MetricsCollector {
  getCounter(options: CounterOptions): Counter;
  getGauge(options: GaugeOptions): Gauge;
  getHistogram(options: HistogramOptions): Histogram;
  collect(): string;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface TraceSpan extends TraceContext {
  operationName: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, unknown>;
  logs: Array<{
    timestamp: number;
    fields: Record<string, unknown>;
  }>;
}

export interface TraceOptions {
  serviceName: string;
  sampleRate?: number;
}

export interface TraceManager {
  startSpan(operationName: string, parentContext?: TraceContext): TraceSpan;
  endSpan(span: TraceSpan): void;
  inject(context: TraceContext, carrier: any): void;
  extract(carrier: any): TraceContext | null;
}

export interface HealthCheckOptions {
  timeout?: number;
}

export interface HealthCheckResult {
  status: 'pass' | 'warn' | 'fail';
  timestamp: string;
  responseTimeMs: number;
  checks: Record<string, boolean>;
}

export interface HealthChecker {
  registerCheck(name: string, checkFn: () => Promise<boolean>): void;
  checkHealth(options?: HealthCheckOptions): Promise<HealthCheckResult>;
}