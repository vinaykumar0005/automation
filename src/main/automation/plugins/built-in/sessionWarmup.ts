// src/main/automation/plugins/built-in/sessionWarmup.ts
//
// Realistic entry path. A cold deep-link to /watch?v= has an empty referrer and
// no history entry, which is the clearest script signature on the watch page.
// This walks homepage -> (search) -> thumbnail click.
//
// Every step is best-effort: on any failure it falls back to a direct goto with
// a synthetic referrer, so a YouTube UI change degrades instead of breaking.

export interface WarmupOptions {
  videoId: string;
  useSearch: boolean;
  searchQuery?: string;
  log?: (msg: string) => void;
  dwellMs?: [number, number];
}

const HOMEPAGE = 'https://www.youtube.com/';

async function clickConsent(page: any): Promise<void> {
  const clicked = await page
    .evaluate(() => {
      const sels = [
        'ytd-consent-bump-v2-lightbox ytd-button-renderer:last-of-type button',
        'tp-yt-paper-dialog ytd-button-renderer:last-of-type button',
        'form[action*="consent"] button',
        'button[aria-label*="Accept all"]',
        'button[aria-label*="Alle akzeptieren"]',
        '#consent-bump button:last-of-type',
      ];
      for (const s of sels) {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);

  if (clicked) await page.waitForTimeout(900 + Math.random() * 900);
}

async function typeHuman(page: any, text: string): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.type(text[i]);
    const base = 55 + Math.random() * 95;
    const pause = Math.random() < 0.08 ? 180 + Math.random() * 320 : 0;
    await page.waitForTimeout(base + pause);
  }
}

async function clickVideoResult(page: any, videoId: string): Promise<boolean> {
  const selector = `a#video-title[href*="${videoId}"], a[href*="/watch?v=${videoId}"]`;
  const locator = page.locator(selector).first();

  try {
    await locator.waitFor({ state: 'attached', timeout: 12_000 });
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.waitForTimeout(250 + Math.random() * 450);

    const box = await locator.boundingBox();
    if (!box) return false;

    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.4 + Math.random() * 0.2);
    await page.mouse.move(x - 60, y - 40, { steps: 7 });
    await page.mouse.move(x, y, { steps: 5 });
    await page.waitForTimeout(90 + Math.random() * 160);
    await page.mouse.click(x, y);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk to the video. Returns true if the click path was used.
 */
export async function warmUpToVideo(page: any, opts: WarmupOptions): Promise<boolean> {
  const { videoId, useSearch, searchQuery, log } = opts;
  const dwell = opts.dwellMs ?? [1200, 3200];

  try {
    log?.('warmup: opening homepage');
    await page.goto(HOMEPAGE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await clickConsent(page);

    await page.waitForTimeout(dwell[0] + Math.random() * (dwell[1] - dwell[0]));
    await page.mouse.move(400 + Math.random() * 500, 300 + Math.random() * 300, { steps: 9 });
    await page.evaluate(() => window.scrollBy(0, 180 + Math.random() * 260)).catch(() => {});
    await page.waitForTimeout(500 + Math.random() * 1200);

    if (useSearch) {
      const box = page.locator('input#search, ytd-searchbox input#search').first();
      await box.waitFor({ state: 'visible', timeout: 8000 });
      await box.click();
      await page.waitForTimeout(200 + Math.random() * 300);
      await typeHuman(page, searchQuery?.trim() || videoId);
      await page.waitForTimeout(300 + Math.random() * 500);
      await page.keyboard.press('Enter');
      log?.('warmup: submitted search');
      await page.waitForTimeout(1800 + Math.random() * 2200);
    }

    const clicked = await clickVideoResult(page, videoId);
    if (clicked) {
      log?.('warmup: clicked result');
      await page.waitForTimeout(900 + Math.random() * 1100);
      return true;
    }
  } catch (err) {
    log?.(`warmup failed (${(err as Error).message}) — falling back to direct load`);
  }

  try {
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
      referer: HOMEPAGE,
    });
    log?.('warmup: direct fallback');
  } catch {
    /* caller surfaces the navigation failure */
  }
  return false;
}

export async function readReferrer(page: any): Promise<string> {
  return page.evaluate(() => document.referrer).catch(() => '');
}