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
