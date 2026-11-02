import { BrowserContext } from 'playwright';
import { EventEmitter } from 'node:events';
import { TabManager } from './TabManager';
import { TaskQueue } from './TaskQueue';
import { ProxyManager } from './ProxyManager';
import { FingerprintManager } from './fingerprintManager';
import { PluginManager } from './plugins/pluginManager';
import { configService } from '../config/configService';
import logger from '../logging/logger';
import { metricsCollector } from '../monitoring/metricsCollector';
import { healthChecker } from '../monitoring/healthChecker';
import { traceManager } from '../monitoring/traceManager';
import { createProfileStore, ProfileStore } from './profileStore';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../ipc/channels';
import type { DashboardStats, ProfileCreateInput, ProfileRecord, ProfileRunRecord, ProfileRunResult, ProfileStats, TabEvent } from '../../shared/types';
import type { ProxyConfig, ProxyRotationStrategy, TabTask, TabState } from '../../shared/types';
import * as path from 'path';
import { InputSimulation } from './inputSimulation';
import { BrowserWindow } from 'electron';
import { app } from 'electron';

// Helper function to get the correct base path for app data
const getAppPath = () => {
  try {
    // When packaged, use the directory containing the executable
    if (app.isPackaged) {
      // In packaged apps, the executable is in a different location than the app.asar
      // We want to use the directory where the executable resides for user data
      const exePath = app.getPath('exe');
      if (exePath) {
        return path.dirname(exePath);
      }
      // Fallback to app.getAppPath() if exePath fails
      return app.getAppPath();
    }

    // When not packaged (development), use the current working directory
    // or the directory of the main script
    try {
      // Try to get the app path first
      const appPath = app.getAppPath();
      if (appPath) {
        return appPath;
      }
    } catch (e) {
      // Ignore errors and continue to fallbacks
    }

    // Fallback to current working directory
    return process.cwd();
  } catch (e) {
    // Final fallback to ensure we always return a valid path
    try {
      return path.resolve('.');
    } catch {
      // Last resort - use system temp directory
      return require('os').tmpdir();
    }
  }
};

export class BrowserController extends EventEmitter {
  private tabManager: TabManager;
  private taskQueue: TaskQueue;
  private pluginManager: PluginManager;
  private proxyManager: ProxyManager;
  private browser: import('playwright').Browser | null = null;
  private readonly startedAt = Date.now();
  private browserReadyAt: number | null = null;
  private profileStorePath = path.join(getAppPath(), 'profiles.json');
  private profileStore: ProfileStore | null = null;
  private profiles: ProfileRecord[] = [];
  private profileSchedulerTimer: NodeJS.Timeout | null = null;
  private profilesWriteQueue: Promise<void> = Promise.resolve();
  isShutDown = false;
  private getWindow: (() => BrowserWindow | null) | null = null;

  private fingerprintManager: FingerprintManager;

  constructor() {
    super();
    const antiDetectionConfig = configService.getAntiDetectionConfig();
    const inputSimulation = new InputSimulation({
      poissonMeanMs: antiDetectionConfig.poissonMeanMs,
      delayMinMs: antiDetectionConfig.delayMinMs,
      delayMaxMs: antiDetectionConfig.delayMaxMs
    });
    this.taskQueue = new TaskQueue(inputSimulation);
    const browserConfig = configService.getBrowserConfig();
    this.pluginManager = new PluginManager();
    this.proxyManager = new ProxyManager();
    // Set proxy tier preference based on antidetection configuration
    this.proxyManager.setTierPreference({ preferResidential: antiDetectionConfig.preferResidential });
    this.tabManager = new TabManager(browserConfig.maxTabs, this.proxyManager, this.pluginManager, {
      headless: browserConfig.headless,
      bypassCSP: browserConfig.bypassCSP,
      ignoreHTTPSErrors: browserConfig.ignoreHTTPSErrors
    }, () => {
      this.browserReadyAt = Date.now();
    });

    // Initialize fingerprint manager
    this.fingerprintManager = new FingerprintManager();
  }

  private emitEvent(evt: TabEvent) {
    this.emit('tab-event', evt);
  }

  async createTab(label?: string) {
    const startTime = Date.now();
    const span = traceManager.startSpan('browser_controller_create_tab');
    try {
      // Generate fingerprint configuration
      const fingerprintConfig = this.fingerprintManager.generateFingerprint();
      // Pass fingerprint config to TabManager when creating tab
      const result = await this.tabManager.createTab(label, fingerprintConfig);
      metricsCollector.getCounter({ name: 'tabs_created' }).inc();
      metricsCollector.getCounter({ name: 'tasks_executed' }).inc();
      return result;
    } catch (error) {
      metricsCollector.getCounter({ name: 'tasks_executed' }).inc();
      metricsCollector.getCounter({ name: 'tasks_failed' }).inc();
      throw error;
    } finally {
      traceManager.endSpan(span);
      metricsCollector.getHistogram({ name: 'task_duration' }).observe((Date.now() - startTime) / 1000);
    }
  }

