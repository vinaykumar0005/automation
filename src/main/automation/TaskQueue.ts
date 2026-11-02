// src/main/automation/TaskQueue.ts
// Per-tab FIFO queue so concurrent UI commands to the same tab don't race.
import { InputSimulation } from './inputSimulation';

export class TaskQueue {
  private simulation: InputSimulation;
  private queues = new Map<string, Promise<unknown>>();

  constructor(simulation: InputSimulation) {
    this.simulation = simulation;
  }

  // Modified enqueue to include random delays
  enqueue<T>(tabId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(tabId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const delayMs = this.simulation.generateDelay();
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return fn();
    });
    this.queues.set(tabId, next);
    return next as Promise<T>;
  }

  clear(tabId: string) {
    this.queues.delete(tabId);
  }
}