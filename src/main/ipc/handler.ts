// src/main/ipc/handler.ts
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { BrowserController } from '../automation/BrowserController';
import { TabTask, ProxyConfig, ProxyRotationStrategy } from '../automation/types';
import { configService } from '../config/configService';
import type { ProfileCreateInput, ProfileRecord } from '../../shared/types';

export function registerIpcHandlers(
  controller: BrowserController,
  getWindow: () => BrowserWindow | null
) {
  ipcMain.handle(IPC_CHANNELS.CREATE_TAB, (_e, label?: string) => controller.createTab(label));
  ipcMain.handle(IPC_CHANNELS.CLOSE_TAB, (_e, id: string) => controller.closeTab(id));
  ipcMain.handle(IPC_CHANNELS.RUN_TASK, (_e, id: string, task: TabTask) =>
    controller.runTask(id, task)
  );
  ipcMain.handle(
    IPC_CHANNELS.RUN_BROADCAST_TASK,
    (_e, task: Omit<TabTask, 'id'>, tabIds?: string[]) =>
      controller.runBroadcastTask(task, tabIds)
  );
  ipcMain.handle(IPC_CHANNELS.LIST_TABS, () => controller.listTabs());
  ipcMain.handle(IPC_CHANNELS.GET_DASHBOARD_STATS, () => controller.getDashboardStats());
  ipcMain.handle(IPC_CHANNELS.GET_APP_SETTINGS, () => configService.getAppSettings());
  ipcMain.handle(IPC_CHANNELS.UPDATE_APP_SETTINGS, (_e, settings) =>
    configService.updateAppSettings(settings)
  );
  ipcMain.handle(
    IPC_CHANNELS.SET_PROXIES,
    (_e, proxies: ProxyConfig[], strategy: ProxyRotationStrategy) =>
      controller.setProxies(proxies, strategy)
  );
  ipcMain.handle(IPC_CHANNELS.GET_PROXY_STATUS, () => controller.getProxyStatus());
  ipcMain.handle(IPC_CHANNELS.LIST_PROFILES, () => controller.listProfiles());
  ipcMain.handle(IPC_CHANNELS.CREATE_PROFILE, (_e, profile: ProfileCreateInput) => controller.createProfile(profile));
  ipcMain.handle(IPC_CHANNELS.UPDATE_PROFILE, (_e, id: string, updates: Partial<ProfileRecord>) => controller.updateProfile(id, updates));
  ipcMain.handle(IPC_CHANNELS.DELETE_PROFILE, (_e, id: string) => controller.deleteProfile(id));
  ipcMain.handle(IPC_CHANNELS.IMPORT_PROFILES, (_e, payload: string) => controller.importProfiles(payload));
  ipcMain.handle(IPC_CHANNELS.EXPORT_PROFILES, () => controller.exportProfiles());
  ipcMain.handle(IPC_CHANNELS.RUN_PROFILE, (_e, id: string, tabId?: string) => controller.runProfile(id, tabId));
  ipcMain.handle(IPC_CHANNELS.RESTART_PROFILE, (_e, id: string, tabId?: string) => controller.restartProfile(id, tabId));
}