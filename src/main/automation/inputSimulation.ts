// src/main/automation/antidetection/inputSimulation.ts
import { poissonDelayMs } from './antidetection/delays';

export class InputSimulation {
  private poissonMeanMs: number;
  private delayMinMs: number;
  private delayMaxMs: number;

  constructor(config: { poissonMeanMs: number; delayMinMs: number; delayMaxMs: number }) {
    this.poissonMeanMs = config.poissonMeanMs;
    this.delayMinMs = config.delayMinMs;
    this.delayMaxMs = config.delayMaxMs;
  }

  generateDelay(): number {
    return poissonDelayMs(this.poissonMeanMs, this.delayMinMs, this.delayMaxMs);
  }
}