// src/main/automation/plugins/built-in/checkIpLeakTask.ts
import { IPlugin, ITaskHandler } from '../basePlugin';

export class CheckIpLeakTaskPlugin implements IPlugin {
  initialize(): Promise<void> {
    console.log('CheckIpLeakTaskPlugin initialized');
    return Promise.resolve();
  }

  getHandlers(): Record<string, ITaskHandler> {
    return {
      checkIpLeak: new CheckIpLeakTaskHandler()
    };
  }

  dispose(): Promise<void> {
    console.log('CheckIpLeakTaskPlugin disposed');
    return Promise.resolve();
  }
}

class CheckIpLeakTaskHandler implements ITaskHandler {
  canHandle(taskType: string): boolean {
    return taskType === 'checkIpLeak';
  }

  async execute(tab: any, task: any): Promise<any> {
    const page = tab.page;
    const ip = await page.evaluate(async () => {
      const res = await fetch('https://api.ipify.org?format=json');
      const json = (await res.json()) as { ip: string };
      return json.ip;
    });
    return { observedIp: ip, proxyLabel: tab.state.proxyLabel ?? null };
  }
}