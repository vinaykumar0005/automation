// src/main/automation/plugins/built-in/videoQuality.ts
//
 // Persistent YouTube video-quality setter.
 //
 // The old one-shot implementation ran a short-lived interval that gave up after
 // ~10 seconds, only applied quality if the player happened to be ready at that
 // instant, and died with the document — so a tab reload, autoplay to the next
 // video, or a YouTube SPA video change reset quality and nothing re-applied it.
 //
 // This version has three properties that fix that:
 //   1. It keeps trying until the YouTube player is actually ready (it does NOT
 //      bail the first time the player isn't found).
 //   2. It keeps watching: whenever a new video is loaded on that document
 //      (playlist advance / autoplay), it re-applies the requested quality.
 //   3. It survives full tab reloads via `page.addInitScript({ content })`, which
 //      Playwright runs on every subsequent document load automatically.
 //
 // Only the `.html5-video-player` / `#movie_player` YouTube surface is targeted;
// on non-YouTube pages the watcher quietly gives up after ~45s with no overhead.

/**
 * Build the full init-script source with the requested quality embedded, so we
 * don't rely on Playwright string-vs-arg serialization. The returned expression
 * is a self-invoking function that runs once per document load.
 */
function buildPlaybackWatcherSource(q: string): string {
  // Map user-friendly quality to YouTube's internal quality levels
  const qualityMap: Record<string, string> = {
    'auto': 'highres',
    '1080': 'hd1080',
    '720': 'hd720',
    '480': 'large',
    '360': 'medium',
    '240': 'small',
    '144': 'tiny'
  };
  const mappedQ = qualityMap[q] || q;
  const safeQ = typeof mappedQ === 'string' && mappedQ.trim() ? mappedQ.trim() : 'highres';
  const arg = JSON.stringify(safeQ);
  return `(function(q){
    if (window.__persistVideoQuality !== undefined) return;
    window.__persistVideoQuality = mappedQ;

    var pick = function () {
      return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    };

    var appliedVideo = null;
    var idleAttempts = 0;
    var timer = null;

    var applyForCurrentVideo = function (player) {
      var videoId = null;
      try {
        if (typeof player.getVideoData === 'function') {
          var d = player.getVideoData();
          videoId = (d && (d.video_id || d.videoId)) || null;
        }
      } catch (e) {}

      var available = [];
      try {
        if (typeof player.getAvailableQualityLevels === 'function') {
          var result = player.getAvailableQualityLevels();
          if (Array.isArray(result)) {
            available = result;
          }
          // If it's not an array, we leave available as [] (default)
        }
      } catch (e) {
        // If we can't get available qualities, default to empty array
        available = [];
      }

      var target = mappedQ; // Use the mapped quality directly

      try {
        player.setPlaybackQuality(target);
      } catch (e) {
        // If setting the mapped quality fails, fall back to highres
        try {
          player.setPlaybackQuality('highres');
        } catch (e2) {
          // Ignore errors in the fallback
        }
      }

      // Update appliedVideo if we successfully got a video ID
      if (videoId !== null) {
        appliedVideo = videoId;
      }
    };

    var tick = function () {
      var player = pick();
      if (!player || typeof player.setPlaybackQuality !== 'function') {
        // No YouTube player (yet). Give up quietly on non-YouTube pages after a while.
        if (++idleAttempts > 45) { if (timer) clearInterval(timer); }
        return;
      }
      idleAttempts = 0;
      applyForCurrentVideo(player);
    };

    tick();
    timer = setInterval(tick, 1000);
  })(${arg});`;
}

/**
 * Persistently apply the requested YouTube playback quality on `page`.
 * Registers an init script that re-applies quality on every load (survives tab
 * reloads and video changes), and also applies it to the current document now.
 */
export async function setPersistentVideoQuality(page: any, quality: string): Promise<void> {
  const source = buildPlaybackWatcherSource(quality);

  // Future loads: re-establish the watcher on every document load.
  try {
    await page.addInitScript({ content: source });
  } catch (e) {
    // Log error but continue - we can still try to set quality on current document
    console.warn('Failed to add init script for persistent video quality:', e);
  }

  // Current document: apply right now (an init script only affects future loads).
  try {
    await page.evaluate(source);
  } catch (e) {
    // Log error
    console.warn('Failed to set persistent video quality on current document:', e);
  }
}