# YouTube Anti-Detection Hardening (Additive) Implementation Plan

> **For agentic workers:** This plan is **executed inline without git** per user instruction. No commits, no diffs, no worktree. Per-task deliverable confirmation is `npm run typecheck:main` (PASS). Use `superpowers:executing-plans` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OFF-by-default `antidetection` hardening layer to the Playwright-based automation app that makes worker sessions harder to flag as automated, without changing any existing behavior when the layer is disabled.

**Architecture:** A new `src/main/automation/antidetection/` main-process module is wired into `TabManager` task dispatch and `ProxyManager` assignment, gated by a single `antidetection` config block merged through the existing `configService`. Workers are Playwright `BrowserContext`/`Page` (not Electron `BrowserView`), so "world init script" = Playwright `addInitScript`, "trusted input" = Playwright `mouse` (already CDP `Input.dispatchMouseEvent`-backed and `isTrusted=true`), and "session partition" = per-tab `BrowserContext` (already isolated by construction). The new layer only adds capabilities that are genuinely absent; it never mutates the existing ON-by-default stealth path.

**Tech Stack:** TypeScript (strict), Electron main process, Playwright (`chromium`), Winston logging, esbuild backend build, `tsc` for type checking. **No test runner exists in this repo** (`package.json` has no `test` script and no jest/vitest/mocha); per-task verification is `npm run typecheck:main` plus, for the single pure unit, an inline `node -e` smoke check. A final `npm run typecheck` (all three projects) gates completion.

## Global Constraints

These apply to every task, copied verbatim from the spec:

- **Additive only.** When `antidetection.enabled === false`, behavior must be byte-for-byte identical to today. Never edit a line that runs on the OFF path in a way that changes its output.
- **Opt-in, per-worker, defaulting to OFF.** Every measure is gated behind the `antidetection` config block; all defaults in `getDefaultConfig()` are OFF / conservative. No new IPC channel, no renderer/store changes (antidetection is main-process config only).
- **No regressions.** `npm run typecheck` (main + preload + renderer) must stay clean. Build stays clean.
- **Single source of truth.** IPC channels stay in `src/shared/ipc-channels.ts` (unchanged by this work); shared types extend `src/shared/types.ts` in place; config types extend `src/main/config/configTypes.ts` in place. No duplicate constants/types.
- **Prefer built-ins.** Use Playwright `page.mouse.*` / `page.locator().click()` / `context.addInitScript` / `context.clearCookies()` / `page.evaluate`. No new npm dependencies.
- **No `any` leaks.** Strict-mode compliant; annotate the Playwright page param as `import('playwright').Page`.
- **Worker UA already clean.** `FINGERPRINT_POOL` already uses real Chrome/Edge/Firefox UAs on automation pages, and `--disable-blink-features=AutomationControlled`/`--exclude-switches=enable-automation` are already set in `launchBrowser()`. The Electron UA exists only on the UI host window (`src/main/index.ts`), which is not an automation surface. The new layer does **not** re-implement these.
- **Sticky proxies already true.** `ProxyManager.assign()` is called exactly once per tab in `TabManager.createTab`; the proxy is baked into the `BrowserContext` options and is never rotated for a live tab. Sticky session is already architecturally satisfied; the new layer documents it and only adds tier-aware ordering.
- **`navigator.webdriver` target.** The existing stealth init script sets it to `undefined` (gated by `stealthMode`, ON by default, untouched). Acceptance Criteria 2 requires `=== false` when the new layer is ON. Real non-automated Chrome reports `false`; the new layer's init script overrides to `false` only when `antidetection.enabled`.

---

## File Structure

### New — `src/main/automation/antidetection/` (keep concerns separate)

| File | Responsibility |
|------|----------------|
| `src/main/automation/antidetection/types.ts` | `ProxyTier` union, `AntiDetectionConfig` interface, `DEFAULT_ANTIDETECTION_CONFIG`, `YOUTUBE_TRACKER_COOKIES` constant, `ResolvedOptions` helper type. Pure types/values — no imports outside this repo. |
| `src/main/automation/antidetection/delays.ts` | Pure delay/jitter math: `poissonDelayMs(meanMs)`, `humanDelay(opts)` returning a `Promise<void>` that sleeps a Poisson sample clamped to `[delayMinMs, delayMaxMs]`, `bezierJitter(maxPx)` offset tuple, `randomInt(min,max)` clamp helper. No Playwright dependency. |
| `src/main/automation/antidetection/trustedInput.ts` | `trustedClick(page, selector, opts)` — move the mouse along a short bezier path with jitter to the target box center, then Playwright `click()` (CDP-backed, `isTrusted=true`). `trustedConsentClick(page, selectors)` — locator-based trusted clicks replacing the synthetic `el.click()` in consent handlers. Imports `delays.ts` + Playwright `Page` type only. |
| `src/main/automation/antidetection/sessionHygiene.ts` | `resetSession(page, opts)` — clears cookies (all, or only YouTube tracker-named cookies when `trackerOnly`), localStorage, sessionStorage, IndexedDB, Caches, ServiceWorkers, in the same individually-wrapped-safe style the existing navigate `clearSessionFirst` block uses (opaque-origin `about:blank` throws otherwise). |
| `src/main/automation/antidetection/index.ts` | Barrel: re-exports the four submodules. Kept free of the `configService` import (no startup-order / circular-import risk, no per-task work) — `TabManager` and `BrowserController` read the already-imported singleton `configService` directly and call the pure `resolveOptions()` helper themselves. |
| `src/main/automation/antidetection/README.md` | Every toggle, its default, its env var, and what each spec section maps to ("already satisfied by …" vs "newly added"). The deliverable doc. |

### Modified — extend existing files in place

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `ProxyTier` type + optional `tier?: ProxyTier` to `ProxyConfig`. Purely additive optional field. |
| `src/main/config/configTypes.ts` | Add `AntiDetectionConfig` import + `antidetection: AntiDetectionConfig` field to `AppConfig`. |
| `src/main/config/configService.ts` | `antidetection: DEFAULT_ANTIDETECTION_CONFIG` in `getDefaultConfig()`; `APP_ANTIDETECTION_*` env merge; `antidetection` spread in `mergeWithConfigFile`; new `getAntiDetectionConfig()` getter. **Not** added to `AppSettings`/`updateAppSettings` (renderer/store flow stays untouched). |
| `src/main/automation/TabManager.ts` | (1) In `createTab`, when `antidetection.enabled`, register a second minimal `addInitScript` (webdriver=false, scrub `cdc_*` glue) AFTER the existing one. (2) In `dispatchTask`, build the execution context so the OFF path is the existing literal exactly unchanged, then conditionally spread `trustedClick`/`trustedConsentClick`/`resetSession`/`humanDelay` and override `simulateHumanInteraction`+`handleYouTubeConsent`+`clearSessionData` with the trusted variants when enabled. |
| `src/main/automation/ProxyManager.ts` | Add optional tier-aware ordering in `assign()` when `antidetection.preferResidential` is ON; untagged proxies keep existing order (so OFF/no-tags ⇒ identical assignment). |

### Unchanged (called out to prove non-regression)

`src/shared/ipc-channels.ts`, `src/preload/index.ts`, `src/main/ipc/handler.ts`, all renderer files, all built-in plugins' source, `src/main/index.ts`. No plugin internals are edited (they consume the context fields they already use; the trusted variants are injected by replacing those context fields).

---

## Task 1: Add `ProxyTier` + extend shared `ProxyConfig`

**Files:**
- Modify: `src/shared/types.ts` (near the `ProxyConfig` interface, lines 26–31, and the `ProxyRotationStrategy` area)

**Interfaces:**
- Produces: `ProxyTier` type and `ProxyConfig['tier']` optional field. Later tasks import `ProxyTier` from `'../../shared/types'` (main) / `'../shared/types'` (preload).

### Steps

- [ ] **Step 1: Add the `ProxyTier` type above `ProxyConfig`**

In `src/shared/types.ts`, insert immediately before the `ProxyConfig` interface (before line 26):

