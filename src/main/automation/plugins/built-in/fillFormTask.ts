// src/main/automation/plugins/built-in/fillFormTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class FillFormTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('FillFormTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      fillForm: new FillFormTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('FillFormTaskPlugin disposed');
    return Promise.resolve();
  }
}

class FillFormTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'fillForm';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    const { fields } = task.payload as { fields: Array<{ selector: string; value: string }> };
    for (const f of fields) {
      await page.locator(f.selector).fill(f.value);
      // Human-like typing delay between fields
      await this.randomDelay(50, 150);
    }
    return { filled: fields.length };
  }

  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}