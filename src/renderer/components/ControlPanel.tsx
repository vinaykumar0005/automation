// src/renderer/components/ControlPanel.tsx
import { useState } from 'react';
import { useAutomationStore } from '../state/store';

export function ControlPanel() {
  const [count, setCount] = useState(5);
  const [queuedUrls, setQueuedUrls] = useState('https://example.com\nhttps://www.wikipedia.org');
  const [spawning, setSpawning] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchedTabIds, setLaunchedTabIds] = useState<string[]>([]);
  const addLog = useAutomationStore((s) => s.addLog);

  const parseQueuedUrls = () =>
    queuedUrls
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const launchQueuedUrls = async () => {
    if (launching) return;

    const urls = parseQueuedUrls();
    if (urls.length === 0) {
      addLog(`[${new Date().toLocaleTimeString()}] No URLs queued for launch.`);
      return;
    }

    setLaunching(true);
    try {
      const startedTabs: string[] = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const tab = await window.automationApi.createTab(`Queue ${i + 1}`);
        startedTabs.push(tab.id);

        await window.automationApi.runTask(tab.id, {
          id: `navigate-${crypto.randomUUID()}`,
          type: 'navigate',
          payload: { url, waitUntil: 'domcontentloaded' },
        });
      }

      setLaunchedTabIds(startedTabs);
      addLog(
        `[${new Date().toLocaleTimeString()}] Launched ${startedTabs.length} queued URL${startedTabs.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Queue launch failed: ${err}`);
    } finally {
      setLaunching(false);
    }
  };

  const stopQueuedLaunch = async () => {
    if (launchedTabIds.length === 0) {
      addLog(`[${new Date().toLocaleTimeString()}] No queued tabs to stop.`);
      return;
    }

    try {
      await Promise.allSettled(launchedTabIds.map((id) => window.automationApi.closeTab(id)));
      addLog(
        `[${new Date().toLocaleTimeString()}] Stopped ${launchedTabIds.length} queued tab${launchedTabIds.length === 1 ? '' : 's'}.`
      );
      setLaunchedTabIds([]);
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Stop failed: ${err}`);
    }
  };

  const spawnTabs = async () => {
    if (spawning) return;
    setSpawning(true);
    try {
      for (let i = 0; i < count; i++) {
        await window.automationApi.createTab(`Tab ${i + 1}`);
      }
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Spawn failed: ${err}`);
    } finally {
      setSpawning(false);
    }
  };

  const broadcastNavigate = async (url: string) => {
    try {
      await window.automationApi.runBroadcastTask({ type: 'navigate', payload: { url } });
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Broadcast failed: ${err}`);
    }
  };

  return (
    <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Main Settings</div>
          <h2 className="text-base font-semibold text-white">Launch queued URLs and manage tabs</h2>
        </div>
        <div className="text-xs text-neutral-500">
          Launched tabs: <span className="text-neutral-200">{launchedTabIds.length}</span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.5fr_0.8fr]">
        <div className="space-y-3">
          <textarea
            value={queuedUrls}
            onChange={(e) => setQueuedUrls(e.target.value)}
            placeholder={'One URL per line\nhttps://example.com\nhttps://www.wikipedia.org'}
            rows={5}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-neutral-600"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={launchQueuedUrls}
              disabled={launching}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {launching ? 'Launching…' : 'Launch Queue'}
            </button>
            <button
              onClick={stopQueuedLaunch}
              disabled={launchedTabIds.length === 0}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 disabled:opacity-40"
            >
              Stop Queue
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Quick Actions</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-white outline-none"
            />
            <button
              onClick={spawnTabs}
              disabled={spawning}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {spawning ? 'Spawning…' : 'Spawn Tabs'}
            </button>
          </div>

          <button
            onClick={() => broadcastNavigate('https://example.com')}
            className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
          >
            Broadcast Navigate Example
          </button>

          <div className="rounded-lg bg-neutral-950/80 px-3 py-2 text-xs text-neutral-400">
            This slice covers the PDF-style main settings flow: queue URLs, launch tabs, and stop the queue.
            Watch-time ranges and advanced controls are still next.
          </div>
        </div>
      </div>
    </section>
  );
}