```ts
/**
 * Source category for a proxy, used by the antidetection layer to prefer
 * residential/mobile exit IPs (which YouTube treats like normal users) over
 * datacenter ranges (which are high-risk for bot heuristics).
 *
 * `'unknown'` is the default when no tier is supplied (e.g. proxies.txt does
 * not tag tiers); the ProxyManager leaves untagged proxies in their existing
 * order, so an all-unknown pool behaves identically with the layer OFF or ON.
 */
export type ProxyTier = 'residential' | 'mobile' | 'datacenter' | 'isp' | 'unknown';
```

- [ ] **Step 2: Add the optional `tier` field to `ProxyConfig`**

Change the `ProxyConfig` interface to:

```ts
export interface ProxyConfig {
  label: string;
  server: string;
  username?: string;
  password?: string;
  /** Source category for tier-aware rotation. Optional and additive; omitting it
   *  leaves ProxyManager assignment order identical to today. See `ProxyTier`. */
  tier?: ProxyTier;
}
```

- [ ] **Step 3: Verify typecheck (all three projects — shared types flow into everything)**

Run: `npm run typecheck`
Expected: PASS, no errors. (Adding an optional field to an interface is backward-compatible; every existing `ProxyConfig` literal still compiles.)

- [ ] **Step 4: Task complete (no git)** — typecheck pass in Step 3 confirms deliverable.

---

## Task 2: `antidetection/types.ts` — config interface + defaults

**Files:**
- Create: `src/main/automation/antidetection/types.ts`

**Interfaces:**
- Consumes: `ProxyTier` from `'../../shared/types'` (produced by Task 1).
- Produces: `AntiDetectionConfig`, `DEFAULT_ANTIDETECTION_CONFIG`, `YOUTUBE_TRACKER_COOKIES`, `ResolvedOptions`.

### Steps

- [ ] **Step 1: Create the types file**

```ts
// src/main/automation/antidetection/types.ts
import type { ProxyTier } from '../../../shared/types';

/**
 * The `antidetection` config block. All measures are OFF by default and every
 * measure is additive — when `enabled` is false the app behaves byte-for-byte
 * identically to today. See `docs/superpowers/plans/2026-08-15-youtube-antidetection-hardening.md`
 * and `src/main/automation/antidetection/README.md`.
 */
export interface AntiDetectionConfig {
  /** Master switch for the whole layer. Default false. */
  enabled: boolean;

  /** Input simulation — trusted CDP-backed clicks with bezier cursor jitter
   *  and Poisson inter-action delays. Also replaces synthetic `el.click()` calls
   *  in the consent handlers with trusted locator clicks. Default false. */
  trustedInput: boolean;

  /** Poisson distribution mean (ms) for inter-action delays. Default 250.
   *  Sampled with Knuth's algorithm and clamped to [delayMinMs, delayMaxMs]. */
  poissonMeanMs: number;
  /** Min inter-action delay (ms). Default 90. */
  delayMinMs: number;
  /** Max inter-action delay (ms). Default 900. */
  delayMaxMs: number;
  /** Max cursor offset jitter (px) around the click target center. Default 6. */
  jitterPx: number;
  /** Mouse-move interpolation steps along the bezier path. Default 12. */
  bezierSteps: number;

  /** Proxy hygiene — order the healthy pool to prefer residential/mobile over
   *  datacenter. Only reorders proxies that carry a `tier` tag; an all-unknown
   *  pool is left in existing order (identical to OFF). Default false.
   *  DATACENTER proxies are treated as high-risk: see README. */
  preferResidential: boolean;

  /** Session lifecycle — expose a `resetSession` context method that clears
   *  cookies/localStorage/sessionStorage/IndexedDB/Cache/ServiceWorkers at task
   *  boundaries. Default false. */
  resetSession: boolean;
  /** When resetSession runs, also clear YouTube tracker cookies (YSC,
   *  VISITOR_INFO1_LIVE) for a fresh-identity start. Default false.
   *  Independently useful even when resetSession is off: the consent/navigate
   *  clear path can target these by name instead of nuking all cookies. */
  clearYouTubeTrackerCookies: boolean;
}

/** Off-by-default / conservative settings. Never changes existing behavior. */
export const DEFAULT_ANTIDETECTION_CONFIG: AntiDetectionConfig = {
  enabled: false,
  trustedInput: false,
  poissonMeanMs: 250,
  delayMinMs: 90,
  delayMaxMs: 900,
  jitterPx: 6,
  bezierSteps: 12,
  preferResidential: false,
  resetSession: false,
  clearYouTubeTrackerCookies: false,
};

/** YouTube identity/tracker cookies cleared for a fresh-identity start.
 *  `YSC` is the session tracker; `VISITOR_INFO1_LIVE` is the long-lived A/B
 *  identity cookie YouTube uses to select experimental features. Clearing both
 *  yields a fresh per-session identity WITHOUT bypassing any login or challenge
 *  (out of scope — never implemented here). */
export const YOUTUBE_TRACKER_COOKIES: readonly string[] = ['YSC', 'VISITOR_INFO1_LIVE'];

/** Frozen snapshot of the resolved antidetection options handed to
 *  TabManager/ProxyManager at worker boundaries. `enabled:false` ⇒ all
 *  booleans are false and consumers must take the existing path untouched. */
export interface ResolvedOptions {
  readonly enabled: boolean;
  readonly trustedInput: boolean;
  readonly poissonMeanMs: number;
  readonly delayMinMs: number;
  readonly delayMaxMs: number;
  readonly jitterPx: number;
  readonly bezierSteps: number;
  readonly preferResidential: boolean;
  readonly resetSession: boolean;
  readonly clearYouTubeTrackerCookies: boolean;
}

/** Coerce a partial/incoming config to a complete ResolvedOptions, filling
 *  missing fields with defaults and clamping numerics to sane ranges. Pure. */
export function resolveOptions(cfg: Partial<AntiDetectionConfig> | undefined): ResolvedOptions {
  const base = { ...DEFAULT_ANTIDETECTION_CONFIG, ...(cfg ?? {}) };
  const clampInt = (n: number, lo: number, hi: number) =>
    Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : lo;
  return {
    enabled: !!base.enabled,
    trustedInput: !!base.trustedInput,
    poissonMeanMs: clampInt(base.poissonMeanMs, 1, 60_000),
    delayMinMs: clampInt(base.delayMinMs, 0, 60_000),
    delayMaxMs: clampInt(base.delayMaxMs, base.delayMinMs, 60_000),
    jitterPx: clampInt(base.jitterPx, 0, 100),
    bezierSteps: clampInt(base.bezierSteps, 1, 200),
    preferResidential: !!base.preferResidential,
    resetSession: !!base.resetSession,
    clearYouTubeTrackerCookies: !!base.clearYouTubeTrackerCookies,
  };
}
```

- [ ] **Step 2: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS. (File is standalone; nothing imports it yet.)

- [ ] **Step 3: Task complete (no git)** — typecheck pass in Step 2 confirms deliverable.

---

## Task 3: `antidetection/delays.ts` — Poisson delays + jitter (pure)

**Files:**
- Create: `src/main/automation/antidetection/delays.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces: `randomInt`, `poissonDelayMs`, `humanDelay`, `bezierJitter`. Later tasks import these.

### Steps

- [ ] **Step 1: Create the pure delays module**

```ts
// src/main/automation/antidetection/delays.ts

