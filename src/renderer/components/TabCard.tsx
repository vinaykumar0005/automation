// src/renderer/components/TabCard.tsx
import { useState } from 'react';
import type { TabState } from '../../shared/types';
import { useAutomationStore } from '../state/store';

const statusColor: Record<TabState['status'], string> = {
  idle: 'bg-gray-400',
  launching: 'bg-yellow-400',
  running: 'bg-blue-500 animate-pulse',
  error: 'bg-red-500',
  closed: 'bg-gray-700',
};

interface TabCardProps {
  tab: TabState;
}

export function TabCard({ tab }: TabCardProps) {
  const [closing, setClosing] = useState(false);
  const addLog = useAutomationStore((s) => s.addLog);
  const removeTab = useAutomationStore((s) => s.removeTab);

  const handleClose = async () => {
    setClosing(true);
    try {
      await window.automationApi.closeTab(tab.id);
      // Backend also emits a 'closed' status event which the store handles,
      // but we remove optimistically too in case the event is delayed/dropped.
      removeTab(tab.id);
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to close ${tab.id}: ${err}`);
      setClosing(false);
    }
  };

  return (
    <div className="relative rounded-lg border border-neutral-700 p-3 shadow-sm bg-neutral-800">
      <button
        onClick={handleClose}
        disabled={closing}
        title="Close tab"
        className="absolute top-2 right-2 text-neutral-500 hover:text-red-400 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700 disabled:opacity-40"
      >
        ✕
      </button>

      <div className="flex items-center gap-2 pr-6">
        <div className={`w-3 h-3 rounded-full shrink-0 ${statusColor[tab.status]}`} />
        <span className="font-medium text-sm truncate">{tab.label}</span>
      </div>
      <p className="text-xs text-neutral-500 font-mono mt-1 truncate">{tab.id}</p>
      <p className="text-xs text-neutral-400 truncate mt-1">{tab.currentUrl ?? 'about:blank'}</p>
      {tab.lastError && <p className="text-xs text-red-400 mt-1 truncate">{tab.lastError}</p>}
      <p className="text-xs text-neutral-500 capitalize mt-1">{closing ? 'closing…' : tab.status}</p>
    </div>
  );
}