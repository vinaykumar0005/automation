// src/renderer/state/store.ts
import { create } from 'zustand';
import type { TabState, TabEvent } from '../../shared/types';

interface AutomationStore {
  tabs: Record<string, TabState>;
  logs: string[];
  activity: Array<{ id: string; timestamp: number; tabId: string; kind: string; message: string }>;
  setTabs: (tabs: TabState[]) => void;
  applyEvent: (evt: TabEvent) => void;
  removeTab: (id: string) => void;
  addLog: (line: string) => void;
  addActivity: (entry: { tabId: string; kind: string; message: string; timestamp?: number }) => void;
  clearLogs: () => void;
}

export const useAutomationStore = create<AutomationStore>((set) => ({
  tabs: {},
  logs: [],
  activity: [],

  setTabs: (tabs) =>
    set(() => ({
      tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
    })),

  applyEvent: (evt) =>
    set((s) => {
      const { tabId, kind, data } = evt;

      if (kind === 'status' && data && typeof data === 'object') {
        const patch = data as Partial<TabState>;

        // Tab was closed on the backend — drop it from the grid entirely
        // instead of leaving a dead "closed" card around.
        if (patch.status === 'closed') {
          const { [tabId]: _removed, ...rest } = s.tabs;
          return { tabs: rest };
        }

        const existing = s.tabs[tabId];
        return {
          tabs: {
            ...s.tabs,
            [tabId]: {
              ...(existing ?? { id: tabId, label: tabId, status: 'idle', createdAt: Date.now() }),
              ...patch,
            },
          },
        };
      }

      if (kind === 'error' && typeof data === 'string') {
        const existing = s.tabs[tabId];
        if (!existing) return s;
        return {
          tabs: {
            ...s.tabs,
            [tabId]: { ...existing, status: 'error', lastError: data },
          },
        };
      }

      // kind === 'log' | 'result' -> no tab-state mutation, just logged by caller
      return s;
    }),

  removeTab: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.tabs;
      return { tabs: rest };
    }),

  addLog: (line) => set((s) => ({ logs: [...s.logs.slice(-499), line] })),
  addActivity: (entry) =>
    set((s) => ({
      activity: [
        ...s.activity.slice(-49),
        {
          id: crypto.randomUUID(),
          timestamp: entry.timestamp ?? Date.now(),
          tabId: entry.tabId,
          kind: entry.kind,
          message: entry.message,
        },
      ],
    })),
  clearLogs: () => set({ logs: [] }),
}));

export const useStore = useAutomationStore;
export type { TabState, AutomationStore };