/** Inclusive random integer in [min, max]. Returns min if max < min. */
export function randomInt(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return min;
  const lo = Math.trunc(min);
  const hi = Math.trunc(max);
  if (hi < lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Knuth's algorithm Poisson(λ) sampler. Returns a non-negative integer.
 *  For the means this layer uses (≈250ms) L, and therefore the loop count,
 *  stays small; a hard cap of 10_000 iterations guards against pathological λ. */
export function poissonSample(lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L && k < 10_000) {
    k += 1;
    p *= Math.random();
  }
  return k;
}

/** Poisson-distributed delay sample in ms, clamped to [minMs, maxMs]. Pure. */
export function poissonDelayMs(meanMs: number, minMs: number, maxMs: number): number {
  const sample = poissonSample(meanMs);
  return Math.max(minMs, Math.min(maxMs, sample));
}

/** Sleep a Poisson sample clamped to [minMs, maxMs]. Resolves after the delay. */
export function humanDelay(
  meanMs: number,
  minMs: number,
  maxMs: number
): Promise<void> {
  const ms = poissonDelayMs(meanMs, minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quadratic-bezier offset, evaluated at t in [0,1] given start (s) and two
 *  control points (c1, c2). Pure. */
function bezier1d(t: number, s: number, c1: number, c2: number, e: number): number {
  const u = 1 - t;
  return u * u * u * s + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * e;
}

/** Produces `steps+1` points along a quadratic bezier from `start` to `end`,
 *  with a single randomized control point pulled up to `maxPx` perpendicular
 *  jitter — the "slight cursor movement variance" the spec asks for. Each
 *  returned point has a small per-step additive noise too. Pure (deterministic
 *  given Math.random rolls). */
export function bezierPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  steps: number,
  maxPx: number
): Array<{ x: number; y: number }> {
  const n = Math.max(1, Math.trunc(steps));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // perpendicular unit vector
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const mid = 0.5;
  const jitter = (Math.random() * 2 - 1) * maxPx;
  const cx = bezier1d(mid, start.x, (start.x + end.x) / 2 + px * jitter, (start.x + end.x) / 2, end.x);
  const cy = bezier1d(mid, start.y, (start.y + end.y) / 2 + py * jitter, (start.y + end.y) / 2, end.y);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const bx = bezier1d(t, start.x, cx, cx, end.x);
    const by = bezier1d(t, start.y, cy, cy, end.y);
    points.push({
      x: bx + (Math.random() * 2 - 1) * maxPx * 0.15,
      y: by + (Math.random() * 2 - 1) * maxPx * 0.15,
    });
  }
  // Pin the last point exactly on the target; never overshoot it.
  points[points.length - 1] = { x: end.x, y: end.y };
  return points;
}

/** Small random offset (px) in [−maxPx, maxPx] for both axes. Pure. */
export function bezierJitter(maxPx: number): { x: number; y: number } {
  if (!Number.isFinite(maxPx) || maxPx <= 0) return { x: 0, y: 0 };
  const r = () => (Math.random() * 2 - 1) * maxPx;
  return { x: r(), y: r() };
}
```

- [ ] **Step 2: Inline sanity check the pure math (this repo has no test runner)**

Run:
```bash
node -e "import('./src/main/automation/antidetection/delays.ts').catch(()=>null)" 2>/dev/null; node --input-type=module -e "
const L=Math.exp(-250); let k=0,p=1; while(p>L&&k<10000){k++;p*=Math.random();} console.log('poisson(250) sample:',k);
"
```
Expected: prints a non-negative integer sample (varying run to run). The first subcommand may error on `.ts` import under raw node — that is expected; the second proves the Poisson sampler math is sound. (No assertion framework exists; this is a documented manual check.)

- [ ] **Step 3: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS.

- [ ] **Step 4: Task complete (no git)** — typecheck pass in Step 3 confirms deliverable.

---

## Task 4: `antidetection/trustedInput.ts` — trusted clicks

**Files:**
- Create: `src/main/automation/antidetection/trustedInput.ts`

**Interfaces:**
- Consumes: `bezierPath`, `bezierJitter`, `humanDelay`, `randomInt` from `./delays`; `import('playwright').Page` type.
- Produces: `trustedClick(page, selector, opts)`, `trustedConsentClick(page, selectors, opts)`. Consumed by `TabManager.dispatchTask` via the execution context when `antidetection.trustedInput` is ON.

### Steps

- [ ] **Step 1: Create the trusted input module**

```ts
// src/main/automation/antidetection/trustedInput.ts
import type { Page } from 'playwright';
import { bezierPath, bezierJitter, humanDelay, randomInt } from './delays';

export interface TrustedClickOptions {
  poissonMeanMs: number;
  delayMinMs: number;
  delayMaxMs: number;
  jitterPx: number;
  bezierSteps: number;
}

/**
 * Move the mouse along a short bezier path (with jitter) to the target's
 * bounding-box center, then issue a Playwright locator click. Playwright's
 * `click()` dispatches via CDP `Input.dispatchMouseEvent`, so the resulting
 * DOM event has `isTrusted === true` — unlike `.click()` called inside
 * `page.evaluate(...)`, which yields `isTrusted === false`.
 *
 * On any failure (element gone, frame detached, page closed) this resolves
 * without throwing, mirroring the best-effort contract of the existing consent
 * handlers so a transient miss never aborts a navigation.
 */
export async function trustedClick(
  page: Page,
  selector: string,
  opts: TrustedClickOptions
): Promise<boolean> {
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
    const box = await locator.boundingBox();
    if (!box) return false;
    const jx = bezierJitter(opts.jitterPx);
    const endX = box.x + box.width / 2 + jx.x;
    const endY = box.y + box.height / 2 + jx.y;
    // Start the cursor somewhere off the element, like a real user would.
    const start = {
      x: Math.max(0, endX - randomInt(120, 260) + jx.x),
      y: Math.max(0, endY + randomInt(40, 120)),
    };
    const path = bezierPath(start, { x: endX, y: endY }, opts.bezierSteps, opts.jitterPx);
    for (const pt of path) {
      await page.mouse.move(pt.x, pt.y, { steps: 1 });
    }
    await humanDelay(opts.poissonMeanMs, opts.delayMinMs, opts.delayMaxMs);
    await locator.click({ timeout: 2000 });
    await humanDelay(opts.poissonMeanMs, opts.delayMinMs, opts.delayMaxMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort trusted clicks over a list of selector candidates, used in place
 * of the synthetic `el.click()` loop inside the consent handler's
 * `page.evaluate(...)`. Returns the number of elements actually clicked
 * (trusted). Never throws.
 */
export async function trustedConsentClick(
  page: Page,
  selectors: string[],
  opts: TrustedClickOptions
): Promise<number> {
  let clicked = 0;
  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count().catch(() => 0);
      if (count === 0) continue;
      const ok = await trustedClick(page, selector, opts);
      if (ok) clicked += count;
    } catch {
      // keep trying the next selector; consent UIs are flaky
    }
  }
  return clicked;
}
```

- [ ] **Step 2: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS. (Playwright is an existing dependency; `import('playwright').Page` resolves under `src/main/tsconfig.json`.)

- [ ] **Step 3: Task complete (no git)** — typecheck pass in Step 2 confirms deliverable.

---

## Task 5: `antidetection/sessionHygiene.ts` — resetSession

**Files:**
- Create: `src/main/automation/antidetection/sessionHygiene.ts`

**Interfaces:**
- Consumes: `import('playwright').Page`; `YOUTUBE_TRACKER_COOKIES` + `ResolvedOptions` from `./types`.
- Produces: `resetSession(page, opts)`. Consumed by `TabManager.dispatchTask` and exposed as the `resetSession` context field when `antidetection.resetSession` is ON.

### Steps

- [ ] **Step 1: Create the session hygiene module**

```ts
// src/main/automation/antidetection/sessionHygiene.ts
import type { Page } from 'playwright';
import { YOUTUBE_TRACKER_COOKIES } from './types';

export interface ResetSessionOptions {
  /** When true, only clear the YouTube tracker cookies (YSC, VISITOR_INFO1_LIVE)
   *  by name instead of nuking every cookie. Storage is still fully cleared. */
  trackerOnly?: boolean;
}

/**
 * Per-worker fresh-identity reset. Clears, in order: YouTube tracker cookies
 * (or all cookies), localStorage, sessionStorage, IndexedDB databases, Cache
 * Storage, and ServiceWorker registrations.
 *
 * Each storage primitive is individually wrapped in try/catch — an opaque-origin
 * document (e.g. the initial `about:blank`) throws `SecurityError` on
 * `localStorage`/`IndexedDB` access and must not abort the rest of the routine.
 * This mirrors the individually-safe pattern already used by the navigate
 * task's `clearSessionFirst` block, so the behavior contract is identical.
 *
 * Never throws. NOT a challenge/captcha bypass — it only discards tracker
 * state for a fresh per-session identity.
 */
export async function resetSession(
  page: Page,
  opts: ResetSessionOptions = {}
): Promise<void> {
  // --- Cookies ---
  try {
    if (opts.trackerOnly) {
      const cookies = await page.context().cookies();
      const target = cookies.filter((c) =>
        YOUTUBE_TRACKER_COOKIES.includes(c.name)
      );
      if (target.length > 0) {
        // clearCookiesByName is not a Playwright API; delete by building the
        // inverse set. We clear-all then restore the keep-set, which is safe
        // because no other task is mutating this context concurrently (the
        // per-tab TaskQueue serializes work for this worker).
        const keep = cookies.filter((c) => !YOUTUBE_TRACKER_COOKIES.includes(c.name));
        await page.context().clearCookies();
        if (keep.length > 0) {
          await page.context().addCookies(keep);
        }
      }
    } else {
      await page.context().clearCookies();
    }
  } catch {
    // context may be closing; non-fatal
  }

  // --- Storage + workers (page-side, wrapped individually) ---
  await page
    .evaluate(() => {
      const safe = (fn: () => void) => {
        try {
          fn();
        } catch {
          /* SecurityError on opaque origins — expected, ignore */
        }
      };
      safe(() => localStorage.clear());
      safe(() => sessionStorage.clear());
      if ('indexedDB' in window) {
        indexedDB
          .databases()
          .then((dbs) =>
            dbs.forEach((db) => {
              if (db.name) safe(() => indexedDB.deleteDatabase(db.name));
            })
          )
          .catch(() => {});
      }
      const cacheStorage: any = (navigator as any).caches;
      if (cacheStorage) {
        cacheStorage
          .keys()
          .then((names: string[]) =>
            Promise.all(names.map((name: string) => cacheStorage.delete(name)))
          )
          .catch(() => {});
      }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((reg) => reg.unregister().catch(() => {})))
          .catch(() => {});
      }
    })
    .catch(() => {
      // page may have navigated/closed mid-evaluate; non-fatal
    });
}
```

- [ ] **Step 2: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS. (The `cacheStorage: any` + `(navigator as any)` casts are page-side, not main-process leaks — Playwright's `evaluate` callback runs in the browser world, which the main tsconfig models as untyped DOM globals; this matches the existing navigate-task pattern at `navigateTask.ts:78`.)

- [ ] **Step 3: Task complete (no git)** — typecheck pass in Step 2 confirms deliverable.

---

## Task 6: `antidetection/index.ts` — barrel

**Files:**
- Create: `src/main/automation/antidetection/index.ts`

**Interfaces:**
- Consumes: nothing (pure re-exports of the four submodules created in Tasks 2–5).
- Produces: a single entry point so `TabManager`/`BrowserController` can write `import { ..., resolveOptions, type ResolvedOptions } from './antidetection';`.

### Steps

- [ ] **Step 1: Create the barrel**

```ts
// src/main/automation/antidetection/index.ts
export * from './types';
export * from './delays';
export * from './trustedInput';
export * from './sessionHygiene';
```

The barrel imports **only** its siblings — never the `configService`. This keeps it side-effect-free and free of any startup-order / circular-import risk. Consumers that need config read the already-imported singleton `configService` directly (they already import it) and call the pure `resolveOptions()` helper from `./types` to validate + clamp.

- [ ] **Step 2: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS. All four submodules exist from earlier tasks; nothing referenced is missing.

- [ ] **Step 3: Task complete (no git)** — typecheck pass in Step 2 confirms deliverable.

---

## Task 7: `configService` + `configTypes` — antidetection block

**Files:**
- Modify: `src/main/config/configTypes.ts` (extend `AppConfig`)
- Modify: `src/main/config/configService.ts` (defaults, env merge, file merge, getter, persist)

**Interfaces:**
- Consumes: `AntiDetectionConfig`, `DEFAULT_ANTIDETECTION_CONFIG` from `'../automation/antidetection/types'`.
- Produces: `AppConfig['antidetection']` and `ConfigService.getAntiDetectionConfig(): AntiDetectionConfig` (makes Task 6 green).

### Steps

- [ ] **Step 1: Add `antidetection` to `AppConfig` in `configTypes.ts`**

In `src/main/config/configTypes.ts`, add an import at the top:

```ts
import type { AntiDetectionConfig } from '../automation/antidetection/types';
```

Then extend the `AppConfig` interface (replace the existing `AppConfig` interface at the bottom of the file):

```ts
export interface AppConfig {
  browser: BrowserConfig;
  proxy: {
    enabled: boolean;
    strategy: ProxyRotationStrategy;
    rotationIntervalMs: number;
    list: ProxyConfig[];
  };
  logging: LoggingConfig;
  security: SecurityConfig;
  automation: AutomationConfig;
  /** YouTube/automation anti-detection hardening layer. All measures OFF by
   *  default; the app is behaviorally identical to pre-antidetection builds
   *  while `enabled` is false. See AntiDetectionConfig for per-toggle docs. */
  antidetection: AntiDetectionConfig;
}
```

- [ ] **Step 2: Add the default block to `getDefaultConfig()` in `configService.ts`**

At the top of `src/main/config/configService.ts`, extend the import:

```ts
import { AppConfig, AppSettings, BrowserConfig, LoggingConfig, ProxyConfig, SecurityConfig, AutomationConfig } from './configTypes';
import type { ProxyRotationStrategy } from '../../shared/types';
import { DEFAULT_ANTIDETECTION_CONFIG } from '../automation/antidetection/types';
```

In `getDefaultConfig()`, add the block as the last property of the returned object (right after `automation: { ... }`):

```ts
      antidetection: { ...DEFAULT_ANTIDETECTION_CONFIG },
