// src/renderer/components/LogConsole.tsx
import { useEffect, useRef } from 'react';
import { useAutomationStore } from '../state/store';

export function LogConsole() {
  const logs = useAutomationStore((s) => s.logs);
  const clearLogs = useAutomationStore((s) => s.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user has manually scrolled up, so we don't yank
  // them back down while they're reading older log lines.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-40 border-t border-neutral-800">
      <div className="flex items-center justify-between px-2 py-1 bg-neutral-900 border-b border-neutral-800">
        <span className="text-xs text-neutral-500 uppercase tracking-wide">Activity Log</span>
        <button
          onClick={clearLogs}
          className="text-xs text-neutral-500 hover:text-neutral-300 px-2 py-0.5 rounded hover:bg-neutral-800"
        >
          Clear
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-black text-green-400 font-mono text-xs p-2"
      >
        {logs.length === 0 ? (
          <p className="text-neutral-600">No activity yet.</p>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}