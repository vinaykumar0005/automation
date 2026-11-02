// src/main/automation/plugins/built-in/extractTextTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class ExtractTextTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('ExtractTextTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      extractText: new ExtractTextTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('ExtractTextTaskPlugin disposed');
    return Promise.resolve();
  }
}

class ExtractTextTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'extractText';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    const { selector } = task.payload as { selector: string };
    return page.locator(selector).allTextContents();
  }
}