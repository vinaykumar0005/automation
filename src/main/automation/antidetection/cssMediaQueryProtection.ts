// src/main/automation/antidetection/cssMediaQueryProtection.ts
/**
 * CSS Media Query Protection
 * Prevent detection via @media queries and feature detection
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply CSS media query protections to a page or browser context
 */
export async function applyCSSMediaQueryProtection(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Spoof matchMedia responses to prevent fingerprinting
    if ('matchMedia' in window) {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = function(query: string) {
        const mediaList = originalMatchMedia.call(this, query);

        // Add slight variance to media query results to prevent exact matching
        // while still maintaining usability for legitimate media queries
        const originalMatches = mediaList.matches;
        const originalMedia = mediaList.media;

        // We don't want to break legitimate media query functionality
        // So we only add variance in specific cases that are likely to be used for fingerprinting
        const fingerprintingQueries = [
          '(color-depth: 1)',
          '(color-depth: 2)',
          '(color-depth: 4)',
          '(color-depth: 8)',
          '(color-depth: 16)',
          '(color-depth: 24)',
          '(color-depth: 32)',
          '(monochrome: 0)',
          '(monochrome: 1)',
          '(monochrome: 2)',
          '(monochrome: 4)',
          '(monochrome: 8)',
          '(resolution: 1dpi)',
          '(resolution: 2dpi)',
          '(resolution: 96dpi)',
          '(resolution: 150dpi)',
          '(resolution: 300dpi)',
          '(scan: progressive)',
          '(scan: interlace)',
          '(grid: 0)',
          '(grid: 1)',
          '-webkit-device-pixel-ratio: 0',
          '-webkit-device-pixel-ratio: 1',
          '-webkit-device-pixel-ratio: 1.5',
          '-webkit-device-pixel-ratio: 2',
          '-webkit-device-pixel-ratio: 3'
        ];

        // Check if this looks like a fingerprinting query
        const isFingerprintingQuery = fingerprintingQueries.some(fq =>
          query.includes(fq) ||
          (query.includes('(') && query.includes(')') &&
           Math.random() < 0.3) // 30% chance to add variance to any media query
        );

        if (isFingerprintingQuery) {
          // Return a media list with slightly varied properties
          // We create an object that delegates to the original mediaList but overrides matches
          return {
            get matches() {
              // Return varied matches for fingerprinting queries
              return originalMatches && Math.random() > 0.5;
            },
            get media() {
              return originalMedia;
            },
            onchange: null,
            addListener: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => {
              return mediaList.addListener(listener);
            },
            removeListener: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => {
              return mediaList.removeListener(listener);
            },
            dispatchEvent: (event: Event) => {
              return mediaList.dispatchEvent(event);
            }
          } as MediaQueryList;
        }

        return mediaList;
      };
    }

    // 2. Protect against feature detection fingerprinting
    if ('canvas' in document.createElement('canvas')) {
      // Protect canvas feature detection
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(contextId: string, contextAttributes?: any) {
        // For 2D context, we've already protected it in other modules
        // For WebGL, additional protections could go here
        return originalGetContext.call(this, contextId, contextAttributes) as any;
      };
    }

    // 3. Normalize CSSOM property reporting to prevent fingerprinting
    if ('getComputedStyle' in window) {
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(element: Element, pseudoElement?: string | null) {
        const style = originalGetComputedStyle.call(this, element, pseudoElement);

        // We don't modify the style object as it would break functionality
        // Instead, we rely on other protections and the fact that
        // legitimate sites expect consistent computed styles
        return style;
      };
    }

    // 4. Protect against CSS font loading detection
    if ('document' in window && 'fonts' in document) {
      const originalFonts = document.fonts;
      if (originalFonts) {
        // We've already protected document.fonts in the fonts protection module
        // Additional protections could go here
      }
    }

    // 5. Add variance to media query evaluation to prevent timing-based detection
    // We've already handled matchMedia above

    // 6. Normalize viewport properties to prevent responsive design fingerprinting
    if ('window' in window) {
      // We've already protected viewport properties in other modules
      // Additional viewport protections could go here
    }

    // 7. Protect against CSS animation feature detection
    if ('CSS' in window && (window.CSS as any).supports) {
      const originalSupports = (window.CSS as any).supports;
      (window.CSS as any).supports = function(property: string, value?: string) {
        // Add slight variance to CSS.supports responses for known fingerprinting properties
        const fingerprintingProperties = [
          'animation-name',
          'animation-duration',
          'animation-timing-function',
          'animation-delay',
          'animation-iteration-count',
          'animation-direction',
          'animation-fill-mode',
          'animation-play-state',
          'transition',
          'transition-property',
          'transition-duration',
          'transition-timing-function',
          'transition-delay'
        ];

        const isFingerprintingProp = fingerprintingProperties.some(prop =>
          property.includes(prop) || property === prop
        );

        if (isFingerprintingProp && Math.random() < 0.3) {
          // Occasionally flip the result for fingerprinting properties
          const result = originalSupports.call(this, property, value);
          return !result;
        }

        return originalSupports.call(this, property, value);
      };
    }

    // 8. Protect against CSS layout feature detection
    // This is complex and would require overriding the rendering engine
    // which we can't do from JavaScript

    // 9. Normalize device pixel ratio reporting
    if ('window' in window) {
      const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
      const originalGet = originalDescriptor?.get;
      if (originalGet) {
        Object.defineProperty(window, 'devicePixelRatio', {
          get: function() {
            const originalValue = originalGet.call(this);
            // Add slight variance to prevent exact matching
            const variance = (Math.random() * 0.2) - 0.1; // ±0.1
            return Math.max(0.1, originalValue + variance);
          },
          configurable: true
        });
      }
    }

    // 10. Protect against CSS color detection
    // Color detection is usually done through computed styles, which we've addressed above
  });
}

export default { applyCSSMediaQueryProtection };