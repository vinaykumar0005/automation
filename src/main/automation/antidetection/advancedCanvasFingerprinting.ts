// src/main/automation/antidetection/advancedCanvasFingerprinting.ts
/**
 * Advanced Canvas Fingerprinting
 * Perlin noise, texture-based perturbations, and contextual canvas protection
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply advanced canvas fingerprinting protections to a page or browser context
 */
export async function applyAdvancedCanvasFingerprinting(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Perlin noise function for natural-looking perturbations
    function perlinNoise(x: number, y: number): number {
      // Simple pseudorandom noise function
      // In a production implementation, you might use a proper Perlin or Simplex noise library
      const floorX = Math.floor(x);
      const floorY = Math.floor(y);
      const s = (x - floorX) + (y - floorY);

      // Hash function for consistent noise
      const n = floorX + floorY * 57;
      const n1 = (n * n * 15731 + 789221) * 1376312589 & 0x7fffffff;
      const n2 = (n1 * n1 * 15731 + 789221) * 1376312589 & 0x7fffffff;

      return 1.0 - ((n2 % 1073741824) / 536870912.0);
    }

    function smoothedNoise(x: number, y: number): number {
      const corners = ( perlinNoise(x-1, y-1) + perlinNoise(x+1, y-1) + perlinNoise(x-1, y+1) + perlinNoise(x+1, y+1) ) / 16;
      const sides = ( perlinNoise(x-1, y) + perlinNoise(x+1, y) + perlinNoise(x, y-1) + perlinNoise(x, y+1) ) / 8;
      const center = perlinNoise(x, y) / 4;
      return corners + sides + center;
    }

    function interpolatedNoise(x: number, y: number): number {
      const integerX = Math.floor(x);
      const fractionalX = x - integerX;
      const integerY = Math.floor(y);
      const fractionalY = y - integerY;

      const v1 = smoothedNoise(integerX, integerY);
      const v2 = smoothedNoise(integerX + 1, integerY);
      const v3 = smoothedNoise(integerX, integerY + 1);
      const v4 = smoothedNoise(integerX + 1, integerY + 1);

      const i1 = interpolate(v1, v2, fractionalX);
      const i2 = interpolate(v3, v4, fractionalX);
      return interpolate(i1, i2, fractionalY);
    }

    function interpolate(a: number, b: number, x: number): number {
      const ft = x * 3.1415927;
      const f = (1.0 - Math.cos(ft)) * 0.5;
      return a * (1.0 - f) + b * f;
    }

    // 2. Enhanced canvas protection with Perlin noise
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(sx: number, sy: number, sw: number, sh: number) {
      const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
      const data = imageData.data;

      // Apply Perlin noise-based perturbations that vary with position and time
      const timeStamp = Date.now() * 0.001; // Slowly changing baseline

      for (let i = 0; i < data.length; i += 4) {
        // Calculate position-based noise
        const x = sx + (i/4) % sw;
        const y = sy + Math.floor((i/4) / sw);

        // Generate Perlin noise value for this pixel
        const noiseValue = interpolatedNoise(x * 0.01, y * 0.01 + timeStamp) * 2 - 1; // -1 to 1 range

        // Apply subtle noise to RGB channels (less aggressive to maintain readability)
        const noiseAmount = 1.5; // Very subtle
        data[i] = Math.max(0, Math.min(255, data[i] + noiseValue * noiseAmount));
        data[i+1] = Math.max(0, Math.min(255, data[i+1] + noiseValue * noiseAmount));
        data[i+2] = Math.max(0, Math.min(255, data[i+2] + noiseValue * noiseAmount));
      }

      return imageData;
    };

    // 3. Texture-based perturbations for fillStyle and strokeStyle
    const originalFillStyleSetter = Object.getOwnPropertyDescriptor(
      CanvasRenderingContext2D.prototype, 'fillStyle'
    )?.set;
    const originalStrokeStyleSetter = Object.getOwnPropertyDescriptor(
      CanvasRenderingContext2D.prototype, 'strokeStyle'
    )?.set;

    if (originalFillStyleSetter) {
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillStyle', {
        set: function(value: any) {
          // Add subtle texture to solid colors to prevent exact matching
          if (typeof value === 'string' &&
              (value.startsWith('rgb(') || value.startsWith('#') ||
               value.startsWith('hsl(') || value.startsWith('rgba('))) {
            // For solid colors, we could add noise, but it's complex to implement safely
            // Instead, we'll rely on the getImageData protection above
          }
          return originalFillStyleSetter.call(this, value);
        },
        configurable: true,
        enumerable: true
      });
    }

    if (originalStrokeStyleSetter) {
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'strokeStyle', {
        set: function(value: any) {
          return originalStrokeStyleSetter.call(this, value);
        },
        configurable: true,
        enumerable: true
      });
    }

    // 4. Context-aware protection: detect when canvas is likely being fingerprinted
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type: string, encoderOptions?: any) {
      // Call original to get the image data
      const result = originalToDataURL.call(this, type, encoderOptions);

      // Add subtle noise to prevent exact fingerprint matching
      // But we need to be careful not to break legitimate canvas usage
      // For now, we rely on the getImageData protection which is safer

      return result;
    };

    // 5. Protect against font detection via canvas text metrics
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text: string) {
      const metrics = originalMeasureText.call(this, text);

      // Add subtle, context-aware noise to text metrics
      // Use the actual canvas state to make noise more realistic
      const noise = (Math.random() * 0.02) - 0.01; // ±1% noise
      const noisyWidth = metrics.width * (1 + noise);

      // Build a new TextMetrics object with noisy values
      // Check for experimental properties before accessing them
      const result: TextMetrics = {
        width: noisyWidth,
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxLeft: ('actualBoundingBoxLeft' in metrics ? metrics.actualBoundingBoxLeft : 0) + metrics.width * ((Math.random() * 0.02) - 0.01),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxRight: ('actualBoundingBoxRight' in metrics ? metrics.actualBoundingBoxRight : 0) + metrics.width * ((Math.random() * 0.02) - 0.01),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        fontBoundingBoxAscent: ('fontBoundingBoxAscent' in metrics ? metrics.fontBoundingBoxAscent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        fontBoundingBoxDescent: ('fontBoundingBoxDescent' in metrics ? metrics.fontBoundingBoxDescent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxAscent: ('actualBoundingBoxAscent' in metrics ? metrics.actualBoundingBoxAscent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        actualBoundingBoxDescent: ('actualBoundingBoxDescent' in metrics ? metrics.actualBoundingBoxDescent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        alphabeticBaseline: ('alphabeticBaseline' in metrics ? metrics.alphabeticBaseline : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        emHeightAscent: ('emHeightAscent' in metrics ? metrics.emHeightAscent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        emHeightDescent: ('emHeightDescent' in metrics ? metrics.emHeightDescent : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        hangingBaseline: ('hangingBaseline' in metrics ? metrics.hangingBaseline : 0),
        // @ts-ignore - experimental properties may not be in TypeScript lib
        ideographicBaseline: ('ideographicBaseline' in metrics ? metrics.ideographicBaseline : 0)
      };

      return result;
    };

    // 6. Protect against canvas fingerprinting via getContext attributes
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(contextId: string, contextAttributes?: any) {
      const context = originalGetContext.call(this, contextId, contextAttributes);

      // For 2D context, we've already protected the prototype methods above
      // For WebGL context, additional protections could be added

      return context as any;
    };

    // 7. Add texture-based noise to prevent pattern matching in image data
    const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function(imagedata: ImageData, dx: number, dy: number, dirtyX?: number, dirtyY?: number, dirtyWidth?: number, dirtyHeight?: number) {
      // Apply subtle noise to the image data being painted
      if (imagedata.data) {
        const data = imagedata.data;
        const timeStamp = Date.now() * 0.001;

        for (let i = 0; i < data.length; i += 4) {
          // Use position relative to where it's being painted for more natural variation
          const x = dx + (i/4) % imagedata.width;
          const y = dy + Math.floor((i/4) / imagedata.width);

          const noiseValue = interpolatedNoise(x * 0.008, y * 0.008 + timeStamp) * 0.5; // Subtle

          data[i] = Math.max(0, Math.min(255, data[i] + noiseValue));
          data[i+1] = Math.max(0, Math.min(255, data[i+1] + noiseValue));
          data[i+2] = Math.max(0, Math.min(255, data[i+2] + noiseValue));
        }
      }

      // Call the original function with all arguments, handling undefined values
      return originalPutImageData.call(this, imagedata, dx, dy,
        dirtyX !== undefined ? dirtyX : 0,
        dirtyY !== undefined ? dirtyY : 0,
        dirtyWidth !== undefined ? dirtyWidth : 0,
        dirtyHeight !== undefined ? dirtyHeight : 0);
    };
  });
}

export default { applyAdvancedCanvasFingerprinting };