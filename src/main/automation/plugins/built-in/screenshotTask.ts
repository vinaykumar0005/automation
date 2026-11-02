// src/main/automation/plugins/built-in/screenshotTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class ScreenshotTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('ScreenshotTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      screenshot: new ScreenshotTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('ScreenshotTaskPlugin disposed');
    return Promise.resolve();
  }
}

class ScreenshotTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'screenshot';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    // Small delay before screenshot
    await this.randomDelay(200, 500);
    const buffer = await page.screenshot({ type: 'png' });
    return buffer.toString('base64');
  }

  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}