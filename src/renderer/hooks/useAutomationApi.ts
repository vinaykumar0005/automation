// src/renderer/hooks/useAutomationApi.ts
import { useEffect } from 'react';
import { useAutomationStore } from '../state/store';

export function useAutomationApi() {
  const applyEvent = useAutomationStore((s) => s.applyEvent);
  const addLog = useAutomationStore((s) => s.addLog);
  const addActivity = useAutomationStore((s) => s.addActivity);
  const setTabs = useAutomationStore((s) => s.setTabs);

  useEffect(() => {
    // Sync current tab state on mount (covers tabs created before this component mounted)
    window.automationApi.listTabs().then(setTabs).catch((err) => {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to load initial tabs: ${err}`);
    });

    const unsubscribe = window.automationApi.onTabEvent((evt) => {
      applyEvent(evt);
      addLog(`[${new Date().toLocaleTimeString()}] ${evt.kind} (${evt.tabId}): ${JSON.stringify(evt.data)}`);
      addActivity({
        tabId: evt.tabId,
        kind: evt.kind,
        timestamp: evt.timestamp,
        message:
          typeof evt.data === 'string'
            ? evt.data
            : evt.kind === 'status'
              ? 'Status updated'
              : evt.kind === 'result'
                ? 'Task completed'
                : 'Event received',
      });
    });

    return () => {
      unsubscribe();
    };
  }, [addActivity, applyEvent, addLog, setTabs]);
}

/** Alias for App.tsx's bootstrap-style import */
export const useAutomationBootstrap = useAutomationApi;