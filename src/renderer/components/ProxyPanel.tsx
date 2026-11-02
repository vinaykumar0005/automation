// src/renderer/components/ProxyPanel.tsx
import { useEffect, useState } from 'react';
import { useAutomationStore } from '../state/store';
import type { ProxyConfig, ProxyRotationStrategy, ProxyStatus } from '../../shared/types';

// Accepts one proxy per line in either format:
//   label,server,username,password
//   server                          (label auto-generated, no auth)
// e.g.
//   US-East,http://12.34.56.78:8080,user1,pass1
//   socks5://98.76.54.32:1080
export function parseProxyList(raw: string): ProxyConfig[] {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, i) => {
            const parts = line.split(',').map((p) => p.trim());
            if (parts.length === 1) {
                return { label: `Proxy ${i + 1}`, server: parts[0] };
            }
            const [label, server, username, password] = parts;
            return { label: label || `Proxy ${i + 1}`, server, username: username || undefined, password: password || undefined };
        });
}

export function ProxyPanel() {
    const addLog = useAutomationStore((s) => s.addLog);
    const [raw, setRaw] = useState('');
    const [strategy, setStrategy] = useState<ProxyRotationStrategy>('round-robin');
    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState<ProxyStatus | null>(null);

    const refreshStatus = async () => {
        try {
            const current = await window.automationApi.getProxyStatus();
            setStatus(current);
        } catch (err) {
            addLog(`[${new Date().toLocaleTimeString()}] Failed to load proxy status: ${err}`);
        }
    };

    useEffect(() => {
        void refreshStatus();
    }, []);

    const applyProxies = async () => {
        setApplying(true);
        try {
            const proxies = parseProxyList(raw);
            const s = await window.automationApi.setProxies(proxies, strategy);
            setStatus(s);
            addLog(
                `[${new Date().toLocaleTimeString()}] Validated ${proxies.length} proxies — ${s.count} working, ${s.rejected?.length ?? 0
                } rejected (${s.strategy})`
            );
            s.rejected?.forEach((r) => {
                addLog(`  ✗ ${r.label}: ${r.reason}`);
            });
        } catch (err) {
            addLog(`[${new Date().toLocaleTimeString()}] Failed to apply proxies: ${err}`);
        } finally {
            setApplying(false);
        }
    };
    const clearProxies = async () => {
        setRaw('');
        await window.automationApi.setProxies([], strategy);
        await refreshStatus();
        addLog(`[${new Date().toLocaleTimeString()}] Cleared proxy list — tabs now connect directly`);
    };

    return (
        <section className="border-b border-neutral-800 bg-neutral-950 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">Proxy Management</div>
                    <h2 className="text-base font-semibold text-white">Validate and rotate proxy pools</h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                    {status ? (
                        <>
                            <span>{status.count} active</span>
                            <span>·</span>
                            <span>{status.strategy}</span>
                        </>
                    ) : (
                        <span>Loading status…</span>
                    )}
                    <button
                        onClick={() => void refreshStatus()}
                        className="rounded-lg border border-neutral-700 px-2.5 py-1 text-neutral-200 hover:bg-neutral-900"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[1.3fr_0.9fr]">
                <div className="space-y-3">
                    <textarea
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        placeholder={'One proxy per line:\nUS-East,http://1.2.3.4:8080,user,pass\nsocks5://5.6.7.8:1080'}
                        rows={6}
                        className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-neutral-600"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={strategy}
                            onChange={(e) => setStrategy(e.target.value as ProxyRotationStrategy)}
                            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="round-robin">Round robin</option>
                            <option value="random">Random</option>
                            <option value="sticky-per-tab">Sticky per tab</option>
                        </select>

                        <button
                            onClick={applyProxies}
                            disabled={applying || raw.trim().length === 0}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                            {applying ? 'Applying…' : 'Apply Proxies'}
                        </button>

                        <button
                            onClick={clearProxies}
                            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                        >
                            Clear Pool
                        </button>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                        Applies to tabs created after this is set. Existing tabs keep their current proxy.
                    </p>
                </div>

                <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Current Pool</div>
                    {status && status.labels.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {status.labels.map((label) => (
                                <span key={label} className="rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs text-neutral-200">
                                    {label}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-950/70 px-3 py-4 text-sm text-neutral-500">
                            No proxies are currently active.
                        </div>
                    )}

                    <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Rejected</div>
                    {status?.rejected && status.rejected.length > 0 ? (
                        <div className="space-y-2">
                            {status.rejected.map((item) => (
                                <div key={`${item.label}-${item.reason}`} className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                                    <div className="font-medium">{item.label}</div>
                                    <div className="text-rose-300/80">{item.reason}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-sm text-neutral-500">No rejected proxies.</div>
                    )}
                </div>
            </div>
        </section>
    );
}