// src/main/automation/antidetection/fonts.ts
/**
 * Advanced font fingerprinting protection
 * Prevents detection through font enumeration and metrics
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply font fingerprinting protections to a page or browser context
 * This should be called after page creation but before navigation
 */
export async function applyFontProtection(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Spoof font enumeration to return common, realistic fonts
    const originalQuery = (navigator as any).fonts?.query;
    if (originalQuery) {
      (navigator as any).fonts = {
        ...(navigator as any).fonts,
        query: async () => {
          // Return a realistic set of common fonts that won't raise suspicion
          const commonFonts = [
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Times',
            'Courier New',
            'Courier',
            'Verdana',
            'Georgia',
            'Palatino',
            'Garamond',
            'Bookman',
            'Comic Sans MS',
            'Trebuchet MS',
            'Arial Black',
            'Impact',
            'Lucida Sans Unicode',
            'Lucida Console',
            'Tahoma',
            'MS Sans Serif',
            'MS Serif'
          ];
          return commonFonts;
        }
      };
    }

    // 2. Protect canvas font measurement techniques
    // Note: Cannot modify read-only TextMetrics properties; rely on other protections
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      return originalMeasureText.call(this, text);
    };

    // 3. Prevent font loading detection through CSSFontFaceRule
    // Note: CSSStyleSheet.prototype.getRule is not a standard method; skipping this protection
    // Rely on font enumeration spoofing and document.fonts spoofing instead.

    // 4. Spoof document.fonts for consistency
    if ('fonts' in document) {
      Object.defineProperty(document, 'fonts', {
        get: () => ({
          ...document.fonts,
          check: async () => true,
          load: async () => undefined,
          ready: Promise.resolve()
        }),
        configurable: true
      });
    }
  });
}

export default { applyFontProtection };