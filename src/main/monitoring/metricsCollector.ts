// src/main/monitoring/metricsCollector.ts
import {
  Counter, Gauge, Histogram, MetricsCollector,
  CounterOptions, GaugeOptions, HistogramOptions
} from './types';

export class MetricsCollectorImpl implements MetricsCollector {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  getCounter(options: CounterOptions): Counter {
    const key = this.getMetricKey(options.name, options.labelNames || []);
    if (!this.counters.has(key)) {
      const counter: Counter = {
        value: 0,
        help: options.help ?? '',
        inc(value = 1) {
          this.value += value;
        },
        add(value) {
          this.value += value;
        },
        reset() {
          this.value = 0;
        }
      };
      this.counters.set(key, counter);
    }
    return this.counters.get(key)!;
  }

  getGauge(options: GaugeOptions): Gauge {
    const key = this.getMetricKey(options.name, options.labelNames || []);
    if (!this.gauges.has(key)) {
      const gauge: Gauge = {
        value: 0,
        help: options.help ?? '',
        set(value) {
          this.value = value;
        },
        inc(value = 1) {
          this.value += value;
        },
        dec(value = 1) {
          this.value -= value;
        }
      };
      this.gauges.set(key, gauge);
    }
    return this.gauges.get(key)!;
  }

  getHistogram(options: HistogramOptions): Histogram {
    const key = this.getMetricKey(options.name, options.labelNames || []);
    if (!this.histograms.has(key)) {
      const buckets = options.buckets || [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
      const histogram: Histogram = {
        buckets,
        count: 0,
        sum: 0,
        bucketCounts: new Array(buckets.length).fill(0),
        help: options.help ?? '',
        observe(value) {
          this.count++;
          this.sum += value;
          // Find which bucket this value falls into
          for (let i = 0; i < this.buckets.length; i++) {
            if (value <= this.buckets[i]) {
              this.bucketCounts[i]++;
              break;
            }
          }
          // If value is greater than all buckets, it goes in the last bucket (Inf)
          if (value > this.buckets[this.buckets.length - 1]) {
            this.bucketCounts[this.bucketCounts.length - 1]++;
          }
        },
        startTimer() {
          const start = Date.now();
          return () => {
            const end = Date.now();
            this.observe(end - start);
          };
        }
      };
      this.histograms.set(key, histogram);
    }
    return this.histograms.get(key)!;
  }

  collect(): string {
    const metrics: string[] = [];

    // Collect counters
    for (const [key, counter] of this.counters.entries()) {
      metrics.push(`# HELP ${key} ${counter.help || ''}`);
      metrics.push(`# TYPE ${key} counter`);
      metrics.push(`${key} ${counter.value}`);
    }

    // Collect gauges
    for (const [key, gauge] of this.gauges.entries()) {
      metrics.push(`# HELP ${key} ${gauge.help || ''}`);
      metrics.push(`# TYPE ${key} gauge`);
      metrics.push(`${key} ${gauge.value}`);
    }

    // Collect histograms
    for (const [key, histogram] of this.histograms.entries()) {
      metrics.push(`# HELP ${key} ${histogram.help || ''}`);
      metrics.push(`# TYPE ${key} histogram`);

      // Add count
      metrics.push(`${key}_count ${histogram.count}`);
      // Add sum
      metrics.push(`${key}_sum ${histogram.sum}`);
      // Add buckets
      histogram.buckets.forEach((boundary, index) => {
        const le = boundary === Infinity ? '+Inf' : boundary.toString();
        metrics.push(`${key}_bucket{le="${le}"} ${histogram.bucketCounts[index]}`);
      });
      // Add +Inf bucket
      metrics.push(`${key}_bucket{le="+Inf"} ${histogram.count}`);
    }

    return metrics.join('\n');
  }

  private getMetricKey(name: string, labelNames: string[]): string {
    if (labelNames.length === 0) {
      return name;
    }
    return `${name}{${labelNames.map(name => `${name}=""`).join(',')}}`;
  }
}

// Helper classes for the metric implementations
class CounterImpl implements Counter {
  value: number = 0;
  help: string = '';

  inc(value = 1) {
    this.value += value;
  }

  add(value: number) {
    this.value += value;
  }

  reset() {
    this.value = 0;
  }
}

class GaugeImpl implements Gauge {
  value: number = 0;
  help: string = '';

  set(value: number) {
    this.value = value;
  }

  inc(value = 1) {
    this.value += value;
  }

  dec(value = 1) {
    this.value -= value;
  }
}

class HistogramImpl implements Histogram {
  buckets: number[] = [];
  count: number = 0;
  sum: number = 0;
  bucketCounts: number[] = [];
  help: string = '';

  observe(value: number) {
    this.count++;
    this.sum += value;
    // Find which bucket this value falls into
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this.bucketCounts[i]++;
        break;
      }
    }
    // If value is greater than all buckets, it goes in the last bucket (Inf)
    if (value > this.buckets[this.buckets.length - 1]) {
      this.bucketCounts[this.bucketCounts.length - 1]++;
    }
  }

  startTimer() {
    const start = Date.now();
    return () => {
      const end = Date.now();
      this.observe(end - start);
    };
  }
}

// Export a singleton instance
export const metricsCollector = new MetricsCollectorImpl();