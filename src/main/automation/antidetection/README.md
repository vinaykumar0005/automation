# Antidetection Layer

This module implements a YouTube anti-detection hardening layer designed to make worker sessions harder to flag as automated while maintaining backward compatibility when disabled.

## Overview

The antidetection layer is OFF by default and provides the following features when enabled:

1. **Trusted Input via CDP** - Uses Chrome DevTools Protocol for mouse movements and clicks that generate trusted DOM events (`isTrusted === true`)
2. **Session Hygiene** - Clears cookies, storage, IndexedDB, Cache, and ServiceWorkers for fresh session identity
3. **Human-like Delays** - Poisson-distributed inter-action delays with configurable jitter
4. **Bezier Curve Mouse Movement** - Natural-looking mouse paths with configurable jitter
5. **Proxy Tier Preference** - Prefers residential/mobile proxies over datacenter when enabled
6. **Browser Fingerprinting Protection** - Modifies navigator properties to avoid WebDriver detection

## Configuration

All antidetection features are controlled via the `antidetection` block in the application configuration:

```json
{
  "antidetection": {
    "enabled": false,                    // Master switch - all features OFF when false
    "trustedInput": false,               // Enable trusted CDP-backed clicks
    "poissonMeanMs": 250,                // Mean delay for Poisson distribution (ms)
    "delayMinMs": 90,                    // Minimum delay bounds (ms)
    "delayMaxMs": 900,                   // Maximum delay bounds (ms)
    "jitterPx": 6,                       // Mouse movement jitter (pixels)
    "bezierSteps": 12,                   // Bezier curve smoothness (steps)
    "preferResidential": false,          // Prefer residential/mobile proxies
    "resetSession": false,               // Clear session data between tasks
    "clearYouTubeTrackerCookies": false  // Only clear YouTracker tracker cookies (not all cookies)
  }
}
```

## Features Explained

### Trusted Input
When `trustedInput` is enabled:
- Mouse movements follow Bezier curves with configurable jitter
- Clicks are issued via Playwright's `locator.click()` which uses CDP `Input.dispatchMouseEvent`
- This results in DOM events with `isTrusted === true` (vs `isTrusted === false` for `page.evaluate(() => element.click())`)

### Session Hygiene
When `resetSession` is enabled:
- Clears YouTube tracker cookies (YSC, VISITOR_INFO1_LIVE) or all cookies based on `clearYouTubeTrackerCookies`
- Clears localStorage and sessionStorage
- Deletes all IndexedDB databases
- Clears Cache Storage
- Unregisters ServiceWorker registrations

### Human-like Delays
Provides functions for generating human-like timing:
- Poisson-distributed delays to prevent detectable patterns
- Configurable minimum/maximum bounds
- Bezier curve-based mouse movement with jitter

### Proxy Tier Preference
When `preferResidential` is enabled:
- ProxyManager reorders healthy proxy pool to prefer residential/mobile exit IPs
- Untagged ('unknown') proxies maintain their existing relative order
- YouTube treats residential/mobile IPs like normal users (lower risk)

## Implementation Details

### Module Structure
- `types.ts` - TypeScript interfaces and constants
- `delays.ts` - Pure math functions for delays, jitter, and Bezier curves
- `trustedInput.ts` - Trusted click implementation via CDP
- `sessionHygiene.ts` - Session clearing functionality
- `index.ts` - Barrel export for easy importing

### Integration Points
1. **TabManager** - Registers anti-detection init scripts in browser contexts
2. **TabManager.dispatchTask** - Wires trusted input and resetSession into plugin execution context
3. **BrowserController** - Sets ProxyManager tier preference at initialization
4. **Plugins** - Receive extended TaskExecutionContext with antidetection features when enabled

## Usage

The antidetection layer is designed to be completely additive:
- When `enabled: false`, the application behaves identically to before the layer was added
- When `enabled: true`, features can be selectively activated via individual flags
- No existing behavior is changed when features are disabled

## Browser Anti-detection Init Script

The init script registered in TabManager includes:
- WebRTC leak prevention (forces WebRTC through proxy)
- Webdriver property override (`navigator.webdriver = undefined`)
- Permissions API override (denies notifications/geolocation)
- Fake chrome object
- Plugins array override
- Languages override
- Platform override
- Hardware concurrency override
- Device memory override
- CPU class override
- Max touch points override
- Battery API override
- Canvas fingerprinting noise
- WebGL fingerprinting protection
- Navigator permissions override
- Connection API override
- MediaDevices enumeration override (allows video/audio output for YouTube)
- Webdriver navigator property override (newer Chrome)
- App version/vendor/product overrides
- Cookie enabled/onLine/doNotTrack overrides