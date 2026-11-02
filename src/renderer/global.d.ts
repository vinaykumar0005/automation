// src/renderer/global.d.ts
import type { AutomationApi } from '../shared/types';

declare global {
  interface Window {
    automationApi: AutomationApi;
  }
}

export {};