```

(Spread-copy so the shared default object is never mutated.)

- [ ] **Step 3: Add env-merge handling in `mergeWithEnvironment()`**

At the end of the `Automation` block in `mergeWithEnvironment` (right after the `if (getEnv('AUTOMATION_ENABLEPLUGINS')) { ... }` line, before `return config;`), insert:

```ts
    // Antidetection (APP_ANTIDETECTION_*). All defaults OFF; env only flips
    // values that are explicitly set, so an unset env var never changes the
    // default — identical to the pre-antidetection runtime path.
    if (getEnv('ANTIDETECTION_ENABLED') !== undefined) {
      config.antidetection.enabled = getEnv('ANTIDETECTION_ENABLED') === 'true';
    }
    if (getEnv('ANTIDETECTION_TRUSTEDINPUT') !== undefined) {
      config.antidetection.trustedInput = getEnv('ANTIDETECTION_TRUSTEDINPUT') === 'true';
    }
    if (getEnv('ANTIDETECTION_POISSONMEANMS')) {
      config.antidetection.poissonMeanMs = parseInt(getEnv('ANTIDETECTION_POISSONMEANMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_DELAYMINMS')) {
      config.antidetection.delayMinMs = parseInt(getEnv('ANTIDETECTION_DELAYMINMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_DELAYMAXMS')) {
      config.antidetection.delayMaxMs = parseInt(getEnv('ANTIDETECTION_DELAYMAXMS')!, 10);
    }
    if (getEnv('ANTIDETECTION_JITTERPX')) {
      config.antidetection.jitterPx = parseInt(getEnv('ANTIDETECTION_JITTERPX')!, 10);
    }
    if (getEnv('ANTIDETECTION_BEZIERSTEPS')) {
      config.antidetection.bezierSteps = parseInt(getEnv('ANTIDETECTION_BEZIERSTEPS')!, 10);
    }
    if (getEnv('ANTIDETECTION_PREFERRESIDENTIAL') !== undefined) {
      config.antidetection.preferResidential = getEnv('ANTIDETECTION_PREFERRESIDENTIAL') === 'true';
    }
    if (getEnv('ANTIDETECTION_RESETSESSION') !== undefined) {
      config.antidetection.resetSession = getEnv('ANTIDETECTION_RESETSESSION') === 'true';
    }
    if (getEnv('ANTIDETECTION_CLEARTRACKERCOOKIES') !== undefined) {
      config.antidetection.clearYouTubeTrackerCookies = getEnv('ANTIDETECTION_CLEARTRACKERCOOKIES') === 'true';
    }
```

- [ ] **Step 4: Add file-merge spread in `mergeWithConfigFile()`**

In the returned object of `mergeWithConfigFile`, add an `antidetection` line (after the `automation: { ... }` line):

```ts
          automation: { ...config.automation, ...(fileConfig.automation || {}) },
          antidetection: { ...config.antidetection, ...(fileConfig.antidetection || {}) },
```

This shallow-merges the block, so a `config.json` that sets only `{ "antidetection": { "enabled": true } }` keeps every other default. (Matches the existing shallow-merge style used for the other sections.)

- [ ] **Step 5: Add the getter**

In `ConfigService`, alongside the other `get*Config()` methods, add:

```ts
  getAntiDetectionConfig(): AntiDetectionConfig {
    return { ...this.config.antidetection };
  }
```

`AntiDetectionConfig` is already in scope via the Task-1-of-this-pair import added in Step 2 of this task; confirm by adding it to the configTypes import line if not already present:

```ts
import { AppConfig, AppSettings, BrowserConfig, LoggingConfig, ProxyConfig, SecurityConfig, AutomationConfig, AntiDetectionConfig } from './configTypes';
```

(If you added only `DEFAULT_ANTIDETECTION_CONFIG` from the types path in Step 2, also import the interface type from `./configTypes` here as shown, OR change the return type annotation to `import('../automation/antidetection/types').AntiDetectionConfig`. Either is acceptable; use the configTypes import for consistency with sibling getters.)

- [ ] **Step 6: Include `antidetection` in `persistConfiguration()`**

In `persistConfiguration()`'s `serializableConfig` object, add the field (after `automation: ...`):

```ts
      automation: this.config.automation,
      antidetection: this.config.antidetection,
```

- [ ] **Step 7: Verify typecheck (main) — this makes Task 6 green too**

Run: `npm run typecheck:main`
Expected: PASS. `getAntiDetectionConfig()` now exists, so the Task 6 barrel compiles.

- [ ] **Step 8: Task complete (no git)** — config updates applied, no commit needed.

---

## Task 8: `ProxyManager` — tier-aware ordering (additive)

**Files:**
- Modify: `src/main/automation/ProxyManager.ts` (`assign()` method, lines ~317–349; add a helper)

**Interfaces:**
- Consumes: `ProxyTier` from `'./types'` (re-exported from shared); a `ResolvedOptions`-shaped boolean (`preferResidential`) passed in via a setter rather than a hard import of the configService (keeps ProxyManager testable and decoupled — it should not know about antidetection internals).
- Produces: an optional `setTierPreference(prefs: { preferResidential: boolean })` setter on `ProxyManager`, called by `BrowserController`/`TabManager` at init when the layer is ON. When never called, `assign()` is byte-for-byte identical to today.

### Steps

- [ ] **Step 1: Add a tier-preference field + setter to `ProxyManager`**

Near the other private fields (after `private lastRejected`), add:

```ts
  // Antidetection: when true, the healthy pool is reordered to prefer
  // residential/mobile over datacenter. Untagged ('unknown') proxies keep
  // their existing relative order, so an all-unknown pool assigns identically
  // to the pre-antidetection behavior. Lazily set by the controller; defaults
  // to false so ProxyManager standalone stays behaviorally identical.
  private preferResidentialTier = false;
```

Add a public setter (after `setProxies`):

```ts
  /** Antidetection hook (additive). When pref.preferResidential is true,
   *  assign() reorders the healthy pool to prefer residential/mobile exits.
   *  Never calling this leaves assignment identical to today. */
  setTierPreference(pref: { preferResidential: boolean }): void {
    this.preferResidentialTier = !!pref.preferResidential;
  }
```

- [ ] **Step 2: Add a tier-rank helper and use it in `assign()`**

Add a private helper near `getHealthyProxies`:

```ts
  /** Lower rank = preferred. 'unknown' ranks last so an all-unknown pool keeps
   *  stable relative order (sorted-last is a no-op for selection ordering). */
  private static tierRank(tier: import('./types').ProxyTier | undefined): number {
    switch (tier) {
      case 'residential': return 0;
      case 'mobile': return 1;
      case 'isp': return 2;
      case 'datacenter': return 3;
      case 'unknown':
      default: return 4;
    }
  }

  /** Reorder the healthy pool to prefer residential/mobile when the
   *  tier-preference flag is set; otherwise return the list unchanged. */
  private orderByTier(healthy: ProxyConfig[]): ProxyConfig[] {
    if (!this.preferResidentialTier) return healthy;
    // Stable sort preserves the cursor's round-robin fairness within a tier.
    return [...healthy].sort(
      (a, b) => ProxyManager.tierRank(a.tier) - ProxyManager.tierRank(b.tier)
    );
  }
```

> The `import('./types').ProxyTier` inline type keeps `ProxyManager.ts` from gaining a hard top-of-file import it didn't have before; `./types` already re-exports shared types, so this resolves. `ProxyConfig` here is the one imported at the top of `ProxyManager.ts` from `'./types'`, which already carries the optional `tier` field from Task 1.

Change the first two lines of `assign()`:

```ts
  assign(tabId: string): ProxyConfig | undefined {
    const baseHealthy = this.getHealthyProxies();
    if (baseHealthy.length === 0) return undefined;
    const healthyProxies = this.orderByTier(baseHealthy);
```

The rest of `assign()` (`switch (this.strategy) { ... }`) is **unchanged** — it now indexes into `healthyProxies`, which is `baseHealthy` verbatim when the preference is off (the `orderByTier` no-op), so the OFF path selects the identical proxy by index. Verify this reasoning: when `preferResidentialTier === false`, `orderByTier` returns the same array reference; the `cursor % healthyProxies.length` and `Math.floor(Math.random()*healthyProxies.length)` expressions therefore produce identical picks to today.

- [ ] **Step 3: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS.

- [ ] **Step 4: Task complete (no git)** — proxy ordering logic added, no commit needed.

---

## Task 9: `TabManager` — register minimal antidetection init script in `createTab`

**Files:**
- Modify: `src/main/automation/TabManager.ts` (in `createTab`, after the existing `addInitScript` call at line ~567–869, and after `const page = await context.newPage();` at line ~871)

**Interfaces:**
- Consumes: the `antidetection` config read via the configService (already imported in TabManager as `configService`). To avoid an async resolver inside the hot `createTab` path, capture the resolved boolean once in the constructor (like `stealthMode` is captured at line ~365).

### Steps

- [ ] **Step 1: Add the antidetection import + field + constructor capture**

At the top of `src/main/automation/TabManager.ts`, after the existing `videoQuality` import (around line 10), add the single consolidated antidetection import that Task 10 will also use:

```ts
import {
  resolveOptions,
  trustedClick,
  trustedConsentClick,
  resetSession,
  humanDelay,
  bezierPath,
  randomInt,
  type ResolvedOptions,
} from './antidetection';
```

Add the field near `private readonly stealthMode: boolean;`:

```ts
  // Resolved antidetection options, captured ONCE at construction so the hot
  // createTab / dispatchTask paths stay fully synchronous — no per-task import,
  // no per-task await. Off by default (every flag false), which is why the OFF
  // runtime path is byte-identical to today: the gated branches simply don't run.
  private readonly antidetection: ResolvedOptions;
```

In the constructor, after `this.stealthMode = browserConfig.stealthMode ?? true;`, add:

```ts
    this.antidetection = resolveOptions(configService.getAntiDetectionConfig());
```

(`configService` is already imported in `TabManager.ts`; `getAntiDetectionConfig()` is added in Task 7 and is synchronous. Resolving once — not per task — is what keeps the OFF path free of per-dispatch overhead.)

- [ ] **Step 2: Register the minimal antidetection init script when enabled**

Immediately after the existing `await context.addInitScript((fp) => { ... }, fingerprint);` block closes (after line ~869, the `}, fingerprint);` line) and before `const page = await context.newPage();`, insert:

```ts
    // Antidetection layer: a SECOND, minimal init script registered AFTER the
    // existing one. addInitScript runs scripts in registration order, so this
    // overrides only the few properties the spec calls out:
    //   - navigator.webdriver === false  (real non-automated Chrome reports
    //     `false`; the existing script sets `undefined`). Acceptance Criteria 2.
    //   - scrub ChromeDriver cdc_* glue objects off window/document.
    // Worker UA, plugins, and languages are already aligned by the existing
    // script, so this one stays minimal and localized. Only runs when enabled.
    if (this.antidetection.enabled) {
      await context.addInitScript(() => {
        try {
          if ('navigator' in globalThis) {
            Object.defineProperty(globalThis.navigator, 'webdriver', {
              get: () => false,
              configurable: true,
            });
          }
        } catch {
          /* property may be non-configurable on some builds; ignore */
        }
        try {
          const w = globalThis as unknown as Record<string, unknown>;
          for (const key of Object.keys(w)) {
            if (key.startsWith('cdc_') && typeof w[key] !== 'function') {
              try { delete w[key]; } catch { /* not deletable */ }
            }
          }
        } catch {
          /* enumeration is best-effort */
        }
      });
    }
```

- [ ] **Step 3: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS.

- [ ] **Step 4: Task complete (no git)** — typecheck pass in Step 3 confirms deliverable.

---

## Task 10: `TabManager.dispatchTask` — wire trusted input + resetSession into the execution context

**Files:**
- Modify: `src/main/automation/TabManager.ts` (`dispatchTask`, lines ~944–1089; specifically the `executionContext` object literal and the leading `randomDelay(100, 500)`)

**Interfaces:**
- Consumes: the constructor-resolved `this.antidetection: ResolvedOptions` (captured in Task 9 Step 1) and the barrel import from Task 9 Step 1 — `trustedClick`/`trustedConsentClick` from `./antidetection/trustedInput`, `resetSession` from `./antidetection/sessionHygiene`, `humanDelay`/`bezierPath`/`randomInt` from `./antidetection/delays`.
- Produces: an execution context that, when the layer is OFF, is the **same literal object** as today (so plugins see no change), and when ON, spreads in the trusted variants. The built-in plugins (navigate/click) consume `ctx.simulateHumanInteraction`, `ctx.handleYouTubeConsent`, `ctx.clearSessionData` — overriding those keys means the plugins automatically get trusted behavior with NO plugin edits.

### Steps

- [ ] **Step 1: Gate the leading inter-action delay**

The consolidated antidetection import was already added in Task 9 Step 1 (no additional import here).

Replace the existing line `await randomDelay(100, 500);` (line ~946) with:

```ts
    // Antidetection: Poisson inter-action delay when enabled && trustedInput;
    // otherwise the existing uniform randomDelay — byte-identical to today on
    // the OFF path. `ad` is the constructor-resolved options (a synchronous field
    // read), so there is no per-task import or await here either.
    const ad = this.antidetection;
    if (ad.enabled && ad.trustedInput) {
      await humanDelay(ad.poissonMeanMs, ad.delayMinMs, ad.delayMaxMs);
    } else {
      await randomDelay(100, 500);
    }
```

> The OFF branch (`else`) calls exactly the original `randomDelay(100, 500)`. Because `ad` is a synchronous field read (not a per-task `await import(...)`), the default runtime path keeps byte-identical timing and overhead compared to today.

- [ ] **Step 2: Build the base context unchanged, then conditionally overlay**

`ad` is already bound at the top of `dispatchTask` (Task 10 Step 1). Locate the existing `const executionContext: TaskExecutionContext = { ... };` object literal. Wrap it so the OFF path returns the exact same object. Concretely:

Replace:
```ts
    const executionContext: TaskExecutionContext = {
      isTabValid: () => !tab.closed && this.tabs.has(tab.state.id),
      emitEvent: (kind: 'status' | 'log' | 'result' | 'error', data: unknown) => { ... },
      randomDelay,
      simulateHumanInteraction: async (page: any) => { ... },
      handleYouTubeConsent: async (page: any) => { ... },
      clearSessionData: async (page: any) => { ... },
      setVideoQuality: async (page: any, quality: string) => { await setPersistentVideoQuality(page, quality); },
      markProxyFailed: (reason: string) => { this.proxyManager.markProxyFailed(tab.state.id, reason); },
    };
```

with the same literal assigned to a `const baseContext`, then construct `executionContext` by conditionally overlaying. Use this exact structure:

```ts
    // Consent selector list, shared by the original and trusted handlers so the
    // selector coverage stays identical regardless of which path runs.
    const consentSelectors = [
      'button[aria-label*="Accept all"]',
      'button[aria-label*="Accept everything"]',
      'button[aria-label*="I agree"]',
      'button[aria-label*="Agree"]',
      'button:has-text("Accept all")',
      'button:has-text("Accept everything")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      'ytd-button-renderer:has-text("Accept all")',
      'ytd-button-renderer:has-text("I agree")',
      'ytd-button-renderer:has-text("Accept")',
      'ytd-button-renderer:has-text("Agree")',
      'tp-yt-paper-button[aria-label*="Accept"]',
      'tp-yt-paper-button[aria-label*="Agree"]',
      'tp-yt-paper-button:has-text("Accept all")',
      'tp-yt-paper-button:has-text("I agree")',
      '#accept-button',
      '#agree-button',
      '#yDmH0d button[aria-label*="Accept"]',
      'button[aria-label*="Accept cookies"]',
      'button:has-text("Accept cookies")',
    ];

    const baseContext: TaskExecutionContext = {
      isTabValid: () => !tab.closed && this.tabs.has(tab.state.id),
      emitEvent: (kind: 'status' | 'log' | 'result' | 'error', data: unknown) => {
        this.emitEvent({ tabId: tab.state.id, kind, data, timestamp: Date.now() });
      },
      randomDelay,
      simulateHumanInteraction: async (page: any) => {
        try {
          await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100, { steps: 5 });
          await page.evaluate(() => { window.scrollBy(0, Math.random() * 200 - 100); });
        } catch { /* existing best-effort behavior */ }
      },
      handleYouTubeConsent: async (page: any) => {
        await page.evaluate((selectors: string[]) => {
          for (const selector of selectors) {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach((el) => {
                const text = el.textContent?.toLowerCase() || '';
                if (text.includes('accept') || text.includes('agree') || text.includes('consent') || text.includes('continue') || text.includes('allow')) {
                  (el as HTMLElement).click();
                }
              });
            } catch {}
          }
          const buttons = document.querySelectorAll('button, [role="button"], tp-yt-paper-button, ytd-button-renderer');
          buttons.forEach((btn) => {
            const text = btn.textContent?.toLowerCase() || '';
            if (text.includes('accept') || text.includes('agree') || text.includes('consent') || text.includes('i agree') || text.includes('accept all') || text.includes('continue') || text.includes('allow all')) {
              (btn as HTMLElement).click();
            }
          });
        }, consentSelectors).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1500));
      },
      clearSessionData: async (page: any) => {
        await page.context().clearCookies();
        await page.evaluate(() => {
          try { localStorage.clear(); sessionStorage.clear(); } catch {}
        });
        await page.evaluate(() => {
          try {
            if ('indexedDB' in window) {
              indexedDB.databases().then((dbs) => { dbs.forEach((db) => { if (db.name) indexedDB.deleteDatabase(db.name); }); });
            }
          } catch {}
        });
        await page.evaluate(() => {
          try {
            if ('caches' in window) { caches.keys().then((names) => { names.forEach((name) => caches.delete(name)); }); }
          } catch {}
        });
        await page.evaluate(() => {
          try {
            if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then((regs) => { regs.forEach((reg) => reg.unregister()); }); }
          } catch {}
        });
      },
      setVideoQuality: async (page: any, quality: string) => { await setPersistentVideoQuality(page, quality); },
      markProxyFailed: (reason: string) => { this.proxyManager.markProxyFailed(tab.state.id, reason); },
    };

    // OFF path: the base context is the execution context. BEHAVIORALLY
    // IDENTICAL to today — the baseContext literal above reproduces the
    // existing callbacks verbatim.
    const executionContext: TaskExecutionContext = baseContext;

    // ON path: overlay trusted variants and add the new context fields,
    // leaving every original key intact. Plugins that already consume
    // ctx.simulateHumanInteraction / ctx.handleYouTubeConsent /
    // ctx.clearSessionData automatically get trusted behavior — no plugin
    // source is edited.
    if (ad.enabled) {
      const clickOpts = {
        poissonMeanMs: ad.poissonMeanMs,
        delayMinMs: ad.delayMinMs,
        delayMaxMs: ad.delayMaxMs,
        jitterPx: ad.jitterPx,
        bezierSteps: ad.bezierSteps,
      };
      executionContext.simulateHumanInteraction = async (page: any) => {
        try {
          const vw = page.viewportSize()?.width ?? 1280;
          const vh = page.viewportSize()?.height ?? 720;
          const end = { x: randomInt(0, vw), y: randomInt(0, vh) };
          const start = { x: randomInt(0, vw), y: randomInt(0, vh) };
          const path = bezierPath(start, end, ad.bezierSteps, ad.jitterPx);
          for (const pt of path) { await page.mouse.move(pt.x, pt.y, { steps: 1 }); }
        } catch { /* best-effort */ }
      };
      executionContext.handleYouTubeConsent = async (page: any) => {
        await trustedConsentClick(page, consentSelectors, clickOpts);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      };
      executionContext.clearSessionData = async (page: any) => {
        await resetSession(page, { trackerOnly: ad.clearYouTubeTrackerCookies && !ad.resetSession });
      };
      (executionContext as TaskExecutionContext & {
        trustedClick?: (page: any, selector: string) => Promise<boolean>;
        resetSession?: (page: any, opts?: { trackerOnly?: boolean }) => Promise<void>;
        humanDelay?: (meanMs: number, minMs: number, maxMs: number) => Promise<void>;
      }).trustedClick = async (page: any, selector: string) =>
        trustedClick(page, selector, clickOpts);
      (executionContext as TaskExecutionContext & {
        resetSession?: (page: any, opts?: { trackerOnly?: boolean }) => Promise<void>;
        humanDelay?: (meanMs: number, minMs: number, maxMs: number) => Promise<void>;
      }).resetSession = async (page: any, opts?: { trackerOnly?: boolean }) =>
        resetSession(page, opts ?? { trackerOnly: ad.clearYouTubeTrackerCookies });
      (executionContext as TaskExecutionContext & {
        humanDelay?: (meanMs: number, minMs: number, maxMs: number) => Promise<void>;
      }).humanDelay = async (meanMs: number, minMs: number, maxMs: number) =>
        humanDelay(meanMs, minMs, maxMs);
    }
