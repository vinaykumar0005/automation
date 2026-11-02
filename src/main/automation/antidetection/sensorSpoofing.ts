// src/main/automation/antidetection/sensorSpoofing.ts
/**
 * Sensor Spoofing
 * Accelerometer, gyroscope, and proximity sensor data normalization
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply sensor spoofing protections to a page or browser context
 */
export async function applySensorSpoofing(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Normalize accelerometer data to prevent fingerprinting
    if ('accelerometer' in window) {
      // We can't easily override the sensor itself, but we can intercept readings
      // Instead, we'll add a listener that modifies the values
      if ('ondeviceorientationabsolute' in window) {
        const originalHandler = window.ondeviceorientationabsolute as any;
        window.ondeviceorientationabsolute = function(event: any) {
          if (originalHandler && typeof originalHandler === 'function') {
            // Create a modified event with normalized values
            const modifiedEvent = new DeviceOrientationEvent('deviceorientationabsolute', {
              alpha: event.alpha, // Keep alpha (compass direction) as-is
              beta: normalizeSensorValue(event.beta, -90, 90, 0), // Front-back tilt
              gamma: normalizeSensorValue(event.gamma, -180, 180, 0), // Left-right tilt
              absolute: event.absolute
            });
            return originalHandler.call(this, modifiedEvent);
          }
          return false;
        };
      }
    }

    // 2. Spoof gyroscope readings
    if ('gyroscope' in window) {
      if ('ondeviceorientation' in window) {
        const originalHandler = window.ondeviceorientation as any;
        window.ondeviceorientation = function(event: any) {
          if (originalHandler && typeof originalHandler === 'function') {
            // Apply subtle normalization to reduce precision that could be used for fingerprinting
            const modifiedEvent = new DeviceOrientationEvent('deviceorientation', {
              alpha: normalizeSensorValue(event.alpha, 0, 360, 0),
              beta: normalizeSensorValue(event.beta, -90, 90, 0),
              gamma: normalizeSensorValue(event.gamma, -90, 90, 0),
              absolute: event.absolute
            });
            return originalHandler.call(this, modifiedEvent);
          }
          return false;
        };
      }
    }

    // 3. Normalize proximity sensor data
    if ('ondeviceproximity' in window) {
      const originalHandler = window.ondeviceproximity as any;
      window.ondeviceproximity = function(this: any, event: any) {
        if (originalHandler && typeof originalHandler === 'function') {
          // Normalize proximity values to prevent exact matching
          const value = event.value;
          const max = event.max;
          const min = event.min;

          // Add slight variance to prevent fingerprinting while preserving usability
          const normalizedValue = value + (Math.random() * 0.5) - 0.25; // ±0.25 units
          const normalizedMax = max + (Math.random() * 0.5) - 0.25;
          const normalizedMin = min + (Math.random() * 0.5) - 0.25;

          const modifiedEvent = new (window as any).DeviceProximityEvent('deviceproximity', {
            value: normalizedValue,
            max: normalizedMax,
            min: normalizedMin
          });
          return originalHandler.call(this, modifiedEvent);
        }
        return false;
      };
    }

    // 4. Normalize linear acceleration sensor
    if ('ondevicemotion' in window) {
      const originalHandler = window.ondevicemotion as any;
      window.ondevicemotion = function(this: any, event: any) {
        if (originalHandler && typeof originalHandler === 'function') {
          // Normalize acceleration values
          const acceleration = event.acceleration;
          const accelerationIncludingGravity = event.accelerationIncludingGravity;
          const rotationRate = event.rotationRate;

          const modifiedEvent = new (window as any).DeviceMotionEvent('devicemotion', {
            acceleration: acceleration ? {
              x: normalizeSensorValue(acceleration.x, -20, 20, 0),
              y: normalizeSensorValue(acceleration.y, -20, 20, 0),
              z: normalizeSensorValue(acceleration.z, -20, 20, 0)
            } : null,
            accelerationIncludingGravity: accelerationIncludingGravity ? {
              x: normalizeSensorValue(accelerationIncludingGravity.x, -20, 20, 0),
              y: normalizeSensorValue(accelerationIncludingGravity.y, -20, 20, 0),
              z: normalizeSensorValue(accelerationIncludingGravity.z, -20, 20, 0)
            } : null,
            rotationRate: rotationRate ? {
              alpha: normalizeSensorValue(rotationRate.alpha, -360, 360, 0),
              beta: normalizeSensorValue(rotationRate.beta, -360, 360, 0),
              gamma: normalizeSensorValue(rotationRate.gamma, -360, 360, 0)
            } : null,
            interval: event.interval
          });
          return originalHandler.call(this, modifiedEvent);
        }
        return false;
      };
    }

    // 5. Protect against sensor-based timing attacks
    if ('permissions' in navigator) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = async (permissionDesc: PermissionDescriptor) => {
        // For sensor permissions, return consistent prompts to prevent timing-based detection
        const sensorPermissions = ['accelerometer', 'gyroscope', 'magnetometer', 'ambient-light-sensor'];
        if (permissionDesc &&
            typeof permissionDesc.name === 'string' &&
            sensorPermissions.includes(permissionDesc.name)) {
          // Always return the same state to prevent timing attacks
          // Create a minimal PermissionStatus object
          return Promise.resolve({
            state: 'prompt' as PermissionState,
            name: permissionDesc.name,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
          } as PermissionStatus);
        }
        return originalQuery.call(navigator.permissions, permissionDesc);
      };
    }

    // 6. Normalize sensor update frequencies to prevent fingerprinting
    // We can't directly control sensor frequencies, but we can add jitter to readings
    // The handlers above already incorporate some normalization

    // 7. Spoof sensor availability to look more like a typical device
    // Most phones have these sensors, but we'll make them appear consistently available
    // 7. Spoof sensor availability to look more like a typical device
    // Most phones have these sensors, but we'll make them appear consistently available
    // 7. Spoof sensor availability to look more like a typical device
    // Most phones have these sensors, but we'll make them appear consistently available
    // 7. Spoof sensor availability to look more like a typical device
    // Most phones have these sensors, but we'll make them appear consistently available
    if ('Accelerometer' in (window as any)) {
      const originalAccelerometer = (window as any).Accelerometer;
      (window as any).Accelerometer = class {
        constructor(options: any = {}) {
          // Create instance of original and copy its properties
          const instance = new originalAccelerometer(options);
          // Copy all properties from original instance to this
          Object.getOwnPropertyNames(instance).forEach(prop => {
            if (!(prop in this)) {
              Object.defineProperty(this, prop, Object.getOwnPropertyDescriptor(instance, prop)!);
            }
          });
          // Override the reading event to add subtle normalization
          (this as any).addEventListener('reading', () => {
            // This would require accessing the actual sensor reading to modify it
            // which is complex to do safely
          });
        }
      };
      // Copy static properties
      Object.getOwnPropertyNames(originalAccelerometer).forEach(prop => {
        if (!(prop in (window as any).Accelerometer)) {
          Object.defineProperty((window as any).Accelerometer, prop, Object.getOwnPropertyDescriptor(originalAccelerometer, prop)!);
        }
      });
    }

    if ('Gyroscope' in (window as any)) {
      const originalGyroscope = (window as any).Gyroscope;
      (window as any).Gyroscope = class extends originalGyroscope {
        constructor(options: any = {}) {
          super(options);
        }
      };
      (window as any).Gyroscope.prototype = originalGyroscope.prototype;
    }

    // Helper function to normalize sensor values within a range
    function normalizeSensorValue(value: number | null, min: number, max: number, defaultValue: number): number {
      if (value === null) return defaultValue;
      // Clamp to valid range
      let clamped = Math.max(min, Math.min(max, value));
      // Add subtle variance to prevent exact matching
      const variance = (max - min) * 0.01; // 1% of range as variance
      const jitter = (Math.random() * variance * 2) - variance; // ±variance
      return clamped + jitter;
    }
  });
}

export default { applySensorSpoofing };