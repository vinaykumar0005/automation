export type TabStatus = 'idle' | 'launching' | 'running' | 'error' | 'closed';

export interface TabState {
  id: string;
  label: string;
  status: TabStatus;
  currentUrl?: string;
  lastError?: string;
  createdAt: number;
  proxyLabel?: string;
}

export interface TabTask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface TabEvent {
  tabId: string;
  kind: 'status' | 'log' | 'result' | 'error';
  data: unknown;
  timestamp: number;
}

/**
 * Source category for a proxy, used by the antidetection layer to prefer
 * residential/mobile exit IPs (which YouTube treats like normal users) over
 * datacenter ranges (high‑risk for bot heuristics).
 *
 * `'unknown'` is the default when no tier is supplied (e.g. proxies.txt does not tag tiers);
 * the ProxyManager leaves untagged proxies in their existing relative order, so an all‑unknown pool behaves
 * identically with the layer OFF or ON.
 */
export type ProxyTier = 'residential' | 'mobile' | 'datacenter' | 'isp' | 'unknown';

export interface ProxyConfig {
  label: string;
  server: string;
  username?: string;
  password?: string;
  /** Source category for tier-aware rotation. Optional and additive; omitting it
   *  leaves ProxyManager assignment order identical to today. See `ProxyTier`. */
  tier?: ProxyTier;
}

export type ProxyRotationStrategy = 'round-robin' | 'random' | 'sticky-per-tab' | 'tier-round-robin';

export interface ProxyHealthDetail {
  label: string;
  isHealthy: boolean;
  latency: number;
  consecutiveFailures: number;
  lastSuccess: number | null | undefined;
  lastCheck: number | undefined;
  ipv4Ip?: string;
  ipv6Leak?: boolean;
  ipv6Ip?: string;
}

export interface ProxyStatus {
  count: number;
  strategy: ProxyRotationStrategy;
  labels: string[];
  rejected?: Array<{ label: string; reason: string }>;
  health?: ProxyHealthDetail[];
}

export interface DashboardHealthStatus {
  status: 'pass' | 'warn' | 'fail';
  timestamp: string;
  responseTimeMs: number;
  checks: Record<string, boolean>;
}

export interface AppSettings {
  browser: {
    headless: boolean;
    maxTabs: number;
  };
  automation: {
    defaultTimeout: number;
    retryAttempts: number;
    retryDelay: number;
    enablePlugins: boolean;
  };
}

export type ProfileStatus = 'idle' | 'running' | 'completed' | 'failed' | 'recovered';

export interface ProfileTaskStep {
  id: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
}

export interface ProfileStepAuditEntry {
  stepId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  note?: string;
}

export interface ProfileRunRecord {
  id: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed';
  note: string;
  tabId?: string;
  stepCount: number;
  stepAudit?: ProfileStepAuditEntry[];
  checkpoint?: {
    completedStepIds: string[];
    resumedAt?: number;
  };
}

export interface ProfileRecord {
  id: string;
  name: string;
  description: string;
  baseUrl?: string;
  status: ProfileStatus;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRestartAt?: number;
  runCount: number;
  restartCount: number;
  scheduleEnabled?: boolean;
  scheduleIntervalMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  resumeOnRestart?: boolean;
  lastError?: string;
  steps: ProfileTaskStep[];
  history: ProfileRunRecord[];
}

export interface ProfileCreateInput {
  name: string;
  description?: string;
  baseUrl?: string;
  steps: ProfileTaskStep[];
  scheduleEnabled?: boolean;
  scheduleIntervalMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  resumeOnRestart?: boolean;
}

export interface ProfileRunResult {
  profile: ProfileRecord;
  run: ProfileRunRecord;
}

export interface ProfileStats {
  profileCount: number;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  restartedProfiles: number;
}

export interface DashboardStats {
  appUptimeMs: number;
  browserUptimeMs: number | null;
  browserAlive: boolean;
  isShutDown: boolean;
  activeTabs: number;
  tabsCreated: number;
  tabsClosed: number;
  tasksExecuted: number;
  tasksFailed: number;
  proxyStatus: ProxyStatus;
  health: DashboardHealthStatus;
  profileStats?: ProfileStats;
}

export interface AutomationApi {
  createTab: (label?: string) => Promise<TabState>;
  closeTab: (id: string) => Promise<void>;
  runTask: (id: string, task: TabTask) => Promise<unknown>;
  runBroadcastTask: (
    task: Omit<TabTask, 'id'>,
    tabIds?: string[]
  ) => Promise<Array<{ id: string; result: unknown }>>;
  listTabs: () => Promise<TabState[]>;
  onTabEvent: (cb: (evt: TabEvent) => void) => () => void;
  setProxies: (proxies: ProxyConfig[], strategy: ProxyRotationStrategy) => Promise<ProxyStatus>;
  getProxyStatus: () => Promise<ProxyStatus>;
  listProfiles: () => Promise<ProfileRecord[]>;
  createProfile: (profile: ProfileCreateInput) => Promise<ProfileRecord>;
  updateProfile: (id: string, updates: Partial<ProfileRecord>) => Promise<ProfileRecord>;
  deleteProfile: (id: string) => Promise<void>;
  importProfiles: (payload: string) => Promise<ProfileRecord[]>;
  exportProfiles: () => Promise<string>;
  runProfile: (id: string, tabId?: string) => Promise<ProfileRunResult>;
  restartProfile: (id: string, tabId?: string) => Promise<ProfileRunResult>;
  getDashboardStats: () => Promise<DashboardStats>;
  getAppSettings: () => Promise<AppSettings>;
  updateAppSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
}