```

Then delete the now-redundant original inline `handleYouTubeConsent`/`clearSessionData`/`simulateHumanInteraction` blocks that were inside the old literal (they are reproduced exactly in `baseContext` above). The signatures of the new optional context fields (`trustedClick`, `resetSession`, `humanDelay`) must be added to `TaskExecutionContext` in `basePlugin.ts` (next task) or this cast will not type-check cleanly — see Task 11.

> **OFF-path byte-identical guarantee:** The `baseContext` literal reproduces the four existing callbacks with identical bodies and the identical `consentSelectors` set (moved out only to be shared). `executionContext = baseContext` with no overlay when `ad.enabled === false` means every plugin receives the same functions and the same delay path (`randomDelay(100,500)` from Step 2's `else`). No key is added, removed, or reordered on the OFF path.

- [ ] **Step 3: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS. The three new context fields are assigned through strict typed intersection casts (`TaskExecutionContext & { trustedClick?: ... }`, etc.), which are temporary but type-safe — they keep this task green in isolation even though the fields are not yet declared on `TaskExecutionContext`. Task 11 adds the canonical declarations and removes these casts; it is a cleanup, not a required fix.

---

## Task 11: Extend `TaskExecutionContext` with the three optional antidetection fields

**Files:**
- Modify: `src/main/automation/plugins/basePlugin.ts` (the `TaskExecutionContext` interface, lines ~9–30)

**Interfaces:**
- Produces: three new optional fields on `TaskExecutionContext`: `trustedClick`, `resetSession`, `humanDelay`. Adding optional fields is non-breaking — every existing handler that ignores them still compiles, and the OFF path sets none of them (they stay `undefined`).

### Steps

- [ ] **Step 1: Add the optional fields**

Append to the `TaskExecutionContext` interface (after the existing `humanScroll?` line):

```ts
  /** Antidetection: trusted CDP-backed click with bezier cursor jitter.
   *  Present only when the antidetection layer is ON; plugins may use it for
   *  navigation-critical clicks where `isTrusted === true` matters. */
  trustedClick?: (page: import('playwright').Page, selector: string) => Promise<boolean>;
  /** Antidetection: per-worker fresh-identity reset (cookies/storage/IDB/Cache/
   *  ServiceWorkers), optionally YouTube-tracker-cookie-only. Present only when
   *  the antidetection layer is ON. */
  resetSession?: (
    page: import('playwright').Page,
    opts?: { trackerOnly?: boolean }
  ) => Promise<void>;
  /** Antidetection: Poisson-distributed inter-action delay. Present only when
   *  the antidetection layer is ON. */
  humanDelay?: (meanMs: number, minMs: number, maxMs: number) => Promise<void>;
