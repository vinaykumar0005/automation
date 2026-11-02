import { useEffect, useState } from 'react';
import { useAutomationStore } from '../state/store';
import type { AppSettings } from '../../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  browser: {
    headless: false,
    maxTabs: 20,
  },
  automation: {
    defaultTimeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
    enablePlugins: true,
  },
};

export function AdvancedPanel() {
  const addLog = useAutomationStore((s) => s.addLog);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.automationApi.getAppSettings()
      .then(setSettings)
      .catch((err) => addLog(`[${new Date().toLocaleTimeString()}] Failed to load settings: ${err}`));
  }, [addLog]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updated = await window.automationApi.updateAppSettings(settings);
      setSettings(updated);
      addLog(`[${new Date().toLocaleTimeString()}] Saved advanced settings.`);
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to save settings: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Advanced</div>
          <h2 className="text-base font-semibold text-white">Browser and automation settings</h2>
        </div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Browser</div>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Headless mode
            <input
              type="checkbox"
              checked={settings.browser.headless}
              onChange={(e) => setSettings((prev) => ({ ...prev, browser: { ...prev.browser, headless: e.target.checked } }))}
              className="accent-sky-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Max tabs
            <input
              type="number"
              min={1}
              max={100}
              value={settings.browser.maxTabs}
              onChange={(e) => setSettings((prev) => ({ ...prev, browser: { ...prev.browser, maxTabs: Number(e.target.value) } }))}
              className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white outline-none"
            />
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Automation</div>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Enable plugins
            <input
              type="checkbox"
              checked={settings.automation.enablePlugins}
              onChange={(e) => setSettings((prev) => ({ ...prev, automation: { ...prev.automation, enablePlugins: e.target.checked } }))}
              className="accent-sky-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Default timeout ms
            <input
              type="number"
              min={1000}
              step={1000}
              value={settings.automation.defaultTimeout}
              onChange={(e) => setSettings((prev) => ({ ...prev, automation: { ...prev.automation, defaultTimeout: Number(e.target.value) } }))}
              className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white outline-none"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Retry attempts
            <input
              type="number"
              min={0}
              max={10}
              value={settings.automation.retryAttempts}
              onChange={(e) => setSettings((prev) => ({ ...prev, automation: { ...prev.automation, retryAttempts: Number(e.target.value) } }))}
              className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white outline-none"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200">
            Retry delay ms
            <input
              type="number"
              min={0}
              step={100}
              value={settings.automation.retryDelay}
              onChange={(e) => setSettings((prev) => ({ ...prev, automation: { ...prev.automation, retryDelay: Number(e.target.value) } }))}
              className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white outline-none"
            />
          </label>
        </div>
      </div>
    </section>
  );
}