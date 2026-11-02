// src/main/automation/antidetection/advancedCanvasWebGL.ts
/**
 * Advanced canvas and WebGL protections
 * Enhances existing protections with more sophisticated techniques
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply advanced canvas/WebGL fingerprinting protections to a page
 */
export async function applyAdvancedCanvasWebGL(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Enhanced canvas protection with dynamic noise
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, encoderOptions) {
      // Call original to get the image data
      const result = originalToDataURL.call(this, type, encoderOptions);
      // For PNG, we could add noise, but to avoid breaking functionality,
      // we'll only add noise if the canvas has been drawn on (simple heuristic)
      // In practice, we rely on the per-context init script for canvas noise.
      return result;
    };

    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
      const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
      const data = imageData.data;
      // Add position-dependent noise that varies each call
      const timeStamp = Date.now();
      for (let i = 0; i < data.length; i += 4) {
        // Noise based on pixel position and time to prevent fingerprinting
        const xFreq = Math.sin(sx + i/4 * 0.01) * 0.1;
        const yFreq = Math.cos(sy + Math.floor(i/4 / sw) * 0.01) * 0.1;
        const timeFreq = Math.sin(timeStamp * 0.001) * 0.05;
        const noise = (xFreq + yFreq + timeFreq) * (Math.random() - 0.5) * 0.5;

        // Apply subtle noise to RGB
        data[i] = Math.max(0, Math.min(255, data[i] + noise * 128));
        data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise * 128));
        data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise * 128));
      }
      return imageData;
    };

    // 2/3. WebGL vendor/renderer spoofing used to live here, hardcoded to
    // 'NVIDIA RTX 3080' for EVERY tab. That clobbered the per-fingerprint
    // WebGL values the main TabManager init script already sets (see
    // TabManager.createTab), so a macOS-fingerprint tab reported NVIDIA D3D11
    // hardware — an instant, self-inflicted detection flag. Removed: the main
    // script's per-tab values (matching the UA/platform) are authoritative.
    //
    // 4. Protect against canvas fingerprinting via text metrics
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      const metrics = originalMeasureText.call(this, text);
      // Add tiny noise to prevent exact matching
      // Note: We cannot modify read-only properties of TextMetrics directly
      // Instead, we return the metrics as-is since the noise would be minimal
      // and other protections are in place
      return metrics;
    };

    // 5. Protect against font detection via offsetWidth/height of hidden elements
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(element) {
      const style = originalGetComputedStyle.call(this, element);
      // If element is hidden or off-screen, we could modify but it's complex.
      // Instead, we rely on font protection elsewhere.
      return style;
    };

    // 6. Screen dimensions — intentionally NOT overridden here.
    //
    // A previous version defined getters like:
    //   Object.defineProperty(screen, 'width', { get: () => screen.width })
    // Each getter read the very property it was defining, i.e. `screen.width`
    // called itself → unbounded recursion → `RangeError: Maximum call stack
    // size exceeded` on first access. YouTube's player/UI reads screen.* early
    // in boot, so this threw synchronously and aborted player initialization —
    // the page loaded and Polymer booted, but no <video> element was ever
    // created (the "no <video> element found" failure every tab hit, on every
    // proxy). It also clobbered the correct per-fingerprint screen values the
    // main TabManager init script already sets (TabManager.createTab).
    //
    // The main script owns screen.*; do not touch it here.

    // 7. Protect against requestAnimationFrame timing attacks
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
      // Add small random delay to RAF callbacks to prevent timing analysis
      const delayedCallback = function(timestamp: number) {
        const jitter = Math.random() * 2; // 0-2ms jitter
        return callback(timestamp + jitter);
      };
      return originalRaf.call(this, delayedCallback);
    };

    // 8. Protect against performance.now timing attacks
    if ('performance' in window && performance.now) {
      const originalNow = performance.now.bind(performance);
      performance.now = function() {
        return originalNow() + (Math.random() - 0.5) * 0.1; // ±0.05ms jitter
      };
    }

    // 9. Protect against JSON.stringify detection (unlikely but possible)
//    const originalStringify = JSON.stringify;
//    JSON.stringify = function(value: any, replacer: (string | number)[] | ((this: any, key: string, value: any) => any) | null | undefined, space: string | number) {
//      // Ensure consistent formatting
//      return originalStringify.call(this, value, replacer, space);
//    };
  });
}

export default { applyAdvancedCanvasWebGL };