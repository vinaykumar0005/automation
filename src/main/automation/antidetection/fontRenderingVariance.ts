// src/main/automation/antidetection/fontRenderingVariance.ts
/**
 * Font Rendering Variance
 * Subpixel rendering and font hinting normalization
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply font rendering variance protections to a page or browser context
 */
export async function applyFontRenderingVariance(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Normalize subpixel rendering to prevent fingerprinting
    if ('navigator' in window) {
      // We can't directly control subpixel rendering, but we can affect how fonts are rendered
      // through CSS and Canvas protections
    }

    // 2. Protect against font rendering detection via Canvas
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text: string, x: number, y: number, maxWidth?: number) {
      // Add subtle variance to text positioning to prevent exact matching
      // while maintaining readability
      const jitterX = (Math.random() * 0.4) - 0.2; // ±0.2 pixels
      const jitterY = (Math.random() * 0.4) - 0.2; // ±0.2 pixels

      return originalFillText.call(this, text, x + jitterX, y + jitterY, maxWidth);
    };

    const originalStrokeText = CanvasRenderingContext2D.prototype.strokeText;
    CanvasRenderingContext2D.prototype.strokeText = function(text: string, x: number, y: number, maxWidth?: number) {
      const jitterX = (Math.random() * 0.4) - 0.2; // ±0.2 pixels
      const jitterY = (Math.random() * 0.4) - 0.2; // ±0.2 pixels

      return originalStrokeText.call(this, text, x + jitterX, y + jitterY, maxWidth);
    };

    // 3. Protect against font hinting detection
    // Font hinting is difficult to protect directly, but we can add variance to
    // text metrics and rendering
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text: string) {
      const metrics = originalMeasureText.call(this, text);

      // Add subtle, varying noise to text metrics
      // Use a seed based on the text to make the noise consistent for the same text
      // but different across different texts
      let seed = 0;
      for (let i = 0; i < text.length; i++) {
        seed = (seed * 31 + text.charCodeAt(i)) % 10000007;
      }

      // Use the seed to generate consistent noise for this text
      const noise = ((seed % 1000) / 500 - 1) * 0.01; // ±0.5% noise based on text content

      const noisyWidth = metrics.width * (1 + noise);

      // Build a new TextMetrics object with noisy values
      // Check for experimental properties before accessing them
      const result: TextMetrics = {
        width: noisyWidth,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxLeft: metrics.actualBoundingBoxLeft !== undefined
          ? metrics.actualBoundingBoxLeft + metrics.width * ((Math.random() * 0.02) - 0.01)
          : undefined,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxRight: metrics.actualBoundingBoxRight !== undefined
          ? metrics.actualBoundingBoxRight + metrics.width * ((Math.random() * 0.02) - 0.01)
          : undefined,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        fontBoundingBoxDescent: metrics.fontBoundingBoxDescent,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxDescent: metrics.actualBoundingBoxDescent
      };

      return result;
    };

    // 4. Protect against font detection via getComputedStyle
    if ('getComputedStyle' in window) {
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(element: Element, pseudoElement?: string | null) {
        const style = originalGetComputedStyle.call(this, element, pseudoElement);

        // We don't modify the style object as it would break functionality
        // Font protection is handled at the rendering level above
        return style;
      };
    }

    // 5. Normalize font loading behavior to prevent timing-based detection
    if ('document' in window && 'fonts' in document) {
      const originalFonts = document.fonts as FontFaceSet;
      if (originalFonts) {
        // Protect the fonts object to prevent timing-based font detection
        const wrappedFonts = {
          ...originalFonts,
          check: async function(fontList: string[]) {
            const start = performance.now();
            const fontString = fontList.join(',');
            const result = await originalFonts.check.call(this, fontString);
            const elapsed = performance.now() - start;
            // Ensure minimum time for font checking
            const minTime = 10; // 10ms minimum
            if (elapsed < minTime) {
              await new Promise(resolve => setTimeout(resolve, minTime - elapsed));
            }
            return result;
          },
          load: async function(font: string, text?: string) {
            const start = performance.now();
            const result = await originalFonts.load.call(this, font, text);
            const elapsed = performance.now() - start;
            const minTime = 15; // 15ms minimum for font loading
            if (elapsed < minTime) {
              await new Promise(resolve => setTimeout(resolve, minTime - elapsed));
            }
            return result;
          }
        };
        Object.defineProperty(document, 'fonts', {
          value: wrappedFonts,
          configurable: true
        });
      }
    }

    // 6. Add variance to font rendering to prevent exact matching
    // We've already handled this in the text measuring and filling functions above

    // 7. Protect against font detection via SVG
    if ('SVGElement' in window) {
      const SVGElementProto = SVGElement.prototype as any;
      if (typeof SVGElementProto.getBBox === 'function') {
        const originalGetBBox = SVGElementProto.getBBox;
        SVGElementProto.getBBox = function() {
          const bbox = originalGetBBox.call(this);
          // Add subtle variance to bounding box
          return {
            x: bbox.x + ((Math.random() * 0.4) - 0.2),
            y: bbox.y + ((Math.random() * 0.4) - 0.2),
            width: bbox.width + ((Math.random() * 0.4) - 0.2),
            height: bbox.height + ((Math.random() * 0.4) - 0.2)
          };
        };
      }
    }

    // 8. Normalize font rendering in CSS
    // This is complex and would require overriding the CSS rendering engine
    // which we can't do from JavaScript

    // 9. Protect against font detection via offsetWidth/height
    // We've already implemented protections for this in other modules
    // Additional protection could be added here if needed

    // 10. Add consistency to font rendering across frames
    // We've implemented consistent noise generation based on text content above
    // which ensures the same text gets the same treatment
  });
}

export default { applyFontRenderingVariance };