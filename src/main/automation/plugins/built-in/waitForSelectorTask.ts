// src/main/automation/plugins/built-in/waitForSelectorTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class WaitForSelectorTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('WaitForSelectorTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      waitForSelector: new WaitForSelectorTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('WaitForSelectorTaskPlugin disposed');
    return Promise.resolve();
  }
}

class WaitForSelectorTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'waitForSelector';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    const { selector, timeout = 10000 } = task.payload as { selector: string; timeout?: number };
    await page.locator(selector).waitFor({ timeout });
    return { found: selector };
  }
}