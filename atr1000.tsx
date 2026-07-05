// SPDX-License-Identifier: GPL-2.0-or-later
// Openhpsdr-Zeus UI — Antuner ATR-1000 plugin.
// Compact: dot + meters + tune/bypass buttons with active state.
// Full: everything + connection footer + collapse-to-mini toggle.

import { useEffect, useRef, useState } from 'react';

interface ZeusPluginApi {
    registerPanel(spec: { id: string; component: React.ComponentType }): void;
    callBackend(method: string, path: string, body?: unknown): Promise<Response>;
}
interface MemoryEntry {
    slot: number; network: string; freqMhz: number;
    inductanceUh: number; capacitancePf: number; band: string;
}
interface Atr1000Status {
    configured: boolean; host: string; isConnected: boolean; version: string;
    forwardPowerW: number; maxForwardW: number; swr: number;
    isTuning: boolean; tuneMode: number;
    isBypassed: boolean; network: string;
    indCode: number; capCode: number; inductanceUh: number; capacitancePf: number;
    memorySlot: number; memoryMax: number; memoryFreqMhz: number;
    memories: MemoryEntry[]; autoTune: boolean; autoCarrier: boolean;
    radioFreqMhz?: number | null; radioBand?: string | null; radioMox?: boolean | null;
}

