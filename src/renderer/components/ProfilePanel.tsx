import { useEffect, useMemo, useState } from 'react';
import { useAutomationStore } from '../state/store';
import type { ProfileCreateInput, ProfileRecord, ProfileTaskStep } from '../../shared/types';

const TASK_TYPES = [
  'navigate',
  'extractText',
  'fillForm',
  'screenshot',
  'click',
  'waitForSelector',
  'loopVideo',
  'watchDuration',
  'checkIpLeak',
  'stopLoopVideo',
];

const emptyStep = (): ProfileTaskStep => ({
  id: crypto.randomUUID(),
  type: 'navigate',
  title: 'Navigate',
  payload: { url: 'https://example.com', waitUntil: 'domcontentloaded', clearSessionFirst: false, handleYouTubeConsent: true },
});

const getDefaultPayload = (type: string): Record<string, unknown> => {
  switch (type) {
    case 'navigate':
      return { url: 'https://example.com', waitUntil: 'domcontentloaded', clearSessionFirst: false, handleYouTubeConsent: true };
    case 'extractText':
      return { selector: 'h1' };
    case 'fillForm':
      return { fields: [{ selector: 'input', value: '' }] };
    case 'screenshot':
      return {};
    case 'click':
      return { selector: 'button' };
    case 'waitForSelector':
      return { selector: '.content', timeout: 10000 };
    case 'loopVideo':
      return { selector: 'video.html5-main-video, video', url: '', maxLoops: 0, loopDelayMs: 2000, enableHumanBehavior: true };
    case 'watchDuration':
      return { minWatchTimeMs: 30000, maxWatchTimeMs: 60000, url: '', selector: 'video.html5-main-video, video', enableHumanBehavior: true, clearSessionFirst: false };
    case 'checkIpLeak':
      return {};
    case 'stopLoopVideo':
      return {};
    default:
      return {};
  }
};

