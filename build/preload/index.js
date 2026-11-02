"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preload/index.ts
var index_exports = {};
module.exports = __toCommonJS(index_exports);
var import_electron = require("electron");

// src/shared/ipc-channels.ts
var IPC_CHANNELS = {
  CREATE_TAB: "automation:create-tab",
  CLOSE_TAB: "automation:close-tab",
  RUN_TASK: "automation:run-task",
  RUN_BROADCAST_TASK: "automation:run-broadcast-task",
  LIST_TABS: "automation:list-tabs",
  TAB_EVENT: "automation:tab-event",
  SET_PROXIES: "automation:set-proxies",
  GET_PROXY_STATUS: "automation:get-proxy-status",
  GET_DASHBOARD_STATS: "automation:get-dashboard-stats",
  GET_APP_SETTINGS: "automation:get-app-settings",
  UPDATE_APP_SETTINGS: "automation:update-app-settings",
  LIST_PROFILES: "automation:list-profiles",
  CREATE_PROFILE: "automation:create-profile",
  UPDATE_PROFILE: "automation:update-profile",
  DELETE_PROFILE: "automation:delete-profile",
  IMPORT_PROFILES: "automation:import-profiles",
  EXPORT_PROFILES: "automation:export-profiles",
  RUN_PROFILE: "automation:run-profile",
  RESTART_PROFILE: "automation:restart-profile"
};

// src/preload/index.ts
var api = {
  createTab: (label) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.CREATE_TAB, label),
  closeTab: (id) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.CLOSE_TAB, id),
  runTask: (id, task) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.RUN_TASK, id, task),
  runBroadcastTask: (task, tabIds) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.RUN_BROADCAST_TASK, task, tabIds),
  listTabs: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.LIST_TABS),
  getDashboardStats: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
  getAppSettings: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_APP_SETTINGS),
  updateAppSettings: (settings) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.UPDATE_APP_SETTINGS, settings),
  onTabEvent: (cb) => {
    const listener = (_e, evt) => cb(evt);
    import_electron.ipcRenderer.on(IPC_CHANNELS.TAB_EVENT, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(IPC_CHANNELS.TAB_EVENT, listener);
    };
  },
  setProxies: (proxies, strategy) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.SET_PROXIES, proxies, strategy),
  getProxyStatus: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_PROXY_STATUS),
  listProfiles: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.LIST_PROFILES),
  createProfile: (profile) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.CREATE_PROFILE, profile),
  updateProfile: (id, updates) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.UPDATE_PROFILE, id, updates),
  deleteProfile: (id) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.DELETE_PROFILE, id),
  importProfiles: (payload) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PROFILES, payload),
  exportProfiles: () => import_electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PROFILES),
  runProfile: (id, tabId) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.RUN_PROFILE, id, tabId),
  restartProfile: (id, tabId) => import_electron.ipcRenderer.invoke(IPC_CHANNELS.RESTART_PROFILE, id, tabId)
};
import_electron.contextBridge.exposeInMainWorld("automationApi", api);
