// src/main/automation/plugins/built-in/videoQuality.ts
//
// Persistent YouTube quality setter.
//
// Two bugs fixed:
//  - `window.__persistVideoQuality = mappedQ` referenced a TypeScript variable
//    from inside the injected script, so the whole thing threw a ReferenceError
//    on every document and quality was never applied. Because it threw before
//    setting the guard, the guard never worked either, so every call appended
//    another throwing init script.
//  - setPlaybackQuality() alone is a no-op on adaptive streams; quality only
//    holds if setPlaybackQualityRange() is used too.

const QUALITY_MAP: Record<string, string> = {
  auto: 'highres',
  '1080': 'hd1080',
  '720': 'hd720',
  '480': 'large',
  '360': 'medium',
  '240': 'small',
  '144': 'tiny',
};

function buildPlaybackWatcherSource(q: string): string {
  const literal = JSON.stringify(QUALITY_MAP[q] || q || 'highres');

  return `(function(){
    // Dedupe by desired quality, not by a boolean.
    if (window.__vwq === ${literal}) return;
    window.__vwq = ${literal};
    var TARGET = ${literal};

    var apply = function(){
      var p = document.getElementById('movie_player');
      if (!p) return;
      try { p.setPlaybackQuality(TARGET); } catch (e) {}
      try { p.setPlaybackQualityRange(TARGET, TARGET); } catch (e) {}
    };

    apply();
    if (!window.__vwqTimer) window.__vwqTimer = setInterval(apply, 2000);
  })();`;
}

export async function setPersistentVideoQuality(page: any, quality: string): Promise<void> {
  const source = buildPlaybackWatcherSource(quality);
  const marker = `__vwqRegistered_${quality}`;

  try {
    const already = await page.evaluate((m: string) => !!(window as any)[m], marker).catch(() => false);
    if (!already) {
      await page.addInitScript({ content: source });
      await page.evaluate((m: string) => {
        (window as any)[m] = true;
      }, marker);
    }
  } catch {
    /* non-fatal */
  }

  await page.evaluate(source).catch(() => {});
}