  async init() {
    await this.tabManager.init();
    await this.pluginManager.initialize();
  }

  async setProxiesAsync(proxies: ProxyConfig[], strategy: ProxyRotationStrategy) {
    return await this.proxyManager.setProxiesValidated(proxies, strategy);
  }

  attachBroadcast(getWindow: () => BrowserWindow | null) {
    // Store the getWindow function for use in broadcasting events
    this.getWindow = getWindow;

    // Forward tab events from TabManager to renderer via IPC
    this.tabManager.on('tab-event', (evt: TabEvent) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TAB_EVENT, evt);
      }
    });

    // Forward events from BrowserController to renderer via IPC
    this.on('tab-event', (evt: TabEvent) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TAB_EVENT, evt);
      }
    });
  }

  async closeTab(id: string) {
    return await this.tabManager.closeTab(id);
  }

  async runTask(id: string, task: TabTask) {
    return await this.tabManager.runTask(id, task);
  }

  async runBroadcastTask(task: Omit<TabTask, 'id'>, tabIds?: string[]) {
    return await this.tabManager.runBroadcastTask(task, tabIds);
  }

  listTabs(): TabState[] {
    return this.tabManager.listTabs();
  }

  async getDashboardStats() {
    // Implement dashboard stats by aggregating data from various managers
    const tabStates = this.listTabs();
    const proxyStatus = this.proxyManager.getStatus();
    const isBrowserAlive = this.browser !== null && this.browser.isConnected();

    return {
      appUptimeMs: Date.now() - this.startedAt,
      browserUptimeMs: isBrowserAlive ? (Date.now() - (this.browserReadyAt ?? Date.now())) : null,
      browserAlive: isBrowserAlive,
      isShutDown: this.isShutDown,
      activeTabs: tabStates.filter(t => t.status === 'running').length,
      tabsCreated: 0, // TODO: implement counter
      tabsClosed: 0, // TODO: implement counter
      tasksExecuted: 0, // TODO: implement counter
      tasksFailed: 0, // TODO: implement counter
      proxyStatus,
      health: {
        status: 'pass', // TODO: implement actual health checks
        timestamp: new Date().toISOString(),
        responseTimeMs: 0,
        checks: {}
      }
    };
  }

  async setProxies(proxies: ProxyConfig[], strategy: ProxyRotationStrategy) {
    return await this.proxyManager.setProxies(proxies, strategy);
  }

  async getProxyStatus() {
    return this.proxyManager.getStatus();
  }

  private async getProfileStore(): Promise<ProfileStore> {
    if (!this.profileStore) {
      const { enableEncryption } = configService.getSecurityConfig();
      this.profileStore = await createProfileStore({
        enableEncryption,
        plaintextFilePath: this.profileStorePath
      });
    }
    return this.profileStore;
  }

  async listProfiles() {
    const store = await this.getProfileStore();
    return await store.load();
  }

  async createProfile(profileInput: ProfileCreateInput): Promise<ProfileRecord> {
    const store = await this.getProfileStore();
    const profiles = await store.load();

    // Create a complete ProfileRecord from the input
    const now = Date.now();
    const profile: ProfileRecord = {
      id: randomUUID(),
      name: profileInput.name,
      description: profileInput.description ?? '',
      baseUrl: profileInput.baseUrl,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      lastRunAt: undefined,
      lastRestartAt: undefined,
      runCount: 0,
      restartCount: 0,
      scheduleEnabled: profileInput.scheduleEnabled,
      scheduleIntervalMs: profileInput.scheduleIntervalMs,
      retryCount: profileInput.retryCount,
      retryDelayMs: profileInput.retryDelayMs,
      resumeOnRestart: profileInput.resumeOnRestart ?? false,
      lastError: undefined,
      steps: profileInput.steps,
      history: []
    };

    profiles.push(profile);
    await store.save(profiles);
    return profile;
  }

  async updateProfile(id: string, updates: Partial<ProfileRecord>) {
    const store = await this.getProfileStore();
    const profiles = await store.load();
    const index = profiles.findIndex(p => p.id === id);
    if (index !== -1) {
      profiles[index] = { ...profiles[index], ...updates };
      await store.save(profiles);
    }
    return profiles[index];
  }

  async deleteProfile(id: string) {
    const store = await this.getProfileStore();
    const profiles = await store.load();
    const newProfiles = profiles.filter(p => p.id !== id);
    await store.save(newProfiles);
  }

  async importProfiles(payload: string): Promise<ProfileRecord[]> {
    const store = await this.getProfileStore();
    const now = Date.now();

    // Parse the payload assuming it's an array of ProfileCreateInput or partial ProfileRecord
    const profileInputs = JSON.parse(payload) as Partial<ProfileRecord>[];

    // Convert each input to a complete ProfileRecord
    const newProfiles: ProfileRecord[] = profileInputs.map(input => ({
      id: input.id ?? randomUUID(),
      name: input.name ?? 'Unnamed Profile',
      description: input.description ?? '',
      baseUrl: input.baseUrl,
      status: input.status ?? 'idle',
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      lastRunAt: input.lastRunAt,
      lastRestartAt: input.lastRestartAt,
      runCount: input.runCount ?? 0,
      restartCount: input.restartCount ?? 0,
      scheduleEnabled: input.scheduleEnabled,
      scheduleIntervalMs: input.scheduleIntervalMs,
      retryCount: input.retryCount,
      retryDelayMs: input.retryDelayMs,
      resumeOnRestart: input.resumeOnRestart ?? false,
      lastError: input.lastError,
      steps: input.steps ?? [],
      history: input.history ?? []
    }));

    await store.save(newProfiles);
    return newProfiles;
  }

  async exportProfiles() {
    const store = await this.getProfileStore();
    const profiles = await store.load();
    return JSON.stringify(profiles, null, 2);
  }

  async runProfile(id: string, tabId?: string): Promise<ProfileRunResult> {
    // Load the profile
    const profiles = await this.listProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    // Create or validate tab
    let tabToUse: string | undefined = tabId;
    let createdTab = false;

    if (!tabToUse) {
      // Create a new tab for this profile run
      const tabState = await this.createTab(`Profile Run: ${profile.name}`);
      tabToUse = tabState.id;
      createdTab = true;
    } else {
      // Validate that the tab exists and is usable
      const tabState = this.listTabs().find(t => t.id === tabToUse);
      if (!tabState) {
        throw new Error(`Tab not found: ${tabToUse}`);
      }
      // Note: We don't check if closed here because runTask will handle that
    }

    // Create run record
    const runId = randomUUID();
    const startedAt = Date.now();

    const runRecord: ProfileRunRecord = {
      id: runId,
      startedAt,
      status: 'running',
      note: `Started profile run for "${profile.name}"`,
      tabId: tabToUse,
      stepCount: profile.steps.length,
      stepAudit: profile.steps.map(step => ({
        stepId: step.id,
        title: step.title,
        status: 'pending'
      }))
    };

    // Emit initial status
    this.emitEvent({
      tabId: tabToUse ?? 'profile-run',
      kind: 'log',
      data: `Starting profile run for "${profile.name}" (${profile.steps.length} steps)`,
      timestamp: Date.now()
    });

    try {
      // Execute each step in sequence
      for (let stepIndex = 0; stepIndex < profile.steps.length; stepIndex++) {
        const step = profile.steps[stepIndex];

        // Update step audit to running
        runRecord.stepAudit![stepIndex].status = 'running';
        runRecord.stepAudit![stepIndex].startedAt = Date.now();

        // Emit step started
        this.emitEvent({
          tabId: tabToUse ?? 'profile-run',
          kind: 'log',
          data: `Running step ${stepIndex + 1}/${profile.steps.length}: "${step.title}"`,
          timestamp: Date.now()
        });

        try {
          // Execute the task
          await this.runTask(tabToUse, {
            id: randomUUID(), // Generate a task ID for this step
            type: step.type,
            payload: step.payload
          });

          // Mark step as completed
          runRecord.stepAudit![stepIndex].status = 'completed';
          runRecord.stepAudit![stepIndex].completedAt = Date.now();
          runRecord.stepAudit![stepIndex].note = `Step completed successfully`;

          // Emit step completed
          this.emitEvent({
            tabId: tabToUse ?? 'profile-run',
            kind: 'log',
            data: `Completed step ${stepIndex + 1}/${profile.steps.length}: "${step.title}"`,
            timestamp: Date.now()
          });
        } catch (stepError: any) {
          // Mark step as failed
          runRecord.stepAudit![stepIndex].status = 'failed';
          runRecord.stepAudit![stepIndex].completedAt = Date.now();
          runRecord.stepAudit![stepIndex].note = stepError.message ?? String(stepError);

          // Emit step failed
          this.emitEvent({
            tabId: tabToUse ?? 'profile-run',
            kind: 'error',
            data: `Failed step ${stepIndex + 1}/${profile.steps.length}: "${step.title}" - ${stepError.message}`,
            timestamp: Date.now()
          });

          // Mark the whole run as failed
          runRecord.status = 'failed';
          runRecord.completedAt = Date.now();
          runRecord.note = `Failed at step "${step.title}": ${stepError.message}`;

          // Update profile
          await this.updateProfile(id, {
            lastRunAt: Date.now(),
            lastError: stepError.message ?? String(stepError),
            status: 'failed'
          });

          // Add to history
          const updatedProfile = await this.loadProfile(id);
          updatedProfile.history.push(runRecord);
          await this.updateProfile(id, { history: updatedProfile.history });

          // Return result
          return {
            profile: updatedProfile,
            run: runRecord
          };
        }
      }

      // All steps completed successfully
      runRecord.status = 'completed';
      runRecord.completedAt = Date.now();
      runRecord.note = `Completed all ${profile.steps.length} steps successfully`;

      // Emit completion
      this.emitEvent({
        tabId: tabToUse ?? 'profile-run',
        kind: 'log',
        data: `Profile run completed successfully: "${profile.name}"`,
        timestamp: Date.now()
      });

      // Update profile
      const updatedProfile = await this.loadProfile(id);
      await this.updateProfile(id, {
        lastRunAt: Date.now(),
        runCount: updatedProfile.runCount + 1,
        status: 'completed',
        lastError: undefined
      });

      // Add to history
      updatedProfile.history.push(runRecord);
      await this.updateProfile(id, { history: updatedProfile.history });

      // Return result
      return {
        profile: updatedProfile,
        run: runRecord
      };
    } catch (error: any) {
      // Unexpected error
      runRecord.status = 'failed';
      runRecord.completedAt = Date.now();
      runRecord.note = `Unexpected error: ${error.message}`;

      // Emit error
      this.emitEvent({
        tabId: tabToUse ?? 'profile-run',
        kind: 'error',
        data: `Unexpected error during profile run: ${error.message}`,
        timestamp: Date.now()
      });

      // Update profile
      try {
        const updatedProfile = await this.loadProfile(id);
        await this.updateProfile(id, {
          lastRunAt: Date.now(),
          lastError: error.message ?? String(error),
          status: 'failed'
        });

        // Add to history if we have a run record with steps
        if (runRecord.stepAudit && runRecord.stepAudit.length > 0) {
          updatedProfile.history.push(runRecord);
          await this.updateProfile(id, { history: updatedProfile.history });
        }
      } catch (e: unknown) {
        // If we can't update the profile, just log it
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.emitEvent({
          tabId: tabToUse ?? 'profile-run',
          kind: 'error',
          data: `Failed to update profile after error: ${errorMessage}`,
          timestamp: Date.now()
        });
      }

      // Return result
      return {
        profile: await this.loadProfile(id), // Reload to get current state
        run: runRecord
      };
    }
  }

  private async loadProfile(id: string): Promise<ProfileRecord> {
    const profiles = await this.listProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }
    return profile;
  }

  async restartProfile(id: string, tabId?: string): Promise<ProfileRunResult> {
    // Load the profile
    const profiles = await this.listProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    // Create or validate tab
    let tabToUse: string | undefined = tabId;
    let createdTab = false;

    if (!tabToUse) {
      // Create a new tab for this profile restart
      const tabState = await this.createTab(`Profile Restart: ${profile.name}`);
      tabToUse = tabState.id;
      createdTab = true;
    } else {
      // Validate that the tab exists and is usable
      const tabState = this.listTabs().find(t => t.id === tabToUse);
      if (!tabState) {
        throw new Error(`Tab not found: ${tabToUse}`);
      }
    }

    // Create run record
    const runId = randomUUID();
    const startedAt = Date.now();

    const runRecord: ProfileRunRecord = {
      id: runId,
      startedAt,
      status: 'running',
      note: `Started profile restart for "${profile.name}"`,
      tabId: tabToUse,
      stepCount: profile.steps.length,
      stepAudit: profile.steps.map(step => ({
        stepId: step.id,
        title: step.title,
        status: 'pending'
      }))
    };

    // Emit initial status
    this.emitEvent({
      tabId: tabToUse ?? 'profile-restart',
      kind: 'log',
      data: `Starting profile restart for "${profile.name}"`,
      timestamp: Date.now()
    });

    try {
      // Execute each step in sequence
      for (let stepIndex = 0; stepIndex < profile.steps.length; stepIndex++) {
        const step = profile.steps[stepIndex];

        // Update step audit to running
        runRecord.stepAudit![stepIndex].status = 'running';
        runRecord.stepAudit![stepIndex].startedAt = Date.now();

        // Emit step started
        this.emitEvent({
          tabId: tabToUse ?? 'profile-restart',
          kind: 'log',
          data: `Running step ${stepIndex + 1}/${profile.steps.length}: "${step.title}"`,
          timestamp: Date.now()
        });

        try {
          // Execute the task
          await this.runTask(tabToUse, {
            id: randomUUID(), // Generate a task ID for this step
            type: step.type,
            payload: step.payload
          });

          // Mark step as completed
          runRecord.stepAudit![stepIndex].status = 'completed';
          runRecord.stepAudit![stepIndex].completedAt = Date.now();
          runRecord.stepAudit![stepIndex].note = `Step completed successfully`;

          // Emit step completed
          this.emitEvent({
            tabId: tabToUse ?? 'profile-restart',
            kind: 'log',
            data: `Completed step ${stepIndex + 1}/${profile.steps.length}: "${step.title}"`,
            timestamp: Date.now()
          });
        } catch (stepError: any) {
          // Mark step as failed
          runRecord.stepAudit![stepIndex].status = 'failed';
          runRecord.stepAudit![stepIndex].completedAt = Date.now();
          runRecord.stepAudit![stepIndex].note = stepError.message ?? String(stepError);

          // Emit step failed
          this.emitEvent({
            tabId: tabToUse ?? 'profile-restart',
            kind: 'error',
            data: `Failed step ${stepIndex + 1}/${profile.steps.length}: "${step.title}" - ${stepError.message}`,
            timestamp: Date.now()
          });

          // Mark the whole run as failed
          runRecord.status = 'failed';
          runRecord.completedAt = Date.now();
          runRecord.note = `Failed at step "${step.title}": ${stepError.message}`;

          // Update profile
          await this.updateProfile(id, {
            lastRestartAt: Date.now(),
            restartCount: profile.restartCount + 1,
            lastError: stepError.message ?? String(stepError),
            status: 'failed'
          });

          // Add to history
          const updatedProfile = await this.loadProfile(id);
          updatedProfile.history.push(runRecord);
          await this.updateProfile(id, { history: updatedProfile.history });

          // Return result
          return {
            profile: updatedProfile,
            run: runRecord
          };
        }
      }

      // All steps completed successfully
      runRecord.status = 'completed';
      runRecord.completedAt = Date.now();
      runRecord.note = `Completed all ${profile.steps.length} steps successfully`;

      // Emit completion
      this.emitEvent({
        tabId: tabToUse ?? 'profile-restart',
        kind: 'log',
        data: `Profile restart completed successfully: "${profile.name}"`,
        timestamp: Date.now()
      });

      // Update profile
      await this.updateProfile(id, {
        lastRestartAt: Date.now(),
        restartCount: profile.restartCount + 1,
        status: 'completed',
        lastError: undefined
      });

      // Add to history
      const updatedProfile = await this.loadProfile(id);
      updatedProfile.history.push(runRecord);
      await this.updateProfile(id, { history: updatedProfile.history });

      // Return result
      return {
        profile: updatedProfile,
        run: runRecord
      };
    } catch (error: any) {
      // Unexpected error
      runRecord.status = 'failed';
      runRecord.completedAt = Date.now();
      runRecord.note = `Unexpected error: ${error.message}`;

      // Emit error
      this.emitEvent({
        tabId: tabToUse ?? 'profile-restart',
        kind: 'error',
        data: `Unexpected error during profile restart: ${error.message}`,
        timestamp: Date.now()
      });

      // Update profile
      try {
        await this.updateProfile(id, {
          lastRestartAt: Date.now(),
          restartCount: profile.restartCount + 1,
          lastError: error.message ?? String(error),
          status: 'failed'
        });

        // Add to history if we have a run record with steps
        if (runRecord.stepAudit && runRecord.stepAudit.length > 0) {
          const updatedProfile = await this.loadProfile(id);
          updatedProfile.history.push(runRecord);
          await this.updateProfile(id, { history: updatedProfile.history });
        }
      } catch (e: unknown) {
        // If we can't update the profile, just log it
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.emitEvent({
          tabId: tabToUse ?? 'profile-restart',
          kind: 'error',
          data: `Failed to update profile after error: ${errorMessage}`,
          timestamp: Date.now()
        });
      }

      // Return result
      return {
        profile: await this.loadProfile(id), // Reload to get current state
        run: runRecord
      };
    }
  }

  async shutdown() {
    this.isShutDown = true;
    await this.tabManager.shutdownAll();
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}