// src/main/automation/plugins/built-in/clickTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class ClickTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('ClickTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      click: new ClickTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('ClickTaskPlugin disposed');
    return Promise.resolve();
  }
}

class ClickTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'click';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    const { selector } = task.payload as { selector: string };
    // Random delay before click
    await this.randomDelay(100, 300);
    await page.locator(selector).click();
    // Random delay after click
    await this.randomDelay(200, 600);
    return { clicked: selector };
  }

  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}