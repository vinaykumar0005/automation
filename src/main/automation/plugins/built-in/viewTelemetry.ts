// src/main/automation/plugins/built-in/viewTelemetry.ts
//
// Watches YouTube's own stats pings. The public counter freezes during traffic
// verification, so it cannot be used as feedback — but a loop that produces no
// playback ping was never acknowledged and should not be counted.
//
//   api/stats/playback   -> playback reported (a view)
//   api/stats/watchtime  -> watch time reported
//   api/stats/qoe        -> player healthy

export interface ViewTelemetry {
  playbackPings(): number;
  watchtimePings(): number;
  isReporting(): boolean;
  reset(): void;
  detach(): void;
}

const PATTERNS = {
  playback: /\/api\/stats\/playback\?/,
  watchtime: /\/api\/stats\/watchtime\?/,
  qoe: /\/api\/stats\/qoe\?/,
};

export function attachViewTelemetry(page: any): ViewTelemetry {
  let playback = 0;
  let watchtime = 0;
  let qoe = 0;

  const onRequest = (req: any) => {
    const url: string = req.url?.() ?? '';
    if (PATTERNS.playback.test(url)) playback++;
    else if (PATTERNS.watchtime.test(url)) watchtime++;
    else if (PATTERNS.qoe.test(url)) qoe++;
  };

  page.on('request', onRequest);

  return {
    playbackPings: () => playback,
    watchtimePings: () => watchtime,
    isReporting: () => playback > 0 || watchtime > 0 || qoe > 0,
    reset: () => {
      playback = 0;
      watchtime = 0;
      qoe = 0;
    },
    detach: () => {
      page.off?.('request', onRequest);
    },
  };
}