const css = `
.atr{font-family:'Archivo Narrow',system-ui,sans-serif;color:#d8dde6;padding:10px}
.atr-h{display:flex;align-items:center;gap:7px;margin-bottom:8px}
.atr-title{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#b6c0d0;flex:1}
.atr-dot{width:8px;height:8px;border-radius:50%;flex:none;cursor:default}
.atr-dot.on{background:#5cd479;box-shadow:0 0 5px #5cd479}
.atr-dot.off{background:#444c5c}
.atr-dot.tuning{background:#ffc93a;box-shadow:0 0 5px #ffc93a;animation:atr-pulse 600ms ease-in-out infinite}
@keyframes atr-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes atr-sweep{0%{left:-40%;width:40%}50%{left:30%;width:60%}100%{left:100%;width:40%}}
.atr-tuning-bar{position:relative;height:2px;background:#2a2e38;border-radius:1px;overflow:hidden;margin-bottom:7px}
.atr-tuning-bar-fill{position:absolute;top:0;height:100%;background:rgba(255,201,58,.75);border-radius:1px;animation:atr-sweep 1.4s ease-in-out infinite}
.atr-tuning-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#ffc93a;margin-bottom:4px;opacity:.85}
.atr-band{font-size:10px;color:#5cd479;letter-spacing:.04em}

/* meters */
.atr-meters{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
.atr-meter{background:#1e242e;border:1px solid #2c333f;border-radius:6px;padding:6px 8px}
.atr-ml{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#7e879a;margin-bottom:2px}
.atr-mv{font-family:ui-monospace,monospace;font-size:22px;font-weight:700;color:#e6ebf3}
.atr-mv.blue{color:#4a9eff}.atr-mv.amber{color:#ffc93a}.atr-mv.red{color:#e63a2b}.atr-mv.dim{color:#404855}
.atr-ms{font-size:9px;color:#6c7484;margin-top:3px}
.atr-bar{height:4px;background:#141820;border-radius:2px;overflow:hidden;margin-top:4px}
.atr-bar-fill{height:100%;transition:width 180ms ease}

/* buttons */
.btn{padding:6px 8px;font-size:11px;font-weight:600;letter-spacing:.02em;background:#252d3a;color:#c8cfdb;border:1px solid #353c4c;border-radius:6px;cursor:pointer;transition:all 120ms;white-space:nowrap}
.btn:hover:not(:disabled){background:#2e3849}
.btn:disabled{opacity:.35;cursor:not-allowed}
.btn.blue{background:rgba(74,158,255,.16);color:#4a9eff;border-color:rgba(74,158,255,.32)}
.btn.blue:hover:not(:disabled){background:rgba(74,158,255,.26)}
.btn.green{background:rgba(92,212,121,.18);color:#5cd479;border-color:rgba(92,212,121,.4)}
.btn.amber{background:rgba(255,201,58,.18);color:#ffc93a;border-color:rgba(255,201,58,.4)}
.btn.active-reset{background:rgba(160,160,160,.22);color:#d0d4dc;border-color:rgba(160,160,160,.45)}
.btn.active-mem{background:rgba(74,158,255,.32);color:#7db8ff;border-color:rgba(74,158,255,.6);box-shadow:0 0 6px rgba(74,158,255,.25)}
.btn.active-full{background:rgba(74,158,255,.32);color:#7db8ff;border-color:rgba(74,158,255,.6);box-shadow:0 0 6px rgba(74,158,255,.25)}
.btn.active-fine{background:rgba(74,158,255,.32);color:#7db8ff;border-color:rgba(74,158,255,.6);box-shadow:0 0 6px rgba(74,158,255,.25)}
.btn.sm{padding:3px 6px;font-size:10px}
.btn.step{width:26px;height:26px;padding:0;font-size:15px;line-height:1;flex:none}
.btn.full{width:100%}
.btn.icon{padding:4px 7px;font-size:13px;line-height:1}

/* layout */
.lbl{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#6c7484;margin:9px 0 5px}
.g5{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.row{display:flex;align-items:center;gap:5px}

/* L/C */
.lc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:5px}
.lc-box{background:#1e242e;border:1px solid #2c333f;border-radius:6px;padding:5px 7px;display:flex;align-items:center;justify-content:space-between;gap:5px}
.lc-name{font-size:9px;color:#8a93a3}
.lc-val{font-family:ui-monospace,monospace;font-size:14px;font-weight:700;color:#d8dde6;text-align:center}
.lc-code{font-size:9px;color:#6c7484;text-align:center}

/* memory list */
.mem-list{margin-top:5px;max-height:150px;overflow-y:auto;border:1px solid #2c333f;border-radius:6px;background:#181e27}
.mem-row{display:flex;align-items:center;gap:5px;padding:4px 8px;border-bottom:1px solid #222932;cursor:pointer;transition:background 80ms}
.mem-row:last-child{border-bottom:none}
.mem-row:hover{background:#1e2738}
.mem-row.active{background:rgba(74,158,255,.1)}
.mem-slot{font-family:ui-monospace,monospace;font-size:11px;font-weight:700;color:#4a9eff;min-width:26px}
.mem-freq{font-family:ui-monospace,monospace;font-size:11px;color:#c8cfdb;min-width:70px}
.mem-band{font-size:10px;color:#8a93a3;min-width:30px}
.mem-lc{font-size:10px;color:#8a93a3;flex:1}
.mem-net{font-size:10px;color:#6c7484}
.mem-empty{padding:10px;color:#444c5c;font-size:11px;text-align:center}

/* footer */
.atr-footer{margin-top:10px;padding-top:8px;border-top:1px solid #252d3a}
.atr-footer-label{font-size:9px;letter-spacing:.10em;text-transform:uppercase;color:#444c5c;margin-bottom:5px}
.atr-conn{display:flex;gap:5px}
.atr-conn input{flex:1;padding:5px 7px;font-size:11px;background:#141820;color:#d8dde6;border:1px solid #2c333f;border-radius:6px;font-family:ui-monospace,monospace}
.atr-conn input:focus{outline:none;border-color:rgba(74,158,255,.5)}
.atr-conn input::placeholder{color:#444c5c}
.atr-ver{font-family:ui-monospace,monospace;font-size:10px;color:#444c5c;margin-top:4px}
.atr-rig{font-family:ui-monospace,monospace;font-size:10px;color:#6c7484;margin-top:6px}
.atr-rig .hi{color:#c8cfdb}
.atr-rig .tx{color:#e63a2b;font-weight:700}
`;

