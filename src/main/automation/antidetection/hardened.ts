// src/main/automation/antidetection/hardened.ts
//
// One consolidated hardening layer, replacing 18 overlapping init scripts that
// contradicted each other (environmental.ts recomputed hardwareConcurrency from
// a UA guess after the fingerprint set it; playwrightEvasion.ts forced
// languages to en-US after the context locale set de-DE; network.ts and
// headerRandomization.ts both defined navigator.connection with different
// shapes). A self-contradicting browser is a fingerprint in itself.
//
// Every value derives from one HardenedFingerprint, so nothing disagrees.

export interface HardenedFingerprint {
  userAgent: string;
  uaFullVersion: string;
  locale: string;
  timezoneId: string;
  timezoneOffsetMinutes: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  platform: string;
  platformVersion: string;
  isMobile: boolean;
  hasTouch: boolean;
  maxTouchPoints: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
  audioSampleRate: number;
  canvasSeed: number;
  seed: number;
}

export async function applyHardening(
  context: import('patchright').BrowserContext,
  fp: HardenedFingerprint
): Promise<void> {
  await context.addInitScript((f: HardenedFingerprint) => {
    const g = globalThis as any;
    const nav = navigator as any;
    const rand = (() => {
      let s = f.seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    })();

    // ---- toString masking, installed before anything is patched --------
    const sources = new WeakMap<Function, string>();
    const origToString = Function.prototype.toString;
    const mask = <T extends Function>(fn: T, name: string, isAsync = false): T => {
      sources.set(fn, `${isAsync ? 'async ' : ''}function ${name}() { [native code] }`);
      return fn;
    };
    const patchedToString = function toString(this: Function) {
      return sources.get(this) ?? origToString.call(this);
    };
    sources.set(patchedToString, 'function toString() { [native code] }');
    Function.prototype.toString = patchedToString;

    const define = (target: any, key: string, getter: () => any) => {
      try {
        Object.defineProperty(target, key, { get: mask(getter, `get ${key}`), configurable: true });
      } catch {
        /* non-configurable */
      }
    };

    // ---- 1. automation markers -----------------------------------------
    define(nav, 'webdriver', () => false);
    for (const k of [
      '__playwright',
      '__playwright__binding__',
      '__pwInitScripts',
      '__pw_manual',
      '__PW_inspect',
      '__CLIKEE',
      '__PW_INTERR',
      '__PW_UPD_TS',
      '__PWAIT_SELECTORS',
      '__PWAIT_ACTIONABLE',
      '__PWAIT_HIDDEN',
      '__PWAIT_VISIBLE',
      '__PWAIT_STABLE',
      '__PWAIT_DETACHED',
      '__PWAIT_FOCUSED',
      '__PWAIT_ENABLED',
      '__PWAIT_EDITABLE',
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      'cdc_adoQpoasnfa76pfcZLmcfl_JSON',
      'cdc_adoQpoasnfa76pfcZLmcfl_Object',
      'cdc_adoQpoasnfa76pfcZLmcfl_Proxy',
    ]) {
      try {
        delete g[k];
      } catch {
        /* ignore */
      }
    }

    // Scrub automation frames out of stack traces.
    const desc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    if (desc?.get) {
      const origStack = desc.get;
      Object.defineProperty(Error.prototype, 'stack', {
        get: mask(function stack(this: Error) {
          return (origStack.call(this) ?? '')
            .replace(/\n\s*at .*playwright.*/g, '')
            .replace(/\n\s*at .*puppeteer.*/g, '')
            .replace(/\n\s*at .*__pw.*/g, '');
        }, 'get stack'),
        configurable: true,
      });
    }

    // ---- 2. chrome.* realism (augment, never replace) -------------------
    const chromeObj = (g.chrome ?? {}) as any;
    if (!chromeObj.runtime) {
      chromeObj.runtime = {
        connect: () => ({
          onMessage: { addListener: () => undefined },
          postMessage: () => undefined,
          disconnect: () => undefined,
        }),
        sendMessage: () => undefined,
        onConnect: { addListener: () => undefined, removeListener: () => undefined, hasListener: () => false },
        onMessage: { addListener: () => undefined, removeListener: () => undefined, hasListener: () => false },
      };
    }
    if (!chromeObj.app) {
      chromeObj.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: mask(function getDetails() {
          return null;
        }, 'getDetails'),
        getIsInstalled: mask(function getIsInstalled() {
          return false;
        }, 'getIsInstalled'),
      };
    }
    if (typeof chromeObj.csi !== 'function') {
      chromeObj.csi = mask(function csi() {
        return { onloadT: Date.now(), startE: Date.now(), pageT: performance.now(), tran: 15 };
      }, 'csi');
    }
    if (typeof chromeObj.loadTimes !== 'function') {
      const t = Date.now() / 1000;
      chromeObj.loadTimes = mask(function loadTimes() {
        return {
          requestTime: t,
          startLoadTime: t,
          commitLoadTime: t + 0.05,
          finishDocumentLoadTime: t + 0.2,
          finishLoadTime: t + 0.3,
          firstPaintTime: t + 0.25,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      }, 'loadTimes');
    }
    g.chrome = chromeObj;

    // ---- 3. plugins / mimeTypes ----------------------------------------
    const makeArrayLike = (items: any[], tag: string) => {
      const obj: any = {};
      items.forEach((it, i) => {
        obj[i] = it;
        obj[it.name ?? it.type] = it;
      });
      obj.length = items.length;
      obj.item = mask(function item(i: number) {
        return items[i] ?? null;
      }, 'item');
      obj.namedItem = mask(function namedItem(n: string) {
        return items.find((x) => (x.name ?? x.type) === n) ?? null;
      }, 'namedItem');
      obj.refresh = mask(function refresh() {
        return undefined;
      }, 'refresh');
      obj[Symbol.iterator] = function* () {
        yield* items;
      };
      obj[Symbol.toStringTag] = tag;
      return obj;
    };

    const pluginNames = [
      'PDF Viewer',
      'Chrome PDF Viewer',
      'Chromium PDF Viewer',
      'Microsoft Edge PDF Viewer',
      'WebKit built-in PDF',
    ];
    const plugins = pluginNames.map((name) => ({
      name,
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      length: 1,
    }));
    define(nav, 'plugins', () => makeArrayLike(plugins, 'PluginArray'));
    define(nav, 'mimeTypes', () =>
      makeArrayLike(
        [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
          { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
        ],
        'MimeTypeArray'
      )
    );
    define(nav, 'pdfViewerEnabled', () => true);

    // ---- 4. languages, Intl, timezone ----------------------------------
    const langs = [f.locale, f.locale.split('-')[0], 'en'].filter((v, i, a) => a.indexOf(v) === i);
    define(nav, 'languages', () => langs);
    define(nav, 'language', () => f.locale);

    const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = mask(function resolvedOptions(this: any) {
      const r = origResolved.call(this);
      r.timeZone = f.timezoneId;
      r.locale = f.locale;
      return r;
    }, 'resolvedOptions');

    Date.prototype.getTimezoneOffset = mask(function getTimezoneOffset() {
      return f.timezoneOffsetMinutes;
    }, 'getTimezoneOffset');

    // ---- 5. platform / hardware ----------------------------------------
    define(nav, 'platform', () => f.platform);
    define(nav, 'hardwareConcurrency', () => f.hardwareConcurrency);
    define(nav, 'deviceMemory', () => f.deviceMemory);
    define(nav, 'maxTouchPoints', () => f.maxTouchPoints);
    define(nav, 'vendor', () => 'Google Inc.');
    define(nav, 'productSub', () => '20030107');
    define(nav, 'appCodeName', () => 'Mozilla');
    define(nav, 'appName', () => 'Netscape');
    define(nav, 'appVersion', () => f.userAgent.replace(/^Mozilla\//, ''));
    define(nav, 'cookieEnabled', () => true);
    define(nav, 'onLine', () => true);
    define(nav, 'doNotTrack', () => null);

    // ---- 6. client hints ------------------------------------------------
    const major = f.uaFullVersion.split('.')[0];
    const brands = [
      { brand: 'Not=A?Brand', version: '99' },
      { brand: 'Google Chrome', version: major },
      { brand: 'Chromium', version: major },
    ];
    const platformName = f.platform === 'MacIntel' ? 'macOS' : f.platform === 'Win32' ? 'Windows' : 'Linux';
    const highEntropy: Record<string, unknown> = {
      architecture: 'x86',
      bitness: '64',
      brands,
      formFactors: ['Desktop'],
      fullVersionList: [
        { brand: 'Not=A?Brand', version: '99.0.0.0' },
        { brand: 'Google Chrome', version: f.uaFullVersion },
        { brand: 'Chromium', version: f.uaFullVersion },
      ],
      mobile: f.isMobile,
      model: '',
      platform: platformName,
      platformVersion: f.platformVersion,
      uaFullVersion: f.uaFullVersion,
      wow64: false,
    };
    define(nav, 'userAgentData', () => ({
      brands,
      mobile: f.isMobile,
      platform: platformName,
      getHighEntropyValues: mask(async function getHighEntropyValues(hints: string[]) {
        const out: Record<string, unknown> = {};
        for (const h of hints ?? []) if (h in highEntropy) out[h] = highEntropy[h];
        return out;
      }, 'getHighEntropyValues', true),
      toJSON: mask(function toJSON() {
        return { brands, mobile: f.isMobile, platform: platformName };
      }, 'toJSON'),
    }));

    // ---- 7. screen ------------------------------------------------------
    const w = f.viewportWidth;
    const h = f.viewportHeight;
    for (const [k, v] of [
      ['width', w],
      ['height', h],
      ['availWidth', w],
      ['availHeight', h - 40],
      ['availLeft', 0],
      ['availTop', 0],
      ['colorDepth', 24],
      ['pixelDepth', 24],
    ] as const) {
      define(screen, k, () => v);
    }
    define(screen, 'orientation', () => ({
      angle: 0,
      type: 'landscape-primary',
      onchange: null,
      lock: mask(async function lock() {
        return undefined;
      }, 'lock', true),
      unlock: mask(function unlock() {
        return undefined;
      }, 'unlock'),
    }));
    define(window, 'devicePixelRatio', () => f.deviceScaleFactor);
    define(window, 'outerWidth', () => w);
    define(window, 'outerHeight', () => h);
    define(window, 'innerWidth', () => w);
    define(window, 'innerHeight', () => h - 85);
    define(window, 'screenX', () => 0);
    define(window, 'screenY', () => 0);

    // ---- 8. matchMedia against the spoofed viewport --------------------
    const origMatchMedia = window.matchMedia;
    window.matchMedia = mask(function matchMedia(this: any, query: string) {
      const q = query
        .replace(/\(min-width:\s*\d+px\)/g, `(min-width: ${w}px)`)
        .replace(/\(max-width:\s*\d+px\)/g, `(max-width: ${w}px)`);
      return origMatchMedia.call(this, q);
    }, 'matchMedia');

    // ---- 9. WebGL / WebGL2 ---------------------------------------------
    const patchGL = (proto: any) => {
      if (!proto) return;
      const orig = proto.getParameter;
      proto.getParameter = mask(function getParameter(this: any, p: number) {
        if (p === 37445 || p === 7936) return f.webglVendor;
        if (p === 37446 || p === 7937) return f.webglRenderer;
        return orig.call(this, p);
      }, 'getParameter');
      const origExt = proto.getExtension;
      proto.getExtension = mask(function getExtension(this: any, name: string) {
        const ext = origExt.call(this, name);
        if (ext && name === 'WEBGL_debug_renderer_info') {
          return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        }
        return ext;
      }, 'getExtension');
    };
    patchGL(g.WebGLRenderingContext?.prototype);
    patchGL(g.WebGL2RenderingContext?.prototype);

    // ---- 10. canvas -----------------------------------------------------
    const canvasRand = (() => {
      let s = f.canvasSeed >>> 0;
      return () => {
        s = (s * 1103515245 + 12345) >>> 0;
        return s / 4294967296;
      };
    })();
    const perturb = (data: Uint8ClampedArray) => {
      for (let i = 0; i < data.length; i += 4) {
        if (canvasRand() < 0.0008) {
          data[i] = Math.min(255, data[i] + 1);
          data[i + 1] = Math.max(0, data[i + 1] - 1);
        }
      }
    };
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = mask(function toDataURL(this: HTMLCanvasElement, ...a: any[]) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 16 && this.height > 16) {
        try {
          const img = ctx.getImageData(0, 0, this.width, this.height);
          perturb(img.data);
          ctx.putImageData(img, 0, 0);
        } catch {
          /* tainted */
        }
      }
      return (origToDataURL as any).apply(this, a);
    }, 'toDataURL');

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = mask(function getImageData(this: any, ...a: any[]) {
      const img = (origGetImageData as any).apply(this, a);
      perturb(img.data);
      return img;
    }, 'getImageData');

    // ---- 11. audio ------------------------------------------------------
    if (g.AudioContext) {
      const origCreateOsc = g.AudioContext.prototype.createOscillator;
      g.AudioContext.prototype.createOscillator = mask(function createOscillator(this: any) {
        const osc = origCreateOsc.call(this);
        const origStart = osc.start;
        osc.start = mask(function start(this: any, ...a: any[]) {
          try {
            osc.frequency.value = osc.frequency.value + (rand() - 0.5) * 0.02;
          } catch {
            /* ignore */
          }
          return origStart.apply(this, a);
        }, 'start');
        return osc;
      }, 'createOscillator');
    }

    // ---- 12. media devices + capabilities -------------------------------
    if (nav.mediaDevices) {
      const origEnum = nav.mediaDevices.enumerateDevices;
      nav.mediaDevices.enumerateDevices = mask(async function enumerateDevices(this: any) {
        const devices = await origEnum.call(this);
        return devices.filter((d: any) => d.kind === 'audiooutput' || d.kind === 'videoinput');
      }, 'enumerateDevices', true);
    }
    if (g.MediaCapabilities?.prototype?.decodingInfo) {
      const origDecoding = g.MediaCapabilities.prototype.decodingInfo;
      g.MediaCapabilities.prototype.decodingInfo = mask(async function decodingInfo(this: any, cfg: any) {
        const res = await origDecoding.call(this, cfg);
        // Never claim smooth playback we cannot deliver — YouTube trusts this
        // when building the format ladder.
        return { ...res, smooth: res.supported && res.smooth };
      }, 'decodingInfo', true);
    }

    // ---- 13. permissions ------------------------------------------------
    const permissionTable: Record<string, string> = {
      geolocation: 'prompt',
      notifications: 'default',
      push: 'prompt',
      midi: 'prompt',
      camera: 'prompt',
      microphone: 'prompt',
      background_sync: 'granted',
      persistent_storage: 'prompt',
      'clipboard-write': 'granted',
      'system-wake-lock': 'granted',
      'window-placement': 'granted',
      'idle-detection': 'prompt',
    };
    if (nav.permissions?.query) {
      const origQuery = nav.permissions.query;
      nav.permissions.query = mask(async function query(this: any, d: any) {
        const state = permissionTable[d?.name];
        if (state) {
          return { state, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined };
        }
        return origQuery.call(this, d);
      }, 'query', true);
    }

    // ---- 14. battery ----------------------------------------------------
    if (nav.getBattery) {
      const origBattery = nav.getBattery;
      nav.getBattery = mask(async function getBattery(this: any) {
        const b = await origBattery.call(this);
        define(b, 'charging', () => true);
        define(b, 'chargingTime', () => 0);
        define(b, 'dischargingTime', () => Infinity);
        define(b, 'level', () => 0.55 + rand() * 0.4);
        return b;
      }, 'getBattery', true);
    }

    // ---- 15. connection (frozen — two modules used to fight here) ------
    const conn = {
      effectiveType: '4g',
      rtt: 50 + Math.round(rand() * 40),
      downlink: 20 + rand() * 60,
      downlinkMax: Infinity,
      saveData: false,
      type: 'wifi',
      onchange: null,
      addEventListener: mask(function addEventListener() {
        return undefined;
      }, 'addEventListener'),
      removeEventListener: mask(function removeEventListener() {
        return undefined;
      }, 'removeEventListener'),
    };
    define(nav, 'connection', () => conn);

    // ---- 16. storage quota ---------------------------------------------
    if (nav.storage?.estimate) {
      nav.storage.estimate = mask(async function estimate() {
        const quota = Math.round((120 + rand() * 80) * 1024 * 1024 * 1024);
        return { quota, usage: Math.round(rand() * 400 * 1024 * 1024) };
      }, 'estimate', true);
    }

    // ---- 17. misc desktop APIs -----------------------------------------
    define(nav, 'bluetooth', () => ({ getAvailability: mask(async () => true, 'getAvailability', true) }));
    define(nav, 'usb', () => ({ getDevices: mask(async () => [], 'getDevices', true) }));
    define(nav, 'hid', () => ({ getDevices: mask(async () => [], 'getDevices', true) }));
    define(nav, 'serial', () => ({ getPorts: mask(async () => [], 'getPorts', true) }));

    // ---- 18. performance.now at 5µs resolution -------------------------
    const origNow = performance.now.bind(performance);
    performance.now = mask(function now() {
      return Math.round(origNow() * 20) / 20;
    }, 'now');
  }, fp);
}

/** Reports what the page actually sees, for verification. */
export async function readFingerprintReport(page: import('patchright').Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const v = document.createElement('video');
    return {
      webdriver: navigator.webdriver,
      ua: navigator.userAgent,
      languages: navigator.languages,
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency,
      memory: (navigator as any).deviceMemory,
      plugins: navigator.plugins.length,
      dpr: window.devicePixelRatio,
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      screen: `${screen.width}x${screen.height}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tzOffset: new Date().getTimezoneOffset(),
      chromeCsi: typeof (window as any).chrome?.csi,
      webglVendor: (() => {
        const c = document.createElement('canvas').getContext('webgl');
        const e = c?.getExtension('WEBGL_debug_renderer_info');
        return e ? c?.getParameter(e.UNMASKED_VENDOR_WEBGL) : null;
      })(),
      codecs: {
        h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
        vp9: v.canPlayType('video/webm; codecs="vp9"'),
        av1: v.canPlayType('video/mp4; codecs="av01.0.05M.08"'),
      },
    };
  });
}