export function ProfilePanel() {
  const addLog = useAutomationStore((s) => s.addLog);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://example.com');
  const [steps, setSteps] = useState<ProfileTaskStep[]>([emptyStep()]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleIntervalMs, setScheduleIntervalMs] = useState(60_000);
  const [retryCount, setRetryCount] = useState(1);
  const [retryDelayMs, setRetryDelayMs] = useState(2_000);
  const [resumeOnRestart, setResumeOnRestart] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshProfiles = async () => {
    try {
      const result = await window.automationApi.listProfiles();
      setProfiles(result);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to load profiles: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProfiles();
  }, []);

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  const updateStep = (id: string, patch: Partial<ProfileTaskStep>) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  };

  const addStep = () => setSteps((current) => [...current, emptyStep()]);
  const removeStep = (id: string) => setSteps((current) => current.filter((step) => step.id !== id));

  const saveProfile = async () => {
    if (!canSave) return;
    const input: ProfileCreateInput = {
      name: name.trim(),
      description,
      baseUrl: baseUrl || undefined,
      steps,
      scheduleEnabled,
      scheduleIntervalMs,
      retryCount,
      retryDelayMs,
      resumeOnRestart,
    };
    try {
      const created = await window.automationApi.createProfile(input);
      setProfiles((current) => [created, ...current]);
      setName('');
      setDescription('');
      setBaseUrl('https://example.com');
      setSteps([emptyStep()]);
      setScheduleEnabled(false);
      setScheduleIntervalMs(60_000);
      setRetryCount(1);
      setRetryDelayMs(2_000);
      setResumeOnRestart(true);
      addLog(`[${new Date().toLocaleTimeString()}] Created profile ${created.name}`);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to create profile: ${error}`);
    }
  };

  const runProfile = async (id: string) => {
    setBusyId(id);
    try {
      await window.automationApi.runProfile(id);
      await refreshProfiles();
      addLog(`[${new Date().toLocaleTimeString()}] Ran profile`);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to run profile: ${error}`);
    } finally {
      setBusyId(null);
    }
  };

  const restartProfile = async (id: string) => {
    setBusyId(id);
    try {
      await window.automationApi.restartProfile(id);
      await refreshProfiles();
      addLog(`[${new Date().toLocaleTimeString()}] Restarted profile`);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to restart profile: ${error}`);
    } finally {
      setBusyId(null);
    }
  };

  const exportProfiles = async () => {
    try {
      const payload = await window.automationApi.exportProfiles();
      await navigator.clipboard.writeText(payload);
      addLog(`[${new Date().toLocaleTimeString()}] Exported profiles to clipboard`);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to export profiles: ${error}`);
    }
  };

  const importProfiles = async () => {
    const payload = window.prompt('Paste exported profile JSON');
    if (!payload) return;
    try {
      const imported = await window.automationApi.importProfiles(payload);
      setProfiles(imported);
      addLog(`[${new Date().toLocaleTimeString()}] Imported ${imported.length} profile${imported.length === 1 ? '' : 's'}`);
    } catch (error) {
      addLog(`[${new Date().toLocaleTimeString()}] Failed to import profiles: ${error}`);
    }
  };

  return (
    <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Profiles & Sessions</div>
          <h2 className="text-base font-semibold text-white">Persisted runbooks with history and restart tracking</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void exportProfiles()} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900">Export</button>
          <button onClick={() => void importProfiles()} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900">Import</button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Create Profile</div>
          <div className="mt-3 space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name" className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL" className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
            <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
              {steps.map((step, index) => (
                <div key={step.id} className="rounded border border-neutral-800 bg-neutral-900/80 p-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                    <span>Step {index + 1}</span>
                    {steps.length > 1 && <button onClick={() => removeStep(step.id)} className="text-rose-300">Remove</button>}
                  </div>

                  <div className="mb-2 flex items-center gap-2">
                    <label className="text-xs text-neutral-400">Type:</label>
                    <select
                      value={step.type}
                      onChange={(e) => updateStep(step.id, { type: e.target.value, payload: getDefaultPayload(e.target.value) })}
                      className="bg-neutral-800 text-white text-sm rounded px-2 py-1 flex-1"
                    >
                      {TASK_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <input
                    value={step.title}
                    onChange={(e) => updateStep(step.id, { title: e.target.value })}
                    placeholder="Step label"
                    className="mb-2 w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                  />

                  {/* Dynamic payload fields based on task type */}
                  {step.type === 'navigate' && (
                    <div className="space-y-1 mb-2">
                      <input
                        value={(step.payload?.url as string) ?? ''}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), url: e.target.value } })}
                        placeholder="Target URL"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={(step.payload?.clearSessionFirst as boolean) ?? false}
                          onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), clearSessionFirst: e.target.checked } })}
                          className="accent-cyan-600"
                        />
                        Fresh session (clear cookies/storage)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={(step.payload?.handleYouTubeConsent as boolean) ?? true}
                          onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), handleYouTubeConsent: e.target.checked } })}
                          className="accent-emerald-600"
                        />
                        Handle YouTube consent/age gates
                      </label>
                    </div>
                  )}

                  {(step.type === 'extractText' || step.type === 'click' || step.type === 'waitForSelector') && (
                    <input
                      value={(step.payload?.selector as string) ?? ''}
                      onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), selector: e.target.value } })}
                      placeholder="CSS selector"
                      className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                    />
                  )}

                  {step.type === 'fillForm' && (
                    <div className="space-y-1 mb-2">
                      <input
                        value={(step.payload?.selector as string) ?? ''}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), selector: e.target.value } })}
                        placeholder="CSS selector"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <input
                        value={(step.payload?.value as string) ?? ''}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), value: e.target.value } })}
                        placeholder="Value to fill"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                    </div>
                  )}

                  {step.type === 'loopVideo' && (
                    <div className="space-y-1 mb-2">
                      <input
                        value={(step.payload?.selector as string) ?? 'video.html5-main-video, video'}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), selector: e.target.value } })}
                        placeholder="Video selector"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <input
                        value={(step.payload?.url as string) ?? ''}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), url: e.target.value } })}
                        placeholder="URL to reload (optional)"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1 text-xs text-neutral-400 flex-1">
                          Max loops (0=∞):
                          <input
                            type="number"
                            min={0}
                            value={(step.payload?.maxLoops as number) ?? 0}
                            onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), maxLoops: Number(e.target.value) } })}
                            className="w-16 bg-neutral-800 text-white text-sm rounded px-1 py-1 ml-1"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-neutral-400 flex-1">
                          Delay (ms):
                          <input
                            type="number"
                            min={500}
                            value={(step.payload?.loopDelayMs as number) ?? 2000}
                            onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), loopDelayMs: Number(e.target.value) } })}
                            className="w-16 bg-neutral-800 text-white text-sm rounded px-1 py-1 ml-1"
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={(step.payload?.enableHumanBehavior as boolean) ?? true}
                          onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), enableHumanBehavior: e.target.checked } })}
                          className="accent-purple-600"
                        />
                        Human-like behavior
                      </label>
                    </div>
                  )}

                  {step.type === 'watchDuration' && (
                    <div className="space-y-1 mb-2">
                      <input
                        value={(step.payload?.selector as string) ?? 'video.html5-main-video, video'}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), selector: e.target.value } })}
                        placeholder="Video selector"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <input
                        value={(step.payload?.url as string) ?? ''}
                        onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), url: e.target.value } })}
                        placeholder="Target URL (optional)"
                        className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white"
                      />
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1 text-xs text-neutral-400 flex-1">
                          Min (ms):
                          <input
                            type="number"
                            min={1000}
                            value={(step.payload?.minWatchTimeMs as number) ?? 30000}
                            onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), minWatchTimeMs: Number(e.target.value) } })}
                            className="w-16 bg-neutral-800 text-white text-sm rounded px-1 py-1 ml-1"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-neutral-400 flex-1">
                          Max (ms):
                          <input
                            type="number"
                            min={1000}
                            value={(step.payload?.maxWatchTimeMs as number) ?? 60000}
                            onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), maxWatchTimeMs: Number(e.target.value) } })}
                            className="w-16 bg-neutral-800 text-white text-sm rounded px-1 py-1 ml-1"
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={(step.payload?.enableHumanBehavior as boolean) ?? true}
                          onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), enableHumanBehavior: e.target.checked } })}
                          className="accent-purple-600"
                        />
                        Human-like behavior
                      </label>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={(step.payload?.clearSessionFirst as boolean) ?? false}
                          onChange={(e) => updateStep(step.id, { payload: { ...(step.payload ?? {}), clearSessionFirst: e.target.checked } })}
                          className="accent-cyan-600"
                        />
                        Fresh session
                      </label>
                    </div>
                  )}

                  {step.type === 'checkIpLeak' && (
                    <div className="text-xs text-neutral-500">No parameters needed</div>
                  )}

                  {step.type === 'stopLoopVideo' && (
                    <div className="text-xs text-neutral-500">No parameters needed</div>
                  )}
                </div>
              ))}
              <button onClick={addStep} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900">Add Step</button>
            </div>
            <div className="grid gap-2 rounded-lg border border-neutral-800 bg-neutral-950/70 p-2 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} className="accent-purple-600" />
                Enable recurring schedule
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={resumeOnRestart} onChange={(e) => setResumeOnRestart(e.target.checked)} className="accent-cyan-600" />
                Resume on restart
              </label>
              <label className="text-sm text-neutral-300">
                <div className="mb-1 text-xs uppercase tracking-[0.2em] text-neutral-500">Interval (ms)</div>
                <input type="number" min={1000} value={scheduleIntervalMs} onChange={(e) => setScheduleIntervalMs(Number(e.target.value))} className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
              </label>
              <label className="text-sm text-neutral-300">
                <div className="mb-1 text-xs uppercase tracking-[0.2em] text-neutral-500">Retry count</div>
                <input type="number" min={0} value={retryCount} onChange={(e) => setRetryCount(Number(e.target.value))} className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
              </label>
              <label className="text-sm text-neutral-300">
                <div className="mb-1 text-xs uppercase tracking-[0.2em] text-neutral-500">Retry delay (ms)</div>
                <input type="number" min={0} value={retryDelayMs} onChange={(e) => setRetryDelayMs(Number(e.target.value))} className="w-full rounded bg-neutral-800 px-2 py-2 text-sm text-white" />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void saveProfile()} disabled={!canSave} className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">Save Profile</button>
              <button onClick={() => void refreshProfiles()} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900">Refresh</button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Saved Profiles</div>
          {loading ? (
            <div className="mt-3 text-sm text-neutral-500">Loading profiles…</div>
          ) : profiles.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-500">No profiles saved yet.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {profiles.map((profile) => (
                <div key={profile.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{profile.name}</div>
                      <div className="mt-1 text-xs text-neutral-500">{profile.description || 'No description'}</div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{profile.status}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
                    <span>Runs {profile.runCount}</span>
                    <span>Restarts {profile.restartCount}</span>
                    <span>History {profile.history.length}</span>
                    <span>Schedule {profile.scheduleEnabled ? 'On' : 'Off'}</span>
                    <span>Resume {profile.resumeOnRestart ? 'On' : 'Off'}</span>
                  </div>
                  <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/70 p-2 text-xs text-neutral-400">
                    <div className="font-medium text-neutral-200">Latest run timeline</div>
                    {profile.history.length === 0 ? (
                      <div className="mt-1">No runs yet.</div>
                    ) : (
                      <div className="mt-1 space-y-1">
                        {profile.history.slice(-3).reverse().map((run) => (
                          <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-neutral-950/70 px-2 py-1">
                            <span>{run.status}</span>
                            <span>{new Date(run.startedAt).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => void runProfile(profile.id)} disabled={busyId === profile.id} className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">Run</button>
                    <button onClick={() => void restartProfile(profile.id)} disabled={busyId === profile.id} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-40">Restart</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
