// src/main/automation/tabTypes.ts
import { TabState } from './types';
import { BrowserContext, Page } from 'playwright';

export interface ManagedTab {
  state: TabState;
  context: BrowserContext;
  page: Page;
  closed: boolean;
  loopTimer?: NodeJS.Timeout;
  /** URL to navigate back to when the video finishes — reloads the tab as a brand-new session instead of just rewinding. */
  loopUrl?: string;
}