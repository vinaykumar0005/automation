// src/main/automation/antidetection/audioVideo.ts
/**
 * Advanced audio and video protection
 * Prevents detection through AudioContext, VideoCapabilities, and media APIs
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply audio/video fingerprinting protections to a page
 */
export async function applyAudioVideoProtection(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
// Audio/video fingerprinting overrides intentionally disabled:
// MediaKeySystemAccess rewrites, AudioContext noise, and canvas noise can
// break media decoding/rendering and report inconsistent media fingerprints.
// Genuine fingerprint protections remain intact elsewhere.
  });
}

export default { applyAudioVideoProtection };