function swrClass(swr: number, live: boolean) {
    if (!live || swr <= 0) return 'dim';
    if (swr < 2) return 'blue';
    if (swr < 3) return 'amber';
    return 'red';
}
function swrBarColor(swr: number) {
    if (swr >= 3) return '#e63a2b';
    if (swr >= 2) return '#f6a400';
    return '#4a9eff';
}

// Tune button visual state.
// Memory (mode 1): green when active (instant recall, no carrier).
// Full/Fine (mode 2/3): blue when active (carrier + active tuning).
// Reset (mode 0): gray active state.
function tuneBtnClass(s: Atr1000Status | null, btnMode: number): string {
    const m = s?.tuneMode ?? 0;
    const isActive = m === btnMode;
    if (!isActive) {
        // inactive — default gray, except memory/full/fine get a subtle blue hint
        return btnMode === 0 ? '' : 'blue';
    }
    switch (btnMode) {
        case 0: return 'active-reset';
        case 1: return 'green';       // Memory: green = instant/good
        case 2: return 'active-full'; // Full: bright blue = tuning
        case 3: return 'active-fine'; // Fine: bright blue = tuning
        default: return 'blue';
    }
}

// ── Shared hook ───────────────────────────────────────────────────────────
function useAtr1000(api: ZeusPluginApi) {
    const [s, setS] = useState<Atr1000Status | null>(null);
    const [host, setHost] = useState('');
    const editing = useRef(false);

    useEffect(() => {
        let active = true;
        const poll = async () => {
            try {
                const res = await api.callBackend('GET', '/status');
                if (active && res.ok) {
                    const d: Atr1000Status = await res.json();
                    setS(d);
                    if (!editing.current && d.host) setHost(d.host);
                }
            } catch { if (active) setS(null); }
        };
        poll();
        const t = setInterval(poll, 500);
        return () => { active = false; clearInterval(t); };
    }, [api]);

    const connect = (ip: string) => {
        editing.current = false;
        void api.callBackend('POST', '/config', { host: ip.trim() });
    };
    const post = (path: string, body?: unknown) =>
        void api.callBackend('POST', path, body);

    return { s, host, setHost, editing, connect, post };
}

// ── Tuning indicator bar ──────────────────────────────────────────────────
function TuningBar({ active }: { active: boolean }) {
    if (!active) return null;
    return (
        <div style={{ marginBottom: 6 }}>
            <div className="atr-tuning-label">Tuning\u2026</div>
            <div className="atr-tuning-bar">
                <div className="atr-tuning-bar-fill" />
            </div>
        </div>
    );
}

// ── Meters (shared) ───────────────────────────────────────────────────────
function Meters({ s, showScale }: { s: Atr1000Status | null; showScale?: boolean }) {
    const live = (s?.forwardPowerW ?? 0) >= 1;
    const pwrPct = s && s.maxForwardW > 0 ? Math.min(100, (s.forwardPowerW / s.maxForwardW) * 100) : 0;
    const swrPct = s && s.swr > 0 ? Math.min(100, ((s.swr - 1) / 2) * 100) : 0;
    return (
        <div className="atr-meters">
            <div className="atr-meter">
                <div className="atr-ml">Fwd Power</div>
                <div className="atr-mv">{live ? `${s!.forwardPowerW} W` : '--'}</div>
                <div className="atr-bar">
                    <div className="atr-bar-fill" style={{ width:`${pwrPct}%`, background:'#4a9eff' }} />
                </div>
                {showScale && <div className="atr-ms">scale {s?.maxForwardW ?? 10} W</div>}
            </div>
            <div className="atr-meter">
                <div className="atr-ml">SWR</div>
                <div className={`atr-mv ${swrClass(s?.swr ?? 0, live)}`}>
                    {live && (s?.swr ?? 0) > 0 ? `${s!.swr.toFixed(2)}:1` : '--'}
                </div>
                <div className="atr-bar">
                    <div className="atr-bar-fill"
                        style={{ width:`${swrPct}%`, background:swrBarColor(s?.swr ?? 0) }} />
                </div>
                {showScale && <div className="atr-ms">{live ? '\u00a0' : 'no carrier'}</div>}
            </div>
        </div>
    );
}

