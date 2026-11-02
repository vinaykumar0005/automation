// src/main/automation/plugins/pluginManager.ts
import { IPlugin, ITaskHandler } from './basePlugin';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import logger from '../../logging/logger';
// Direct import of built-in plugins to avoid filesystem discovery issues after bundling
import BuiltInPluginBundle from './built-in';

export class PluginManager {
  private plugins: IPlugin[] = [];
  private taskHandlers: Map<string, ITaskHandler> = new Map();

  async initialize(): Promise<void> {
    // Always register built-in plugins first (they're bundled with the app)
    await this.registerBuiltInPlugins();

    // Optionally load custom plugins from filesystem (for development/extensibility)
    await this.loadCustomPluginsFromDirectory();

    logger.info(`PluginManager initialized with ${this.plugins.length} plugins`);
  }

  private async registerBuiltInPlugins(): Promise<void> {
    try {
      const builtInBundle = new BuiltInPluginBundle();
      await builtInBundle.initialize();

      const handlers = builtInBundle.getHandlers();
      for (const [type, handler] of Object.entries(handlers)) {
        if (this.taskHandlers.has(type)) {
          logger.warn(`Built-in task handler for type '${type}' already registered, overwriting`);
        }
        this.taskHandlers.set(type, handler);
      }

      this.plugins.push(builtInBundle);
      logger.info(`Registered ${Object.keys(handlers).length} built-in task handlers: ${Object.keys(handlers).join(', ')}`);
    } catch (error) {
      logger.error('Failed to register built-in plugins', error);
      throw error; // Built-in plugins are critical, fail if they can't load
    }
  }

  private async loadCustomPluginsFromDirectory(): Promise<void> {
    try {
      const pluginsDir = path.join(__dirname, './');

      const entries = await readdir(pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip the built-in directory since we already loaded those directly
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'built-in') {
          await this.loadPluginFromDirectory(path.join(pluginsDir, entry.name));
        }
      }
    } catch (error) {
      logger.error('Failed to load custom plugins from directory', error);
    }
  }

  private async loadPluginFromDirectory(pluginDir: string): Promise<void> {
    try {
      // Look for main plugin file in source or built output.
      const pluginFiles = ['index.js', 'plugin.js', 'index.ts', 'plugin.ts'];
      let pluginPath: string | null = null;

      for (const file of pluginFiles) {
        const fullPath = path.join(pluginDir, file);
        try {
          await stat(fullPath);
          pluginPath = fullPath;
          break;
        } catch {
          // File doesn't exist, try next
        }
      }

      if (!pluginPath) {
        logger.warn(`No plugin entry point found in ${pluginDir}`);
        return;
      }

      // Dynamically import the plugin module
      const pluginModule = await import(pluginPath);

      // Assume default export is the plugin class or factory function
      const PluginClass = pluginModule.default || pluginModule.Plugin || pluginModule;

      // Create instance
      let plugin: IPlugin;
      if (typeof PluginClass === 'function') {
        if (PluginClass.prototype.initialize) {
          // It's a class
          plugin = new PluginClass();
        } else {
          // It's a factory function
          plugin = PluginClass();
        }
      } else {
        logger.warn(`Invalid plugin export in ${pluginPath}`);
        return;
      }

      // Initialize plugin
      await plugin.initialize();

      // Register handlers
      const handlers = plugin.getHandlers();
      for (const [type, handler] of Object.entries(handlers)) {
        if (this.taskHandlers.has(type)) {
          logger.warn(`Task handler for type '${type}' already registered, overwriting`);
        }
        this.taskHandlers.set(type, handler);
      }

      this.plugins.push(plugin);
      logger.info(`Loaded plugin from ${pluginDir}`);
    } catch (error) {
      logger.error(`Failed to load plugin from ${pluginDir}`, error);
    }
  }

  getHandler(taskType: string): ITaskHandler | undefined {
    return this.taskHandlers.get(taskType);
  }

  getAvailableTaskTypes(): string[] {
    return Array.from(this.taskHandlers.keys());
  }

  async dispose(): Promise<void> {
    const disposePromises = this.plugins.map(plugin => plugin.dispose());
    await Promise.all(disposePromises);
    this.plugins = [];
    this.taskHandlers.clear();
    logger.info('PluginManager disposed');
  }
}