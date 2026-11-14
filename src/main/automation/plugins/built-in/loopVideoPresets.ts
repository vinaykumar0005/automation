// src/main/automation/plugins/built-in/loopVideoPresets.ts
//
// Single source of truth for loopVideo defaults.

export interface LoopPayload {
  selector?: string;
  url?: string;
  maxLoops?: number;
  loopDelayMs?: number;
  enableHumanBehavior?: boolean;
  setVideoQuality?: string;
  clearSessionFirst?: boolean;
  useYouTubeLoopUrl?: boolean;
  minWatchDurationMs?: number;
  maxWatchDurationMs?: number;
  watchPercentMin?: number;
  watchPercentMax?: number;
  reloadEveryLoops?: number;
  rotateDeviceProfile?: boolean;
  useWarmup?: boolean;
  useSearchEntry?: boolean;
  searchQuery?: string;
  verifyViews?: boolean;
}

export interface ResolvedLoopPayload {
  selector: string;
  url?: string;
  maxLoops: number;
  loopDelayMs: number;
  enableHumanBehavior: boolean;
  setVideoQuality: string;
  clearSessionFirst: boolean;
  useYouTubeLoopUrl: boolean;
  minWatchDurationMs: number;
  maxWatchDurationMs: number;
  watchPercentMin: number;
  watchPercentMax: number;
  reloadEveryLoops: number;
  rotateDeviceProfile: boolean;
  useWarmup: boolean;
  useSearchEntry: boolean;
  searchQuery: string;
  verifyViews: boolean;
}

export const LOOP_VIDEO_DEFAULTS: Omit<ResolvedLoopPayload, 'selector' | 'url'> = {
  maxLoops: 0,
  loopDelayMs: 2500,
  enableHumanBehavior: true,
  setVideoQuality: '1080',
  clearSessionFirst: false,
  useYouTubeLoopUrl: true,
  minWatchDurationMs: 90_000,
  maxWatchDurationMs: 900_000,
  watchPercentMin: 0.78,
  watchPercentMax: 0.98,
  reloadEveryLoops: 20,
  rotateDeviceProfile: false,
  useWarmup: true,
  useSearchEntry: false,
  searchQuery: '',
  verifyViews: true,
};

/**
 * Merge a caller payload over the defaults, ignoring `undefined` / `null`.
 * A plain spread is not enough: a form sending `"clearSessionFirst": undefined`
 * would overwrite the default and silently re-enable the old behaviour.
 */
export function mergeLoopPayload(
  payload: LoopPayload | undefined,
  selectorFallback: string
): ResolvedLoopPayload {
  const merged: ResolvedLoopPayload = {
    ...LOOP_VIDEO_DEFAULTS,
    selector: selectorFallback,
  };

  if (payload) {
    for (const key of Object.keys(payload) as Array<keyof LoopPayload>) {
      const value = payload[key];
      if (value !== undefined && value !== null) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}