// ── Connection footer ─────────────────────────────────────────────────────
function ConnFooter({ host, setHost, editing, connect, s, api }: {
    host: string; setHost: (v: string) => void;
    editing: React.MutableRefObject<boolean>;
    connect: (ip: string) => void;
    s: Atr1000Status | null; api: ZeusPluginApi;
}) {
    const [discovering, setDiscovering] = useState(false);
    const [found, setFound]             = useState<{ ip: string; version: string }[]>([]);
    const [discoverMsg, setDiscoverMsg] = useState('');
    const [customSubnet, setCustomSubnet] = useState('');

    const runDiscover = async (subnet?: string) => {
        setDiscovering(true); setFound([]); setDiscoverMsg('');
        try {
            const res = subnet
                ? await api.callBackend('POST', '/discover', { subnet: subnet.replace(/\.?$/, '.') })
                : await api.callBackend('GET', '/discover');
            if (!res.ok) { setDiscoverMsg(`Error ${res.status} — rebuild backend DLL`); return; }
            const d: { devices: { ip: string; version: string }[]; subnets?: string[]; error?: string } =
                await res.json();
            if (d.error) { setDiscoverMsg(d.error); return; }
            if (!d.devices?.length) {
                setDiscoverMsg(`No ATR-1000 found on ${d.subnets?.join(', ') ?? subnet ?? 'network'}`);
                return;
            }
            setFound(d.devices);
            if (d.devices.length === 1) {
                setHost(d.devices[0].ip); editing.current = false; connect(d.devices[0].ip);
            }
        } catch (e) { setDiscoverMsg(`${e}`); }
        finally { setDiscovering(false); }
    };

    const disconnect = () => {
        setHost(''); editing.current = false; setFound([]); setDiscoverMsg('');
        void api.callBackend('POST', '/config', { host: '' });
    };

    if (s?.configured && s.isConnected) {
        return (
            <div className="atr-footer">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="atr-dot on" />
                    <span style={{ fontFamily:'ui-monospace,monospace', fontSize:11,
                                   color:'#c8cfdb', flex:1 }}>
                        {s.host} &middot; fw {s.version} &middot; {s.memoryMax} slots
                    </span>
                    <button type="button" className="btn sm" onClick={disconnect}>Disconnect</button>
                </div>
            </div>
        );
    }

    return (
        <div className="atr-footer">
            <div className="atr-footer-label">
                {s?.configured && !s.isConnected ? 'Offline \u2014 reconnect' : 'Connection'}
            </div>
            <div className="atr-conn">
                <input value={host} placeholder="192.168.2.124"
                    onChange={e => { setHost(e.target.value); editing.current = true; }}
                    onKeyDown={e => e.key === 'Enter' && connect(host)} />
                <button type="button" className="btn blue" onClick={() => connect(host)}>
                    {s?.configured ? 'Reconnect' : 'Connect'}
                </button>
                <button type="button" className="btn" disabled={discovering}
                    onClick={() => runDiscover()}>
                    {discovering ? '\u2026' : 'Discover'}
                </button>
            </div>
            <div style={{ display:'flex', gap:5, marginTop:5 }}>
                <input value={customSubnet} placeholder="subnet, e.g. 10.0.1"
                    onChange={e => setCustomSubnet(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && customSubnet.trim() && runDiscover(customSubnet.trim())}
                    style={{ flex:1, padding:'4px 7px', fontSize:11, background:'#141820',
                             color:'#d8dde6', border:'1px solid #2c333f', borderRadius:6,
                             fontFamily:'ui-monospace,monospace' }} />
                <button type="button" className="btn sm"
                    disabled={discovering || !customSubnet.trim()}
                    onClick={() => runDiscover(customSubnet.trim())}>Scan</button>
            </div>
            {discoverMsg && !found.length && (
                <div style={{ fontSize:10, marginTop:4,
                               color: discoverMsg.startsWith('No') ? '#ffc93a' : '#e63a2b' }}>
                    {discoverMsg}
                </div>
            )}
            {found.length > 1 && found.map(d => (
                <div key={d.ip} style={{ display:'flex', alignItems:'center', gap:6,
                                         padding:'3px 0', borderBottom:'1px solid #1e242e', marginTop:4 }}>
                    <span style={{ fontFamily:'ui-monospace,monospace', fontSize:11, color:'#4a9eff', flex:1 }}>
                        {d.ip}
                    </span>
                    <span style={{ fontSize:10, color:'#6c7484' }}>{d.version}</span>
                    <button type="button" className="btn blue sm"
                        onClick={() => { setHost(d.ip); editing.current = false; connect(d.ip); }}>
                        Connect
                    </button>
                </div>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// COMPACT PANEL
// ══════════════════════════════════════════════════════════════════════════
function CompactPanel({ api }: { api: ZeusPluginApi }) {
    const { s, post } = useAtr1000(api);
    const connected = s?.configured && s.isConnected;
    const tuning    = s?.isTuning ?? false;

    return (
        <div className="atr">
            <style>{css}</style>

            {/* Just the dot — no title text */}
            <div className="atr-h" style={{ marginBottom:6 }}>
                <span className={`atr-dot ${tuning ? 'tuning' : connected ? 'on' : 'off'}`}
                      title={tuning ? 'Tuning…' : connected ? `Connected: ${s!.host}` : 'Not connected'} />
                {s?.autoTune && s.radioBand &&
                    <span className="atr-band" style={{ marginLeft:2 }}>
                        AUTO&thinsp;&middot;&thinsp;{s.radioBand}
                    </span>}
                {s?.radioMox && (
                    <span style={{ marginLeft:'auto', fontSize:10, color:'#e63a2b', fontWeight:700 }}>TX</span>
                )}
            </div>

            {/* Meters */}
            <TuningBar active={tuning} />
            <Meters s={s} />

            {/* Tune + Bypass row */}
            <div className="g5">
                <button type="button" className={`btn ${tuneBtnClass(s, 0)}`}
                    onClick={() => post('/tune', { mode:'reset' })}>Reset</button>
                <button type="button" className={`btn ${tuneBtnClass(s, 1)}`}
                    onClick={() => post('/tune', { mode:'memory' })}>{s?.memorySlot > 0 ? `M${s.memorySlot}` : 'Mem'}</button>
                <button type="button" className={`btn ${tuneBtnClass(s, 2)}`}
                    onClick={() => post('/tune', { mode:'full' })}>Full</button>
                <button type="button" className={`btn ${tuneBtnClass(s, 3)}`}
                    onClick={() => post('/tune', { mode:'fine' })}>Fine</button>
                <button type="button"
                    className={`btn ${s?.isBypassed ? 'amber' : 'green'}`}
                    title={s?.isBypassed ? 'Pass-through (click to put tuner inline)' : 'Tuner inline (click to bypass)'}
                    onClick={() => post('/bypass', { bypass: !s?.isBypassed })}>
                    {s?.isBypassed ? 'BYP' : 'INL'}
                </button>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// FULL PANEL
// ══════════════════════════════════════════════════════════════════════════
function FullPanel({ api }: { api: ZeusPluginApi }) {
    const { s, host, setHost, editing, connect, post } = useAtr1000(api);
    const [slotInput, setSlotInput] = useState('1');
    const editingSlot = useRef(false);
    const [saveFreq, setSaveFreq] = useState('');
    const editingFreq = useRef(false);

    useEffect(() => {
        if (!editingSlot.current && s && s.memorySlot > 0)
            setSlotInput(String(s.memorySlot));
        // Auto-fill frequency from rig when not manually overridden
        if (!editingFreq.current && s?.radioFreqMhz)
            setSaveFreq(s.radioFreqMhz.toFixed(3));
    }, [s?.memorySlot, s?.radioFreqMhz]);

    const slot   = Math.max(1, parseInt(slotInput || '1', 10) || 1);
    const tuning = s?.isTuning ?? false;

    return (
        <div className="atr">
            <style>{css}</style>

            <div className="atr-h">
                <span className={`atr-dot ${tuning ? 'tuning' : s?.configured && s.isConnected ? 'on' : 'off'}`}
                      title={tuning ? 'Tuning…' : s?.isConnected ? s!.host : 'Not connected'} />
                <span className="atr-title">ATR-1000</span>
                {s?.network &&
                    <span style={{ fontSize:10, color:'#6c7484' }}>{s.network}</span>}
                {s?.autoTune && s.radioBand &&
                    <span className="atr-band">AUTO&thinsp;&middot;&thinsp;{s.radioBand}</span>}
            </div>

            <TuningBar active={tuning} />
            <Meters s={s} showScale />

                {/* Tune */}
                <div className="lbl">Tune</div>
                <div className="g4">
                    <button type="button" className={`btn ${tuneBtnClass(s, 0)}`}
                        onClick={() => post('/tune', { mode:'reset' })}>Reset</button>
                    <button type="button" className={`btn ${tuneBtnClass(s, 1)}`}
                        onClick={() => post('/tune', { mode:'memory' })}>{s?.memorySlot > 0 ? `Memory M${s.memorySlot}` : 'Memory'}</button>
                    <button type="button" className={`btn ${tuneBtnClass(s, 2)}`}
                        title={s?.autoCarrier ? 'Full tune — carrier auto-keyed' : 'Full tune — key carrier manually'}
                        onClick={() => post('/tune', { mode:'full' })}>
                        Full{s?.autoCarrier ? ' \u26a1' : ''}
                    </button>
                    <button type="button" className={`btn ${tuneBtnClass(s, 3)}`}
                        title={s?.autoCarrier ? 'Fine tune — carrier auto-keyed' : 'Fine tune — key carrier manually'}
                        onClick={() => post('/tune', { mode:'fine' })}>
                        Fine{s?.autoCarrier ? ' \u26a1' : ''}
                    </button>
                </div>

                {/* Path / network */}
                <div className="lbl">Path / Network</div>
                <div className="g2">
                    <button type="button"
                        className={`btn ${s?.isBypassed ? 'amber' : 'green'}`}
                        onClick={() => post('/bypass', { bypass: !s?.isBypassed })}>
                        {s?.isBypassed ? 'Pass-through' : 'Tuner inline'}
                    </button>
                    <button type="button" className="btn"
                        onClick={() => post('/network',
                            { network: s?.network === 'LC' ? 'CL' : 'LC' })}>
                        Network: {s?.network ?? 'LC'}
                    </button>
                </div>

                {/* L/C */}
                <div className="lc-grid">
                    <div className="lc-box">
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL:-1, deltaC:0 })}>&#8722;</button>
                        <div style={{ textAlign:'center' }}>
                            <div className="lc-name">Inductance</div>
                            <div className="lc-val">{(s?.inductanceUh ?? 0).toFixed(2)} &micro;H</div>
                            <div className="lc-code">relay {s?.indCode ?? 0}</div>
                        </div>
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL:1, deltaC:0 })}>+</button>
                    </div>
                    <div className="lc-box">
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL:0, deltaC:-1 })}>&#8722;</button>
                        <div style={{ textAlign:'center' }}>
                            <div className="lc-name">Capacitance</div>
                            <div className="lc-val">{s?.capacitancePf ?? 0} pF</div>
                            <div className="lc-code">relay {s?.capCode ?? 0}</div>
                        </div>
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL:0, deltaC:1 })}>+</button>
                    </div>
                </div>

                {/* Memory list */}
                <div className="lbl" style={{ display:'flex', alignItems:'center',
                                              justifyContent:'space-between' }}>
                    <span>
                        Memory
                        {s?.memorySlot ? ` \u2014 M${s.memorySlot}` : ''}
                        {s?.memoryFreqMhz ? ` \u00b7 ${s.memoryFreqMhz.toFixed(3)} MHz` : ''}
                    </span>
                    <button type="button" className="btn sm"
                        onClick={() => post('/sync')}>&#x21bb;</button>
                </div>
                <div className="mem-list">
                    {!s?.memories.length
                        ? <div className="mem-empty">No data \u2014 click &#x21bb;</div>
                        : s.memories.map(m => (
                            <div key={m.slot}
                                className={`mem-row${m.slot === s.memorySlot ? ' active' : ''}`}
                                onClick={() => post('/memory/select', { slot: m.slot })}>
                                <span className="mem-slot">M{m.slot}</span>
                                <span className="mem-freq">
                                    {m.freqMhz > 0 ? `${m.freqMhz.toFixed(3)} MHz` : '\u2014'}
                                </span>
                                <span className="mem-band">{m.band || '\u2014'}</span>
                                <span className="mem-lc">
                                    {m.inductanceUh > 0 || m.capacitancePf > 0
                                        ? `${m.inductanceUh.toFixed(2)}\u03bcH  ${m.capacitancePf}pF`
                                        : 'empty'}
                                </span>
                                <span className="mem-net">{m.network}</span>
                            </div>
                        ))}
                </div>

                <div className="row" style={{ marginTop:5 }}>
                    <input type="number" min={1} max={s?.memoryMax ?? 20} value={slotInput}
                        style={{ width:50, padding:'4px 6px', fontSize:11, background:'#141820',
                                 color:'#d8dde6', border:'1px solid #2c333f', borderRadius:6,
                                 fontFamily:'ui-monospace,monospace', textAlign:'center' }}
                        onChange={e => { setSlotInput(e.target.value); editingSlot.current = true; }} />
                    <button type="button" className="btn blue" style={{ flex:1 }}
                        onClick={() => { post('/memory/select', { slot }); editingSlot.current = false; }}>
                        Apply M{slot}
                    </button>
                    <input type="number" step="0.001" min={1} max={30}
                        value={saveFreq}
                        title="Frequency to store with this memory slot (MHz)"
                        onChange={e => { setSaveFreq(e.target.value); editingFreq.current = true; }}
                        style={{ width:72, padding:'4px 6px', fontSize:11, background:'#141820',
                                 color:'#d8dde6', border:'1px solid #2c333f', borderRadius:6,
                                 fontFamily:'ui-monospace,monospace', textAlign:'center' }} />
                    <button type="button" className="btn green"
                        onClick={() => post('/memory/save', {
                            slot,
                            freqKhz: Math.round(parseFloat(saveFreq || '0') * 1000)
                        })}>Save</button>
                    <button type="button" className="btn"
                        onClick={() => post('/memory/reset')}>Undo</button>
                </div>

                {/* Auto-tune */}
                <div className="lbl">Auto-tune on band change</div>
                <button type="button"
                    className={`btn full ${s?.autoTune ? 'green' : ''}`}
                    onClick={() => post('/options', { autoTune: !s?.autoTune })}>
                    {s?.autoTune
                        ? '\u2713 Enabled \u2014 recalls memory on band change (TX off)'
                        : 'Disabled \u2014 click to enable'}
                </button>

                {/* Rig */}
                {s?.radioFreqMhz != null && (
                    <div className="atr-rig">
                        Rig: <span className="hi">{s.radioFreqMhz.toFixed(3)} MHz</span>
                        {s.radioBand && <span> &middot; {s.radioBand}</span>}
                        {s.radioMox && <span className="tx"> &middot; TX</span>}
                    </div>
                )}

                <ConnFooter host={host} setHost={setHost} editing={editing}
                    connect={connect} s={s} api={api} />
        </div>
    );
}

export default function register(api: ZeusPluginApi) {
    api.registerPanel({
        id: 'atr1000.compact',
        component: (props: object) => <CompactPanel api={api} {...props} />,
    });
    api.registerPanel({
        id: 'atr1000.main',
        component: (props: object) => <FullPanel api={api} {...props} />,
    });
}
