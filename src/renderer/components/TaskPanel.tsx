// src/renderer/components/TaskPanel.tsx
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAutomationStore } from '../state/store';
import type { TabTask } from '../../shared/types';

type TaskType =
  | 'navigate'
  | 'extractText'
  | 'fillForm'
  | 'screenshot'
  | 'click'
  | 'waitForSelector'
  | 'loopVideo'
  | 'watchDuration'
  | 'checkIpLeak'
  | 'stopLoopVideo';

interface TaskStep {
  id: string;
  type: TaskType;
  payload: Record<string, unknown>;
  title: string;
}

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'extractText', label: 'Extract Text' },
  { value: 'fillForm', label: 'Fill Form (single field)' },
  { value: 'click', label: 'Click' },
  { value: 'waitForSelector', label: 'Wait For Selector' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'loopVideo', label: 'Loop Video (continuous)' },
  { value: 'watchDuration', label: 'Watch Duration (fixed time)' },
  { value: 'checkIpLeak', label: 'Check IP Leak' },
  { value: 'stopLoopVideo', label: 'Stop Loop Video' },
];

export function TaskPanel() {
  const tabs = useAutomationStore(useShallow((s) => Object.values(s.tabs)));
  const addLog = useAutomationStore((s) => s.addLog);

  const [taskType, setTaskType] = useState<TaskType>('navigate');
  const [targetTabId, setTargetTabId] = useState<string>('__all__');
  const [url, setUrl] = useState('https://example.com');
  const [selector, setSelector] = useState('');
  const [fillValue, setFillValue] = useState('');
  const [minWatchTime, setMinWatchTime] = useState(30_000);
  const [maxWatchTime, setMaxWatchTime] = useState(60_000);
  const [running, setRunning] = useState(false);
  const [runningSequence, setRunningSequence] = useState(false);
  const [autoLoop, setAutoLoop] = useState(true);
  const [screenshots, setScreenshots] = useState<Record<string, string>>({});
  const [sequence, setSequence] = useState<TaskStep[]>([]);

  // New parameters for enhanced tasks
  const [maxLoops, setMaxLoops] = useState(0);
  const [loopDelayMs, setLoopDelayMs] = useState(2000);
  const [enableHumanBehavior, setEnableHumanBehavior] = useState(true);
  const [clearSessionFirst, setClearSessionFirst] = useState(false);
  const [handleYouTubeConsent, setHandleYouTubeConsent] = useState(true);
  const [setVideoQuality, setSetVideoQuality] = useState('1080');
  const [useYouTubeLoopUrl, setUseYouTubeLoopUrl] = useState(true);

  const buildPayload = (type: TaskType): Record<string, unknown> => {
    switch (type) {
      case 'navigate':
        return {
          url,
          waitUntil: 'domcontentloaded',
          clearSessionFirst,
          handleYouTubeConsent,
          setVideoQuality,
        };
      case 'extractText':
        return { selector };
      case 'fillForm':
        return { fields: [{ selector, value: fillValue }] };
      case 'click':
        return { selector };
      case 'waitForSelector':
        return { selector, timeout: 10_000 };
      case 'screenshot':
        return {};
      case 'loopVideo':
        return {
          selector: selector || 'video.html5-main-video, video',
          url,
          maxLoops,
          loopDelayMs,
          enableHumanBehavior,
          setVideoQuality,
          clearSessionFirst,
          useYouTubeLoopUrl,
        };
      case 'watchDuration':
        return {
          minWatchTimeMs: minWatchTime,
          maxWatchTimeMs: maxWatchTime,
          url,
          selector: selector || 'video.html5-main-video, video',
          enableHumanBehavior,
          clearSessionFirst,
          setVideoQuality,
        };
      case 'checkIpLeak':
        return {};
      case 'stopLoopVideo':
        return {};
      default:
        return {};
    }
  };

  const describeTask = (type: TaskType): string => {
    switch (type) {
      case 'navigate':
        return `Navigate to ${url}${clearSessionFirst ? ' (fresh session)' : ''}`;
      case 'extractText':
        return `Extract ${selector}`;
      case 'fillForm':
        return `Fill ${selector}`;
      case 'click':
        return `Click ${selector}`;
      case 'waitForSelector':
        return `Wait for ${selector}`;
      case 'screenshot':
        return 'Capture screenshot';
      case 'loopVideo':
        return `Loop video${maxLoops > 0 ? ` (max ${maxLoops} loops)` : ' (infinite)'}`;
      case 'watchDuration':
        return `Watch ${minWatchTime}–${maxWatchTime} ms${clearSessionFirst ? ' (fresh session)' : ''}`;
      case 'checkIpLeak':
        return 'Check IP leak';
      case 'stopLoopVideo':
        return 'Stop video loop';
      default:
        return type;
    }
  };

  const makeStep = (): TaskStep => ({
    id: crypto.randomUUID(),
    type: taskType,
    payload: buildPayload(taskType),
    title: describeTask(taskType),
  });

  const resolveTargetIds = (): string[] =>
    targetTabId === '__all__' ? tabs.map((t) => t.id) : [targetTabId];

  const runSingleTask = async (tabId: string, type: TaskType) => {
    const task: TabTask = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      payload: buildPayload(type),
    };
    const result = await window.automationApi.runTask(tabId, task);
    handleResult(tabId, type, result);
    return result;
  };

  const runTask = async () => {
    setRunning(true);
    const targetIds = resolveTargetIds();

    try {
      const outcomes = await Promise.allSettled(
        targetIds.map((id) => runSingleTask(id, taskType))
      );

      if (taskType === 'navigate' && autoLoop) {
        const successfulIds = targetIds.filter((_, i) => outcomes[i].status === 'fulfilled');
        await Promise.allSettled(successfulIds.map((id) => runSingleTask(id, 'loopVideo')));
      }
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Task failed: ${err}`);
    } finally {
      setRunning(false);
    }
  };

  const addSequenceStep = () => {
    setSequence((prev) => [...prev, makeStep()]);
    addLog(`[${new Date().toLocaleTimeString()}] Added ${taskType} to sequence.`);
  };

  const removeSequenceStep = (id: string) => {
    setSequence((prev) => prev.filter((step) => step.id !== id));
  };

  const clearSequence = () => setSequence([]);

  const runSequence = async () => {
    if (sequence.length === 0) {
      addLog(`[${new Date().toLocaleTimeString()}] No sequence steps to run.`);
      return;
    }

    setRunningSequence(true);
    const targetIds = resolveTargetIds();

    try {
      await Promise.allSettled(
        targetIds.map(async (tabId) => {
          for (const step of sequence) {
            const task: TabTask = {
              id: `${step.type}-${crypto.randomUUID()}`,
              type: step.type,
              payload: step.payload,
            };
            const result = await window.automationApi.runTask(tabId, task);
            handleResult(tabId, step.type, result);
          }
        })
      );

      addLog(
        `[${new Date().toLocaleTimeString()}] Ran ${sequence.length} step${sequence.length === 1 ? '' : 's'} on ${targetIds.length} tab${targetIds.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      addLog(`[${new Date().toLocaleTimeString()}] Sequence failed: ${err}`);
    } finally {
      setRunningSequence(false);
    }
  };

  const handleResult = (tabId: string, type: TaskType, result: unknown) => {
    if (type === 'screenshot' && typeof result === 'string') {
      setScreenshots((prev) => ({ ...prev, [tabId]: result }));
    }
  };

  return (
    <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Task Builder</div>
          <h2 className="text-base font-semibold text-white">Single tasks and repeatable sequences</h2>
        </div>
        <div className="text-xs text-neutral-500">
          Sequence steps: <span className="text-neutral-200">{sequence.length}</span>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center gap-2 flex-wrap">
        <select
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as TaskType)}
          className="bg-neutral-800 text-white text-sm rounded px-2 py-1"
        >
          {TASK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          value={targetTabId}
          onChange={(e) => setTargetTabId(e.target.value)}
          className="bg-neutral-800 text-white text-sm rounded px-2 py-1"
        >
          <option value="__all__">All tabs ({tabs.length})</option>
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {(taskType === 'navigate' || taskType === 'loopVideo' || taskType === 'watchDuration') && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              taskType === 'loopVideo'
                ? 'URL to reload when video ends'
                : taskType === 'watchDuration'
                  ? 'Optional target URL to open before watching'
                  : 'https://example.com'
            }
            className="bg-neutral-800 text-white text-sm rounded px-2 py-1 flex-1 min-w-45"
          />
        )}

        {(taskType === 'extractText' ||
          taskType === 'click' ||
          taskType === 'waitForSelector' ||
          taskType === 'fillForm' ||
          taskType === 'loopVideo' ||
          taskType === 'watchDuration') && (
          <input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder="CSS selector, e.g. h1"
            className="bg-neutral-800 text-white text-sm rounded px-2 py-1 flex-1 min-w-35"
          />
        )}

        {taskType === 'fillForm' && (
          <input
            value={fillValue}
            onChange={(e) => setFillValue(e.target.value)}
            placeholder="Value to fill"
            className="bg-neutral-800 text-white text-sm rounded px-2 py-1 flex-1 min-w-35"
          />
        )}

        {taskType === 'watchDuration' && (
          <>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              Min watch ms
              <input
                type="number"
                min={1000}
                step={1000}
                value={minWatchTime}
                onChange={(e) => setMinWatchTime(Number(e.target.value))}
                className="w-24 bg-neutral-800 text-white text-sm rounded px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              Max watch ms
              <input
                type="number"
                min={1000}
                step={1000}
                value={maxWatchTime}
                onChange={(e) => setMaxWatchTime(Number(e.target.value))}
                className="w-24 bg-neutral-800 text-white text-sm rounded px-2 py-1"
              />
            </label>
          </>
        )}

        {taskType === 'loopVideo' && (
          <>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              Max loops (0 = infinite)
              <input
                type="number"
                min={0}
                step={1}
                value={maxLoops}
                onChange={(e) => setMaxLoops(Number(e.target.value))}
                className="w-20 bg-neutral-800 text-white text-sm rounded px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              Delay between loops (ms)
              <input
                type="number"
                min={500}
                step={500}
                value={loopDelayMs}
                onChange={(e) => setLoopDelayMs(Number(e.target.value))}
                className="w-24 bg-neutral-800 text-white text-sm rounded px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
              <input
                type="checkbox"
                checked={useYouTubeLoopUrl}
                onChange={(e) => setUseYouTubeLoopUrl(e.target.checked)}
                className="accent-cyan-600"
              />
              YouTube loop URL (prevents recommendations)
            </label>
          </>
        )}

        {(taskType === 'navigate' || taskType === 'loopVideo' || taskType === 'watchDuration') && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
              <input
                type="checkbox"
                checked={enableHumanBehavior}
                onChange={(e) => setEnableHumanBehavior(e.target.checked)}
                className="accent-purple-600"
              />
              Human-like behavior
            </label>
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
              <input
                type="checkbox"
                checked={clearSessionFirst}
                onChange={(e) => setClearSessionFirst(e.target.checked)}
                className="accent-cyan-600"
              />
              Fresh session (clear cookies/storage)
            </label>
          </>
        )}

        {taskType === 'navigate' && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
            <input
              type="checkbox"
              checked={handleYouTubeConsent}
              onChange={(e) => setHandleYouTubeConsent(e.target.checked)}
              className="accent-emerald-600"
            />
            Handle YouTube consent/age gates
          </label>
        )}

        {taskType === 'navigate' && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
            <input
              type="checkbox"
              checked={autoLoop}
              onChange={(e) => setAutoLoop(e.target.checked)}
              className="accent-purple-600"
            />
            Auto-loop video after navigate
          </label>
        )}

        {(taskType === 'navigate' || taskType === 'loopVideo' || taskType === 'watchDuration') && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none">
            <select
              value={setVideoQuality}
              onChange={(e) => setSetVideoQuality(e.target.value)}
              className="bg-neutral-800 text-white text-sm rounded px-2 py-1 w-24 ml-1"
            >
              <option value="auto">Auto</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
              <option value="240">240p</option>
              <option value="144">144p</option>
            </select>
            <span>Video Quality</span>
          </label>
        )}

        <button
          onClick={runTask}
          disabled={running || tabs.length === 0}
          className="px-3 py-1 rounded bg-purple-600 text-white text-sm disabled:opacity-40"
        >
          {running ? 'Running…' : 'Run Task'}
        </button>

        <button
          onClick={addSequenceStep}
          disabled={tabs.length === 0}
          className="px-3 py-1 rounded border border-neutral-700 text-white text-sm hover:bg-neutral-800 disabled:opacity-40"
        >
          Add to Sequence
        </button>

        <button
          onClick={runSequence}
          disabled={runningSequence || sequence.length === 0 || tabs.length === 0}
          className="px-3 py-1 rounded bg-sky-600 text-white text-sm disabled:opacity-40"
        >
          {runningSequence ? 'Running Sequence…' : 'Run Sequence'}
        </button>

        <button
          onClick={clearSequence}
          disabled={sequence.length === 0}
          className="px-3 py-1 rounded bg-neutral-700 text-white text-sm hover:bg-neutral-600 disabled:opacity-40"
        >
          Clear Sequence
        </button>
      </div>

        {sequence.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Queued Steps</div>
            <div className="space-y-2">
              {sequence.map((step, index) => (
                <div
                  key={step.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="text-neutral-200">{index + 1}. {step.title}</div>
                    <div className="text-xs text-neutral-500">{step.type}</div>
                  </div>
                  <button
                    onClick={() => removeSequenceStep(step.id)}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      {Object.keys(screenshots).length > 0 && taskType === 'screenshot' && (
        <div className="flex gap-2 flex-wrap mt-1">
          {Object.entries(screenshots).map(([tabId, base64]) => (
            <div key={tabId} className="flex flex-col items-center">
              <img
                src={`data:image/png;base64,${base64}`}
                alt={`Screenshot of ${tabId}`}
                className="w-32 h-auto rounded border border-neutral-700"
              />
              <span className="text-[10px] text-neutral-500 mt-1 truncate max-w-32">{tabId}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}