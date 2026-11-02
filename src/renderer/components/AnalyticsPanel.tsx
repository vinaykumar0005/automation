import { useEffect, useRef, useState } from 'react';
import { useAutomationStore } from '../state/store';
import type { DashboardStats, ProfileRecord } from '../../shared/types';

function formatDuration(ms: number | null) {
  if (ms === null) return 'Not ready';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-white'}`}>{value}</div>
    </div>
  );
}

export function AnalyticsPanel() {
  const addLog = useAutomationStore((s) => s.addLog);
  const activity = useAutomationStore((s) => s.activity);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  const loadStats = async () => {
    try {
      const [result, profileList] = await Promise.all([
        window.automationApi.getDashboardStats(),
        window.automationApi.listProfiles(),
      ]);
      if (isMounted.current) {
        setStats(result);
        setProfiles(profileList);
      }
    } catch (err) {
      if (isMounted.current) {
        addLog(`[${new Date().toLocaleTimeString()}] Failed to load analytics: ${err}`);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadStats();
    const timer = window.setInterval(() => {
      void loadStats();
    }, 60000);
    return () => {
      window.clearInterval(timer);
      isMounted.current = false;
    };
  }, []);

  const health = stats?.health.status ?? 'warn';
  const healthClass =
    health === 'pass' ? 'text-emerald-400' : health === 'warn' ? 'text-amber-400' : 'text-rose-400';

  return (
    <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Analytics</div>
          <h2 className="text-base font-semibold text-white">Runtime and system health</h2>
        </div>
        <button
          onClick={() => void loadStats()}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
        >
          Refresh
        </button>
      </div>

      {loading && !stats ? (
        <div className="text-sm text-neutral-500">Loading analytics…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="App Uptime" value={formatDuration(stats?.appUptimeMs ?? null)} />
          <StatCard label="Browser Uptime" value={formatDuration(stats?.browserUptimeMs ?? null)} />
          <StatCard label="Active Tabs" value={String(stats?.activeTabs ?? 0)} accent="text-cyan-300" />
          <StatCard label="Tasks Executed" value={String(stats?.tasksExecuted ?? 0)} accent="text-violet-300" />
          <StatCard label="Tasks Failed" value={String(stats?.tasksFailed ?? 0)} accent="text-rose-300" />
          <StatCard label="Tabs Created" value={String(stats?.tabsCreated ?? 0)} />
          <StatCard label="Tabs Closed" value={String(stats?.tabsClosed ?? 0)} />
          <StatCard
            label="Proxy Pool"
            value={`${stats?.proxyStatus.count ?? 0} active, ${stats?.proxyStatus.rejected?.length ?? 0} rejected`}
            accent="text-sky-300"
          />
          <StatCard
            label="Health"
            value={stats ? stats.health.status.toUpperCase() : 'UNKNOWN'}
            accent={healthClass}
          />
          <StatCard
            label="Profiles"
            value={`${profiles.length} saved`}
            accent="text-emerald-300"
          />
          <StatCard
            label="Restarts"
            value={String(profiles.reduce((sum, profile) => sum + profile.restartCount, 0))}
            accent="text-amber-300"
          />
        </div>
      )}

      {stats && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Health Checks</div>
            <div className="mt-2 space-y-2 text-sm text-neutral-300">
              {Object.entries(stats.health.checks).map(([name, ok]) => (
                <div key={name} className="flex items-center justify-between rounded-lg bg-neutral-950/80 px-3 py-2">
                  <span>{name}</span>
                  <span className={ok ? 'text-emerald-400' : 'text-rose-400'}>{ok ? 'PASS' : 'FAIL'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Proxy Status</div>
            <div className="mt-2 text-sm text-neutral-300">
              <div className="flex items-center justify-between py-1">
                <span>Rotation</span>
                <span className="text-white">{stats.proxyStatus.strategy}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Browser Connected</span>
                <span className={stats.browserAlive ? 'text-emerald-400' : 'text-rose-400'}>
                  {stats.browserAlive ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Shutdown State</span>
                <span className={stats.isShutDown ? 'text-amber-400' : 'text-sky-300'}>
                  {stats.isShutDown ? 'Shut down' : 'Running'}
                </span>
              </div>
              <div className="mt-2 rounded-lg bg-neutral-950/80 px-3 py-2 text-xs text-neutral-400">
                Rejected proxies are shown in the Proxy panel; this dashboard only summarizes the current pool.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Recent Activity</div>
          <div className="mt-2 space-y-2">
            {activity.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-950/70 px-3 py-4 text-sm text-neutral-500">
                No recent activity yet.
              </div>
            ) : (
              activity.slice().reverse().slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-lg bg-neutral-950/80 px-3 py-2 text-sm text-neutral-300">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-white">{entry.message}</span>
                    <span className="text-[11px] text-neutral-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {entry.kind} · {entry.tabId}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Active Profiles</div>
          <div className="mt-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/70">
            <div className="grid grid-cols-[1.2fr_0.8fr_1.2fr] gap-2 border-b border-neutral-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              <div>Label</div>
              <div>Status</div>
              <div>Proxy</div>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {profiles.length === 0 ? (
                <div className="px-3 py-4 text-sm text-neutral-500">No profiles yet.</div>
              ) : (
                profiles.slice(0, 8).map((profile) => (
                  <div key={profile.id} className="grid grid-cols-[1.2fr_0.8fr_1.2fr] gap-2 border-b border-neutral-800 px-3 py-2 text-sm last:border-b-0">
                    <div className="truncate text-white">{profile.name}</div>
                    <div className={profile.status === 'failed' ? 'text-rose-400' : profile.status === 'running' ? 'text-amber-400' : 'text-emerald-400'}>
                      {profile.status}
                    </div>
                    <div className="truncate text-neutral-400">Restarts {profile.restartCount}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}