```

- [ ] **Step 2: Simplify the casts in TabManager (Task 10 Step 2)**

Now that `TaskExecutionContext` declares the fields, the casts in Task 10 Step 3 can drop the intersection types. Replace each assignment like:

```ts
(executionContext as TaskExecutionContext & { trustedClick?: ... }).trustedClick = ...
```

with the direct form:

```ts
executionContext.trustedClick = async (page: any, selector: string) =>
  trustedClick(page, selector, clickOpts);
executionContext.resetSession = async (page: any, opts?: { trackerOnly?: boolean }) =>
  resetSession(page, opts ?? { trackerOnly: ad.clearYouTubeTrackerCookies });
executionContext.humanDelay = async (meanMs: number, minMs: number, maxMs: number) =>
  humanDelay(meanMs, minMs, maxMs);
```

This removes the casts entirely — cleaner and still strict-safe because the fields are now declared optional.

- [ ] **Step 3: Verify typecheck (main) — de-duplicates Task 10's casts**

Run: `npm run typecheck:main`
Expected: PASS. (Direct assignment now compiles because the fields are declared on `TaskExecutionContext`; the redundant intersection casts are gone.)

- [ ] **Step 4: Task complete (no git)** — trusted input & resetSession wired, no commit needed.

---

## Task 12: `BrowserController` — set ProxyManager tier preference at init

**Files:**
- Modify: `src/main/automation/BrowserController.ts` (`init()` or constructor wiring)

**Interfaces:**
- Consumes: `configService.getAntiDetectionConfig()` (added Task 7) and `ProxyManager.setTierPreference` (added Task 8).

### Steps

- [ ] **Step 1: Set the tier preference right after the ProxyManager is constructed**

In the `BrowserController` constructor, after `this.proxyManager = new ProxyManager();` (line ~45), add:

```ts
    // Antidetection hook (off by default): when preferResidential is enabled,
    // ProxyManager reorders the healthy pool to favor residential/mobile exits.
    // No-op when disabled — assignment stays identical to today.
    this.proxyManager.setTierPreference({
      preferResidential: configService.getAntiDetectionConfig().preferResidential,
    });
