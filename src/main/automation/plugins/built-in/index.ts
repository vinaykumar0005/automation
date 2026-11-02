import { WatchDurationTaskPlugin } from './watchDurationTask';
import { NavigateTaskPlugin } from './navigateTask';
import { WaitForSelectorTaskPlugin } from './waitForSelectorTask';
import { LoopVideoTaskPlugin } from './loopVideoTask';
import { FillFormTaskPlugin } from './fillFormTask';
import { ExtractTextTaskPlugin } from './extractTextTask';
import { ClickTaskPlugin } from './clickTask';
import { CheckIpLeakTaskPlugin } from './checkIpLeakTask';
import { ScreenshotTaskPlugin } from './screenshotTask';
import { IPlugin, ITaskHandler } from '../basePlugin';

class BuiltInPluginBundle implements IPlugin {
  private readonly plugins: IPlugin[] = [
    new NavigateTaskPlugin(),
    new WaitForSelectorTaskPlugin(),
    new LoopVideoTaskPlugin(),
    new FillFormTaskPlugin(),
    new ExtractTextTaskPlugin(),
    new ClickTaskPlugin(),
    new CheckIpLeakTaskPlugin(),
    new WatchDurationTaskPlugin(),
    new ScreenshotTaskPlugin(),
  ];

  async initialize(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.initialize();
    }
  }

  getHandlers(): Record<string, ITaskHandler> {
    return this.plugins.reduce<Record<string, ITaskHandler>>((handlers, plugin) => {
      return { ...handlers, ...plugin.getHandlers() };
    }, {});
  }

  async dispose(): Promise<void> {
    await Promise.all(this.plugins.map((plugin) => plugin.dispose()));
  }
}

export default BuiltInPluginBundle;