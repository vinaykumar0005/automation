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
 *  For the means this layer uses (≈250ms) λ, and therefore the loop count,
 *  a hard cap of 10_000 iterations guards against pathological λ. */
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
  const cx = bezier1d(
    mid,
    start.x,
    (start.x + end.x) / 2 + px * jitter,
    (start.x + end.x) / 2,
    end.x
  );
  const cy = bezier1d(
    mid,
    start.y,
    (start.y + end.y) / 2 + py * jitter,
    (start.y + end.y) / 2,
    end.y
  );
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