```

The config is already loaded by the time the constructor runs (the `configService` singleton is imported at module load), so a synchronous read is safe and mirrors how `getBrowserConfig()` is read at line 43.

- [ ] **Step 2: Verify typecheck (main)**

Run: `npm run typecheck:main`
Expected: PASS.

- [ ] **Step 3: Task complete (no git)** — BrowserController tier preference set, no commit needed.

---

## Task 13: `antidetection/README.md` — toggle doc

**Files:**
- Create: `src/main/automation/antidetection/README.md`

### Steps

- [ ] **Step 1: Write the doc**

```markdown
# Anti-Detection Hardening Layer

An OFF-by-default `antidetection` config block that makes Playwright worker sessions
harder to flag as automated. **Additive only** — when `antidetection.enabled` is `false`,
the app is behaviorally identical to pre-antidetection builds.

Workers are **Playwright** `BrowserContext`/`Page`, served from `TabManager.createTab`.
Consequently several spec requirements are already satisfied by the existing architecture
and are NOT re-implemented here:

| Spec requirement | Already satisfied by |
|---|---|
| Clean worker UA (no `Electron/x.y.z`) | `FINGERPRINT_POOL` real Chrome/Edge/Firefox UAs in `TabManager.ts` |
| `--enable-automation` / automation banner removed | `launchBrowser()` flags + existing stealth init script |
| `nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` | UI host `webPreferences` in `src/main/index.ts` (the only Electron `BrowserWindow`; workers are Playwright contexts) |
| World init script before page scripts | Playwright `context.addInitScript(...)` in `createTab` |
| Per-worker session isolation (no shared cookies/storage) | One `BrowserContext` per tab in `TabManager.createTab` |
| Sticky proxy (no mid-session rotation) | `ProxyManager.assign()` called once per tab; proxy baked into context options, never rotated for a live tab |

