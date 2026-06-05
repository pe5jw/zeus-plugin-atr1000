// SPDX-License-Identifier: GPL-2.0-or-later
//
// Openhpsdr-Zeus UI panel — Antuner ATR-1000 tuner plugin.
// Compiled by Vite to ui/atr1000.es.js (loaded by Zeus at runtime).
// React + react-dom are externalised (provided by the Zeus host shell).

import { useEffect, useState } from 'react';

interface ZeusPluginApi {
    registerPanel(spec: { id: string; component: React.ComponentType }): void;
    callBackend(method: string, path: string, body?: unknown): Promise<Response>;
}

interface MemoryEntry {
    slot: number;
    network: string;
    freqMhz: number;
    inductanceUh: number;
    capacitancePf: number;
    band: string;
}

interface Atr1000Status {
    configured: boolean;
    host: string;
    isConnected: boolean;
    version: string;
    forwardPowerW: number;
    maxForwardW: number;
    swr: number;
    isBypassed: boolean;
    network: string;
    indCode: number;
    capCode: number;
    inductanceUh: number;
    capacitancePf: number;
    memorySlot: number;
    memoryMax: number;
    memoryFreqMhz: number;
    memories: MemoryEntry[];
    autoTune: boolean;
    radioFreqMhz?: number | null;
    radioBand?: string | null;
    radioMox?: boolean | null;
}

// ── Styles ────────────────────────────────────────────────────────────────

