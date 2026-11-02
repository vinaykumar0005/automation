// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  TabTask,
  TabEvent,
  TabState,
  AutomationApi,
  ProxyConfig,
  ProxyRotationStrategy,
  ProxyStatus,
  DashboardStats,
  AppSettings,
  ProfileCreateInput,
  ProfileRecord,
  ProfileRunResult,
} from '../shared/types';

const api: AutomationApi = {
  createTab: (label?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_TAB, label),
  closeTab: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_TAB, id),
  runTask: (id: string, task: TabTask) => ipcRenderer.invoke(IPC_CHANNELS.RUN_TASK, id, task),
  runBroadcastTask: (task: Omit<TabTask, 'id'>, tabIds?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.RUN_BROADCAST_TASK, task, tabIds),
  listTabs: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_TABS) as Promise<TabState[]>,
  getDashboardStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS) as Promise<DashboardStats>,
  getAppSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_SETTINGS) as Promise<AppSettings>,
  updateAppSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_APP_SETTINGS, settings) as Promise<AppSettings>,
  onTabEvent: (cb: (evt: TabEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: TabEvent) => cb(evt);
    ipcRenderer.on(IPC_CHANNELS.TAB_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TAB_EVENT, listener);
    };
  },
  setProxies: (proxies: ProxyConfig[], strategy: ProxyRotationStrategy) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_PROXIES, proxies, strategy),
  getProxyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROXY_STATUS) as Promise<ProxyStatus>,
  listProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_PROFILES) as Promise<ProfileRecord[]>,
  createProfile: (profile: ProfileCreateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_PROFILE, profile) as Promise<ProfileRecord>,
  updateProfile: (id: string, updates: Partial<ProfileRecord>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_PROFILE, id, updates) as Promise<ProfileRecord>,
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_PROFILE, id) as Promise<void>,
  importProfiles: (payload: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PROFILES, payload) as Promise<ProfileRecord[]>,
  exportProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PROFILES) as Promise<string>,
  runProfile: (id: string, tabId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RUN_PROFILE, id, tabId) as Promise<ProfileRunResult>,
  restartProfile: (id: string, tabId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESTART_PROFILE, id, tabId) as Promise<ProfileRunResult>,
};

contextBridge.exposeInMainWorld('automationApi', api);

export type { AutomationApi };