## Config

Set via `config.json` (merged shallowly), `APP_ANTIDETECTION_*` env vars, or both.
Defaults are conservative and OFF.

| Key | Default | Env var | Meaning |
|---|---|---|---|
| `enabled` | `false` | `APP_ANTIDETECTION_ENABLED` | Master switch. When false, no behavior changes. |
| `trustedInput` | `false` | `APP_ANTIDETECTION_TRUSTEDINPUT` | Trusted CDP clicks + Poisson delays + bezier jitter. Replaces synthetic `el.click()` in consent handlers. |
| `poissonMeanMs` | `250` | `APP_ANTIDETECTION_POISSONMEANMS` | Poisson mean for inter-action delays. |
| `delayMinMs` | `90` | `APP_ANTIDETECTION_DELAYMINMS` | Min inter-action delay (ms). |
| `delayMaxMs` | `900` | `APP_ANTIDETECTION_DELAYMAXMS` | Max inter-action delay (ms). |
| `jitterPx` | `6` | `APP_ANTIDETECTION_JITTERPX` | Max cursor offset jitter (px). |
| `bezierSteps` | `12` | `APP_ANTIDETECTION_BEZIERSTEPS` | Mouse-move interpolation steps. |
| `preferResidential` | `false` | `APP_ANTIDETECTION_PREFERRESIDENTIAL` | Reorder healthy pool to prefer residential/mobile. No-op on untagged proxies. |
| `resetSession` | `false` | `APP_ANTIDETECTION_RESETSESSION` | Expose `resetSession` context method at task boundaries. |
| `clearYouTubeTrackerCookies` | `false` | `APP_ANTIDETECTION_CLEARTRACKERCOOKIES` | Clear YouTube `YSC` + `VISITOR_INFO1_LIVE` for fresh identity. |

### Proxy tiers

`ProxyConfig.tier` (`residential` | `mobile` | `datacenter` | `isp` | `unknown`).
`preferResidential` only reorders proxies that carry a tier; `unknown` (the default when
unchecked) leaves the pool in its existing order, so an all-`unknown` pool behaves
identically with the layer OFF or ON.

**Datacenter ranges are high-risk** for YouTube bot heuristics. If you self-source proxies,
tag `datacenter` honestly so the ordering demotes them, or omit tiers entirely to keep the
current round-robin/random behavior. To tag tiers in `proxies.txt` today, the CSV parser in
`src/main/index.ts` would need a 5th column — that is a future additive change, deliberately
out of scope here to keep the OFF path byte-identical.

## What runs when `enabled: true`

1. `TabManager.createTab` registers a second, minimal init script: `navigator.webdriver === false`
   and a `cdc_*` glue scrub. (The existing stealth script handles UA/plugins/languages.)
2. `TabManager.dispatchTask` uses Poisson inter-action delays (when `trustedInput`) and overlays
   the execution context: `simulateHumanInteraction` becomes a bezier mouse sweep,
   `handleYouTubeConsent` becomes trusted locator clicks, `clearSessionData` routes through
   `resetSession` (YouTube-tracker-cookie-only when `clearYouTubeTrackerCookies`).
3. `ProxyManager.assign()` reorders the healthy pool to prefer residential/mobile when
   `preferResidential` (untagged ⇒ unchanged).

## Out of scope (never implemented)

Defeating reCAPTCHA / "confirm you're not a bot" challenges, view/watch-time inflation, or
circumventing YouTube access controls. This layer only makes legitimate automation robust,
session-stable, and hard to MIS-flag — it does not evade abuse enforcement.
```

- [ ] **Step 2: Task complete (no git)** — doc written, no commit needed.

---

## Task 14: Final verification — typecheck + ON/OFF smoke

**Files:**
- None (verification only)

### Steps

- [ ] **Step 1: Full typecheck across all three projects**

Run: `npm run typecheck`
Expected: PASS (main + preload + renderer). The preload and renderer projects are untouched by this work, so they must compile exactly as before.

- [ ] **Step 2: Backend build stays clean**

Run: `npm run build:backend`
Expected: PASS. (esbuild must resolve the new `antidetection/` files. They import only `playwright` (existing dep) and `../../config/configService` (existing).)

- [ ] **Step 3: OFF-path smoke — confirm baseline is unchanged**

Start the app with `antidetection.enabled` at its default (OFF):
```bash
npm run dev
```
Then, in the UI:
- Create a tab → confirm it launches and reports `idle` exactly as before.
- Run a `navigate` task to a YouTube URL → confirm it navigates, the consent handler shape is unchanged (logs identical), and proxy assignment picks the first healthy proxy (same as before).
- Inspect a worker `console` log line for `navigator.webdriver` — with OFF it should still report `undefined` (the existing script), proving the OFF init-script path was not touched.

Expected: behavior indistinguishable from the pre-antidetection build (task queue, proxy rotation order, logs all match).

- [ ] **Step 4: ON-path smoke — confirm the hardening applies**

Stop the app, enable the layer via env:
```bash
APP_ANTIDETECTION_ENABLED=true APP_ANTIDETECTION_TRUSTEDINPUT=true npm run dev
```
Then:
- Create a tab and run `runTask` with a `navigate` to a YouTube URL.
- In a worker-page console (DevTools on that context is not available since it's a Playwright context — instead run a small `click`/`extractText` task that evaluates `() => ({ webdriver: navigator.webdriver, plugins: navigator.plugins.length, lang: navigator.languages[0] })` via the existing `extractText` or a one-off evaluate). Confirm `navigator.webdriver === false` (Acceptance Criteria 2) — `undefined` with OFF, `false` with ON.
- Confirm clicks issued via the consent path are `isTrusted` (the trusted path uses `page.locator().click()` / `page.mouse`, both CDP-backed).

Expected: `webdriver === false`, clean worker UA (already true), trusted clicks, per-tab isolated session (already true), sticky proxy (already true).

- [ ] **Step 5: Mark plan complete**

No commit needed. Close out the task tracker and report the ON/OFF smoke results to the reviewer.

---

## Self-Review Notes (for the executing engineer)

- **Spec section 1 (environment de-cloaking):** UA/plugins/languages/banner already satisfied (documented in README); the genuinely-new addition — `navigator.webdriver === false` + `cdc_*` scrub — is Task 9. Node globals unreachable: workers are Playwright contexts with no `nodeIntegration` (already true).
- **Spec section 2 (input simulation):** trusted clicks + Poisson delays + bezier jitter — Tasks 3, 4, 10. `webContents.sendInputEvent`/CDP is already what Playwright uses; the genuinely-untrusted synthetic clicks were the `el.click()` in consent handlers, now replaced by trusted locator clicks when ON.
- **Spec section 3 (network/proxy hygiene):** sticky session already true (README); tier-aware ordering — Task 8; no custom network agent added.
- **Spec section 4 (session lifecycle):** per-worker isolation already true; `resetSession` + YouTube tracker cookies — Tasks 5, 10.
- **Spec section 5 (config + plumbing):** Tasks 7, 12; no new IPC (renderer untouched).
- **Acceptance Criteria 1 (OFF ⇒ identical):** guaranteed by the `executionContext = baseContext` no-overlay construction (Task 10) and the `preferResidentialTier=false` no-op in `orderByTier` (Task 8) and the gated second init script (Task 9).
- **Acceptance Criteria 2 (ON ⇒ hardened):** Tasks 9 + 10 + 8.
- **Acceptance Criteria 3 (no captcha/challenge bypass):** `resetSession` only discards tracker state; nothing attempts to solve or dismiss a "confirm you're not a bot" prompt.

## Out-of-scope reminder (do NOT implement, do NOT design toward)

- Defeating reCAPTCHA or "Sign in to confirm you're not a bot" challenge prompts.
- View farming, watch-time/impression inflation, engagement-metric manipulation.
- Circumventing YouTube's access controls for unauthorized mass data extraction.