const css = `
.atr { font-family:'Archivo Narrow',system-ui,sans-serif; color:#d8dde6; padding:12px; }
.atr h3 { margin:0 0 10px; font-size:14px; letter-spacing:.04em; text-transform:uppercase;
          color:#b6c0d0; display:flex; align-items:center; gap:8px; }
.atr-dot { width:8px; height:8px; border-radius:50%; flex:none; }
.atr-dot.on  { background:#5cd479; box-shadow:0 0 6px #5cd479; }
.atr-dot.off { background:#e63a2b; }

.atr-empty { text-align:center; padding:24px 12px; color:#8a93a3; }
.atr-empty strong { color:#d8dde6; display:block; margin-bottom:6px; }
.atr-info { font-family:ui-monospace,monospace; font-size:11px; color:#8a93a3; margin-bottom:10px;
            display:flex; flex-wrap:wrap; align-items:center; }
.atr-info .hi  { color:#c8cfdb; font-weight:600; }
.atr-info .sep { margin:0 6px; opacity:.5; }

.atr-host { display:flex; gap:6px; margin-bottom:12px; }
.atr-host input { flex:1; padding:6px 8px; font-size:12px; background:#1a1f27; color:#d8dde6;
  border:1px solid #353c4c; border-radius:6px; font-family:ui-monospace,monospace; }
.atr-host input:focus { outline:none; border-color:rgba(74,158,255,.6); }

.btn { padding:6px 8px; font-size:11px; font-weight:600; letter-spacing:.02em;
  background:#2a3140; color:#c8cfdb; border:1px solid #353c4c; border-radius:6px;
  cursor:pointer; transition:background 120ms,border-color 120ms; white-space:nowrap; }
.btn:hover:not(:disabled) { background:#333b4d; }
.btn:disabled { opacity:.4; cursor:not-allowed; }
.btn.blue  { background:rgba(74,158,255,.18);  color:#4a9eff; border-color:rgba(74,158,255,.35); }
.btn.blue:hover:not(:disabled)  { background:rgba(74,158,255,.28); }
.btn.green { background:rgba(92,212,121,.18);  color:#5cd479; border-color:rgba(92,212,121,.35); }
.btn.amber { background:rgba(255,201,58,.18);  color:#ffc93a; border-color:rgba(255,201,58,.35); }
.btn.sm    { padding:4px 6px; font-size:10px; }
.btn.step  { width:26px; height:26px; padding:0; font-size:15px; line-height:1; flex:none; }

.lbl { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#7e879a; margin:10px 0 5px; }
.g4  { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
.g2  { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.row { display:flex; align-items:center; gap:6px; }

.meters { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.meter     { background:#20262f; border:1px solid #2c333f; border-radius:6px; padding:6px 8px; }
.meter-lbl { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#7e879a; margin-bottom:2px; }
.meter-val { font-family:ui-monospace,monospace; font-size:21px; font-weight:700; color:#e6ebf3; }
.meter-val.blue  { color:#4a9eff; }
.meter-val.amber { color:#ffc93a; }
.meter-val.red   { color:#e63a2b; }
.meter-val.dim   { color:#505866; }
.meter-sub { font-size:9px; color:#6c7484; margin-top:3px; }
.bar      { height:4px; background:#1a1f27; border-radius:2px; overflow:hidden; margin-top:4px; }
.bar-fill { height:100%; transition:width 200ms ease; }

.lc-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px; }
.lc-box  { background:#20262f; border:1px solid #2c333f; border-radius:6px; padding:6px 8px;
           display:flex; align-items:center; justify-content:space-between; gap:6px; }
.lc-name { font-size:10px; color:#8a93a3; }
.lc-val  { font-family:ui-monospace,monospace; font-size:15px; font-weight:700;
           color:#d8dde6; text-align:center; }
.lc-code { font-size:9px; color:#6c7484; text-align:center; }

.mem-list  { margin-top:6px; max-height:180px; overflow-y:auto; border:1px solid #2c333f;
             border-radius:6px; background:#1a1f27; }
.mem-row   { display:flex; align-items:center; gap:6px; padding:5px 8px;
             border-bottom:1px solid #2c333f; cursor:pointer; transition:background 100ms; }
.mem-row:last-child  { border-bottom:none; }
.mem-row:hover       { background:#232b38; }
.mem-row.active      { background:rgba(74,158,255,.1); }
.mem-slot { font-family:ui-monospace,monospace; font-size:11px; font-weight:700;
            color:#4a9eff; min-width:28px; }
.mem-freq { font-family:ui-monospace,monospace; font-size:11px; color:#c8cfdb; min-width:72px; }
.mem-band { font-size:10px; color:#8a93a3; min-width:32px; }
.mem-lc   { font-size:10px; color:#8a93a3; flex:1; }
.mem-net  { font-size:10px; color:#7e879a; }
.mem-empty { padding:10px 12px; color:#505866; font-size:11px; text-align:center; }

.rig     { font-family:ui-monospace,monospace; font-size:11px; color:#8a93a3; margin-top:10px; }
.rig .hi { color:#c8cfdb; }
.rig .tx { color:#e63a2b; font-weight:700; }
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

// ── Panel ─────────────────────────────────────────────────────────────────

function Atr1000Panel({ api }: { api: ZeusPluginApi }) {
    const [s, setS] = useState<Atr1000Status | null>(null);
    const [hostInput, setHostInput] = useState('');
    const [editingHost, setEditingHost] = useState(false);
    const [slotInput, setSlotInput] = useState('1');
    const [editingSlot, setEditingSlot] = useState(false);

    // Poll at 500 ms — matches the device's meter push rate.
    useEffect(() => {
        let active = true;
        const poll = async () => {
            try {
                const res = await api.callBackend('GET', '/status');
                if (active && res.ok) {
                    const d: Atr1000Status = await res.json();
                    setS(d);
                    if (!editingHost && d.host) setHostInput(d.host);
                    if (!editingSlot && d.memorySlot > 0) setSlotInput(String(d.memorySlot));
                }
            } catch { if (active) setS(null); }
        };
        poll();
        const t = setInterval(poll, 500);
        return () => { active = false; clearInterval(t); };
    }, [api, editingHost, editingSlot]);

    const post = (path: string, body?: unknown) => { void api.callBackend('POST', path, body); };
    const connectHost = () => { post('/config', { host: hostInput.trim() }); setEditingHost(false); };
    const slot = Math.max(1, parseInt(slotInput || '1', 10) || 1);

    if (!s) return (
        <div className="atr">
            <style>{css}</style>
            <h3>ATR-1000</h3>
            <div className="atr-empty">Connecting…</div>
        </div>
    );

    const live = s.forwardPowerW >= 1;
    const pwrPct = s.maxForwardW > 0 ? Math.min(100, (s.forwardPowerW / s.maxForwardW) * 100) : 0;
    const swrPct = s.swr > 0 ? Math.min(100, ((s.swr - 1) / 2) * 100) : 0;

    return (
        <div className="atr">
            <style>{css}</style>

            <h3>
                <span className={`atr-dot ${s.configured && s.isConnected ? 'on' : 'off'}`} />
                ATR-1000
                {s.autoTune && s.radioBand && (
                    <span style={{ fontSize: 9, color: '#5cd479', marginLeft: 'auto',
                                   letterSpacing: '.04em' }}>
                        AUTO · {s.radioBand}
                    </span>
                )}
            </h3>

            {/* Host */}
            <div className="atr-host">
                <input value={hostInput} placeholder="tuner IP — e.g. 192.168.2.124"
                    onChange={e => { setHostInput(e.target.value); setEditingHost(true); }}
                    onKeyDown={e => e.key === 'Enter' && connectHost()} />
                <button type="button" className="btn blue" onClick={connectHost}>
                    {s.configured ? 'Reconnect' : 'Connect'}
                </button>
            </div>

            {!s.configured && (
                <div className="atr-empty">
                    <strong>Enter the tuner's IP address to begin</strong>
                    LAN: DHCP address · Hotspot mode: 10.13.37.2
                </div>
            )}

            {s.configured && (<>

                <div className="atr-info">
                    <span className="hi">{s.host}</span>
                    <span className="sep">|</span>
                    <span>v{s.version || '?'}</span>
                    <span className="sep">|</span>
                    <span>{s.network}</span>
                    {s.memorySlot > 0 && (<>
                        <span className="sep">|</span>
                        <span className="hi">M{s.memorySlot}</span>
                        {s.memoryFreqMhz > 0 &&
                            <span>&nbsp;{s.memoryFreqMhz.toFixed(3)} MHz</span>}
                    </>)}
                </div>

                {/* Meters */}
                <div className="meters">
                    <div className="meter">
                        <div className="meter-lbl">Fwd Power</div>
                        <div className="meter-val">{live ? `${s.forwardPowerW} W` : '--'}</div>
                        <div className="bar">
                            <div className="bar-fill"
                                style={{ width: `${pwrPct}%`, background: '#4a9eff' }} />
                        </div>
                        <div className="meter-sub">scale {s.maxForwardW} W</div>
                    </div>
                    <div className="meter">
                        <div className="meter-lbl">SWR</div>
                        <div className={`meter-val ${swrClass(s.swr, live)}`}>
                            {live && s.swr > 0 ? `${s.swr.toFixed(2)}:1` : '--'}
                        </div>
                        <div className="bar">
                            <div className="bar-fill"
                                style={{ width: `${swrPct}%`, background: swrBarColor(s.swr) }} />
                        </div>
                        <div className="meter-sub">{live ? '\u00a0' : 'no carrier'}</div>
                    </div>
                </div>

                {/* Tune */}
                <div className="lbl">Tune</div>
                <div className="g4">
                    <button type="button" className="btn"
                        onClick={() => post('/tune', { mode: 'reset' })}>Reset</button>
                    <button type="button" className="btn blue"
                        onClick={() => post('/tune', { mode: 'memory' })}>Memory</button>
                    <button type="button" className="btn blue"
                        onClick={() => post('/tune', { mode: 'full' })}>Full</button>
                    <button type="button" className="btn blue"
                        onClick={() => post('/tune', { mode: 'fine' })}>Fine</button>
                </div>

                {/* Path / network */}
                <div className="lbl">Path / Network</div>
                <div className="g2">
                    <button type="button"
                        className={`btn ${s.isBypassed ? 'amber' : 'green'}`}
                        onClick={() => post('/bypass', { bypass: !s.isBypassed })}>
                        {s.isBypassed ? 'Pass-through' : 'Tuner inline'}
                    </button>
                    <button type="button" className="btn"
                        onClick={() => post('/network',
                            { network: s.network === 'LC' ? 'CL' : 'LC' })}>
                        Network: {s.network}
                    </button>
                </div>

                {/* L / C */}
                <div className="lc-grid">
                    <div className="lc-box">
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL: -1, deltaC: 0 })}>−</button>
                        <div style={{ textAlign: 'center' }}>
                            <div className="lc-name">Inductance</div>
                            <div className="lc-val">{s.inductanceUh.toFixed(2)} µH</div>
                            <div className="lc-code">relay {s.indCode}</div>
                        </div>
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL: 1, deltaC: 0 })}>+</button>
                    </div>
                    <div className="lc-box">
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL: 0, deltaC: -1 })}>−</button>
                        <div style={{ textAlign: 'center' }}>
                            <div className="lc-name">Capacitance</div>
                            <div className="lc-val">{s.capacitancePf} pF</div>
                            <div className="lc-code">relay {s.capCode}</div>
                        </div>
                        <button type="button" className="btn step"
                            onClick={() => post('/lc', { deltaL: 0, deltaC: 1 })}>+</button>
                    </div>
                </div>

                {/* Memory list */}
                <div className="lbl" style={{ display: 'flex', alignItems: 'center',
                                              justifyContent: 'space-between' }}>
                    <span>Memory — {s.memoryMax} slots</span>
                    <button type="button" className="btn sm"
                        onClick={() => post('/sync')}
                        title="Re-sync memory list from device">&#x21bb; Refresh</button>
                </div>

                <div className="mem-list">
                    {s.memories.length === 0
                        ? <div className="mem-empty">No memory data yet — click Refresh</div>
                        : s.memories.map(m => (
                            <div key={m.slot}
                                className={`mem-row${m.slot === s.memorySlot ? ' active' : ''}`}
                                title={`Apply M${m.slot}`}
                                onClick={() => post('/memory/select', { slot: m.slot })}>
                                <span className="mem-slot">M{m.slot}</span>
                                <span className="mem-freq">
                                    {m.freqMhz > 0
                                        ? `${m.freqMhz.toFixed(3)} MHz`
                                        : '\u2014 MHz'}
                                </span>
                                <span className="mem-band">{m.band || '\u2014'}</span>
                                <span className="mem-lc">
                                    {m.inductanceUh > 0 || m.capacitancePf > 0
                                        ? `${m.inductanceUh.toFixed(2)}\u00b5H  ${m.capacitancePf}pF`
                                        : 'empty'}
                                </span>
                                <span className="mem-net">{m.network}</span>
                            </div>
                        ))
                    }
                </div>

                {/* Memory controls */}
                <div className="row" style={{ marginTop: 6 }}>
                    <input type="number" min={1} max={s.memoryMax || 99}
                        value={slotInput}
                        style={{ width: 54, padding: '5px 6px', fontSize: 12,
                                 background: '#1a1f27', color: '#d8dde6',
                                 border: '1px solid #353c4c', borderRadius: 6,
                                 fontFamily: 'ui-monospace,monospace', textAlign: 'center' }}
                        onChange={e => { setSlotInput(e.target.value); setEditingSlot(true); }} />
                    <button type="button" className="btn blue" style={{ flex: 1 }}
                        onClick={() => { post('/memory/select', { slot }); setEditingSlot(false); }}>
                        Apply M{slot}
                    </button>
                    <button type="button" className="btn green"
                        onClick={() => post('/memory/save')}>Save</button>
                    <button type="button" className="btn"
                        onClick={() => post('/memory/reset')}>Undo</button>
                </div>

                {/* Auto-tune toggle */}
                <div className="lbl">Auto-tune on band change</div>
                <button type="button"
                    className={`btn ${s.autoTune ? 'green' : ''}`}
                    style={{ width: '100%' }}
                    onClick={() => post('/options', { autoTune: !s.autoTune })}>
                    {s.autoTune
                        ? '\u2713 Enabled \u2014 recalls best memory on band change (TX off)'
                        : 'Disabled \u2014 click to enable'}
                </button>

                {/* Rig context (ReadRadioState) */}
                {s.radioFreqMhz != null && (
                    <div className="rig">
                        Rig:&nbsp;
                        <span className="hi">{s.radioFreqMhz.toFixed(3)} MHz</span>
                        {s.radioBand && <span> · {s.radioBand}</span>}
                        {s.radioMox && <span className="tx"> · TX</span>}
                    </div>
                )}

            </>)}
        </div>
    );
}

export default function register(api: ZeusPluginApi) {
    api.registerPanel({
        id: 'atr1000.main',
        component: (props: object) => <Atr1000Panel api={api} {...props} />,
    });
}
