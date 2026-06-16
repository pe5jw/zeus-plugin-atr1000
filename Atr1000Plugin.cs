// SPDX-License-Identifier: GPL-2.0-or-later
// Requires Zeus SDK 1.2.0 (Zeus v0.9.0+) — uses IRadioStateReader and IRadioController.
//
// Antuner ATR-1000 plugin for Openhpsdr-Zeus.
//
// The ATR-1000 is a 1 kW HF (1.8–30 MHz) automatic antenna tuner with a WiFi
// web interface. Control is a BINARY protocol over a WebSocket on port 60001
// (path "/"), decoded from the device's own web app (inline.js).
//
// FRAME LAYOUT (both directions)
//   byte 0 : 0xFF                     (SCMD_FLAG)
//   byte 1 : command code             (SCMD_*)
//   byte 2 : payload length           (= total bytes - 3)
//   byte 3+: payload                  (little-endian integers)
//
// HANDSHAKE  : device is silent until the client sends SYNC (FF 01 00).
// KEEPALIVE  : device sends TEST (254); client must answer TEST_REPLAY (FF FD 00).

using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using Zeus.Plugins.Contracts;
using Zeus.Plugins.Contracts.Extensions;

namespace Openhpsdr.Zeus.Plugins.Atr1000;

public sealed class Atr1000Plugin : IZeusPlugin, IBackendPlugin
{
    private const string HostKey = "host";
    private const string WsPortKey = "wsPort";
    private const string WsPathKey = "wsPath";
    private const string AutoTuneKey = "autoTune";
    private const int DefaultWsPort = 60001;
    private const string DefaultWsPath = "/";

    private IPluginContext? _ctx;
    private CancellationTokenSource? _cts;
    private Atr1000Connection? _conn;
    private readonly SemaphoreSlim _connGate = new(1, 1);

    // Radio controller (ControlRadio capability) — used to key TX for Full/Fine tune.
    private IRadioController? _radioController;

    // HttpClient for calling Zeus internal endpoints (e.g. /api/tx/tun).
    private static readonly HttpClient _http = new();
    private string _zeusBaseUrl = "http://localhost:6060";

    // Auto-tune-on-band-change state.
    private bool _autoTune;
    private Action<long>? _freqHandler;
    private Action<bool>? _moxHandler;
    private string _lastBand = "";
    private Timer? _bandDebounce;


    public async Task InitializeAsync(IPluginContext context, CancellationToken ct)
    {
        _ctx = context;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        var host = await context.Settings.GetAsync<string>(HostKey, ct);
        var wsPort = await context.Settings.GetAsync<int?>(WsPortKey, ct) ?? DefaultWsPort;
        var wsPath = await context.Settings.GetAsync<string>(WsPathKey, ct) ?? DefaultWsPath;
        _autoTune = await context.Settings.GetAsync<bool?>(AutoTuneKey, ct) ?? false;

        _radioController = context.RadioController;

        // Subscribe to rig frequency and MOX if ReadRadioState was granted.
        if (context.Radio is { } radio)
        {
            _freqHandler = OnFrequencyChanged;
            radio.FrequencyChanged += _freqHandler;
            _lastBand = Bands.FromMhz(radio.FrequencyHz / 1_000_000.0);

            _moxHandler = OnMoxChanged;
            radio.MoxChanged += _moxHandler;

        }

        if (!string.IsNullOrWhiteSpace(host))
        {
            context.Logger.LogInformation(
                "ATR-1000: starting; saved endpoint = ws://{Host}:{Port}{Path}", host, wsPort, wsPath);
            StartConnection(host!, wsPort, wsPath);
        }
        else
        {
            context.Logger.LogInformation(
                "ATR-1000: no host configured yet. Set one via POST /api/plugins/{Id}/config.",
                context.PluginId);
        }
    }

    public async Task ShutdownAsync(CancellationToken ct)
    {
        _cts?.Cancel();

        if (_ctx?.Radio is { } radio)
        {
            if (_freqHandler is { } h)  radio.FrequencyChanged -= h;
            if (_moxHandler  is { } mh) radio.MoxChanged       -= mh;
        }
        _bandDebounce?.Dispose();

        await _connGate.WaitAsync(ct);
        try
        {
            if (_conn is { } c)
                await c.DisposeAsync();
            _conn = null;
        }
        finally
        {
            _connGate.Release();
        }
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("status", GetStatus);
        endpoints.MapGet("config", GetConfig);
        endpoints.MapPost("config", SetConfig);
        endpoints.MapPost("options", SetOptions);

        endpoints.MapPost("tune",   Tune);
        endpoints.MapPost("bypass", SetBypass);
        endpoints.MapPost("network", SetNetwork);
        endpoints.MapPost("lc", AdjustLc);
        endpoints.MapPost("memory/select", MemorySelect);
        endpoints.MapPost("memory/save", MemorySave);
        endpoints.MapPost("memory/reset", MemoryReset);
        endpoints.MapPost("sync", Sync);
        endpoints.MapPost("restart", RestartDevice);

        // Discovery endpoints
        endpoints.MapGet("subnets",       GetSubnets);
        endpoints.MapGet("discover",      DiscoverAll);      // scan all auto-detected subnets
        endpoints.MapPost("discover",     DiscoverSubnet);   // body: { "subnet": "192.168.2." }
    }

    // ── HTTP handlers ─────────────────────────────────────────────────────

    private IResult GetStatus()
    {
        var conn = _conn;
        if (conn is null)
            return Results.Ok(Atr1000StatusDto.Unconfigured() with { AutoTune = _autoTune });

        var dto = conn.GetStatus() with { AutoTune = _autoTune, AutoCarrier = _radioController is not null };

        if (_ctx?.Radio is { } radio)
        {
            dto = dto with
            {
                RadioFreqMhz = Math.Round(radio.FrequencyHz / 1_000_000.0, 6),
                RadioBand = radio.Band,
                RadioMox = radio.Mox,
            };
        }

        return Results.Ok(dto);
    }

    private async Task<IResult> GetConfig()
    {
        var host = await (_ctx?.Settings.GetAsync<string>(HostKey) ?? Task.FromResult<string?>(null));
        var wsPort = await (_ctx?.Settings.GetAsync<int?>(WsPortKey) ?? Task.FromResult<int?>(null)) ?? DefaultWsPort;
        var wsPath = await (_ctx?.Settings.GetAsync<string>(WsPathKey) ?? Task.FromResult<string?>(null))
                     ?? DefaultWsPath;
        return Results.Ok(new ConfigDto(host ?? "", wsPort, wsPath, _autoTune));
    }

    private async Task<IResult> SetConfig(ConfigDto req)
    {
        var host = (req.Host ?? "").Trim();
        var wsPort = req.WsPort > 0 ? req.WsPort : DefaultWsPort;
        var wsPath = string.IsNullOrWhiteSpace(req.WsPath) ? DefaultWsPath : req.WsPath!.Trim();
        if (!wsPath.StartsWith('/')) wsPath = "/" + wsPath;

        if (_ctx?.Settings is { } s)
        {
            await s.SetAsync(HostKey, host);
            await s.SetAsync(WsPortKey, wsPort);
            await s.SetAsync(WsPathKey, wsPath);
        }

        await _connGate.WaitAsync();
        try
        {
            if (_conn is { } old) await old.DisposeAsync();
            _conn = null;
        }
        finally { _connGate.Release(); }

        if (!string.IsNullOrWhiteSpace(host))
        {
            _ctx?.Logger.LogInformation(
                "ATR-1000: endpoint ws://{Host}:{Port}{Path}; connecting…", host, wsPort, wsPath);
            StartConnection(host, wsPort, wsPath);
        }

        return Results.Ok(new ConfigDto(host, wsPort, wsPath, _autoTune));
    }

    private async Task<IResult> SetOptions(OptionsRequest req)
    {
        _autoTune = req.AutoTune;
        if (_ctx?.Settings is { } s)
            await s.SetAsync(AutoTuneKey, _autoTune);
        _ctx?.Logger.LogInformation("ATR-1000: auto-tune on band change = {On}", _autoTune);
        return Results.Ok(new { autoTune = _autoTune });
    }

    private async Task<IResult> Tune(TuneRequest req)
    {
        if (_conn is not { } c) return NotConnected();
        var mode = (req.Mode ?? "memory").ToLowerInvariant();
        if (mode is not ("memory" or "full" or "fine" or "reset"))
            return Results.BadRequest(new { error = "mode must be memory|full|fine|reset" });

        await c.TuneAsync(mode);

        // Full and Fine need a carrier to measure SWR.
        // Key TX automatically if ControlRadio was granted and radio is not already TX.
        if (mode is "full" or "fine")
        {
            if (_radioController is { } rc && (_ctx?.Radio is not { Mox: true }))
            {
                _ = KeyCarrierForTuneAsync(rc, c, CancellationToken.None);
            }
        }

        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    // Key Zeus's built-in TUN carrier via POST /api/tx/tun.
    // This uses TxTuneDriver (clean single-tone, full tune-drive power, no mic)
    // which is exactly what the Zeus Tune button does internally.
    // Safety timeout: 30 seconds maximum carrier.
    private async Task KeyCarrierForTuneAsync(IRadioController rc,
        Atr1000Connection conn, CancellationToken ct)
    {
        try
        {
            await SetZeusTunAsync(true, ct);
            _ctx?.Logger.LogInformation("ATR-1000: TUN carrier ON for tune");

            // Poll until the device reports isTuning=false (done) or timeout.
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
            {
                await Task.Delay(200, ct);
                if (!conn.IsTuning) break;
            }
        }
        catch (Exception ex)
        {
            _ctx?.Logger.LogWarning(ex, "ATR-1000: TUN carrier error");
        }
        finally
        {
            try { await SetZeusTunAsync(false, CancellationToken.None); }
            catch { /* ignore */ }
            _ctx?.Logger.LogInformation("ATR-1000: TUN carrier OFF after tune");
        }
    }

    private async Task SetZeusTunAsync(bool on, CancellationToken ct)
    {
        var url = $"{_zeusBaseUrl}/api/tx/tun";
        var body = new StringContent(
            System.Text.Json.JsonSerializer.Serialize(new { on }),
            System.Text.Encoding.UTF8,
            "application/json");
        var resp = await _http.PostAsync(url, body, ct);
        resp.EnsureSuccessStatusCode();
        _ctx?.Logger.LogDebug("ATR-1000: POST /api/tx/tun on={On} -> {Status}", on, resp.StatusCode);
    }

    private async Task<IResult> SetBypass(BypassRequest req)
    {
        if (_conn is not { } c) return NotConnected();
        await c.SetBypassAsync(req.Bypass);
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> SetNetwork(NetworkRequest req)
    {
        if (_conn is not { } c) return NotConnected();
        var net = (req.Network ?? "").ToUpperInvariant();
        if (net is not ("LC" or "CL"))
            return Results.BadRequest(new { error = "network must be LC or CL" });
        await c.SetNetworkAsync(net);
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> AdjustLc(LcRequest req)
    {
        if (_conn is not { } c) return NotConnected();
        await c.AdjustLcAsync(req.DeltaL, req.DeltaC);
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> MemorySelect(MemoryRequest req)
    {
        if (_conn is not { } c) return NotConnected();
        await c.MemorySelectAsync(req.Slot);
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> MemorySave(MemorySaveRequest? req)
    {
        if (_conn is not { } c) return NotConnected();
        int slot = req?.Slot ?? 0;
        // Use frequency from UI request first; fall back to rig frequency.
        int freqKhz = req?.FreqKhz ?? 0;
        if (freqKhz <= 0 && _ctx?.Radio is { } radio && radio.FrequencyHz > 0)
            freqKhz = (int)Math.Round(radio.FrequencyHz / 1000.0);
        await c.MemorySaveAsync(slot, freqKhz);
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> MemoryReset()
    {
        if (_conn is not { } c) return NotConnected();
        await c.MemoryResetAsync();
        return Results.Ok(c.GetStatus() with { AutoTune = _autoTune });
    }

    private async Task<IResult> Sync()
    {
        if (_conn is not { } c) return NotConnected();
        await c.SendSyncAsync();
        return Results.Ok(new { ok = true });
    }

    private async Task<IResult> RestartDevice()
    {
        if (_conn is not { } c) return NotConnected();
        await c.RestartDeviceAsync();
        return Results.Ok(new { ok = true });
    }

    private static IResult NotConnected()
        => Results.BadRequest(new { error = "ATR-1000 not configured. Set a host first (POST /config)." });

    // ── Discovery ─────────────────────────────────────────────────────────

    private IResult GetSubnets()
    {
        try
        {
            var subnets = GetLocalSubnets();
            return Results.Ok(new { subnets });
        }
        catch (Exception ex)
        {
            _ctx?.Logger.LogWarning(ex, "ATR-1000: GetSubnets failed");
            return Results.Ok(new { subnets = Array.Empty<string>() });
        }
    }

    private sealed record DiscoverRequest(string? Subnet);

    // GET /discover — scan all auto-detected subnets
    private async Task<IResult> DiscoverAll(CancellationToken ct)
        => await RunDiscover(null, ct);

    // POST /discover — scan a specific subnet from body { "subnet": "192.168.2." }
    private async Task<IResult> DiscoverSubnet(DiscoverRequest req, CancellationToken ct)
        => await RunDiscover(req?.Subnet, ct);

    private async Task<IResult> RunDiscover(string? subnet, CancellationToken ct)
    {
        try
        {
            var subnets = string.IsNullOrWhiteSpace(subnet)
                ? GetLocalSubnets()
                : new List<string> { subnet.TrimEnd('.') + "." };

            if (subnets.Count == 0)
                return Results.Ok(new DiscoverResultDto(Array.Empty<FoundDeviceDto>(),
                    Array.Empty<string>(), "No subnets to scan."));

        _ctx?.Logger.LogInformation(
            "ATR-1000 discover: scanning {Subnets}",
            string.Join(", ", subnets.Select(s => s + "1-254")));

        var found = new System.Collections.Concurrent.ConcurrentBag<FoundDeviceDto>();
        var sem   = new SemaphoreSlim(50, 50);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));

        var tasks = subnets
            .SelectMany(s => Enumerable.Range(1, 254).Select(i => s + i))
            .Select(async ip =>
            {
                await sem.WaitAsync(timeout.Token).ConfigureAwait(false);
                try
                {
                    var version = await ProbeIpAsync(ip, timeout.Token).ConfigureAwait(false);
                    if (version is not null)
                        found.Add(new FoundDeviceDto(ip, version));
                }
                catch { }
                finally { sem.Release(); }
            });

        await Task.WhenAll(tasks).ConfigureAwait(false);

        var results = found.OrderBy(d => IpSortKey(d.Ip)).ToArray();
        _ctx?.Logger.LogInformation("ATR-1000 discover: found {Count} device(s).", results.Length);
        return Results.Ok(new DiscoverResultDto(results,
            subnets.Select(s => s + "0/24").ToArray(), null));
        }
        catch (Exception ex)
        {
            _ctx?.Logger.LogWarning(ex, "ATR-1000: RunDiscover failed");
            return Results.Ok(new DiscoverResultDto(Array.Empty<FoundDeviceDto>(),
                Array.Empty<string>(), $"Discover error: {ex.Message}"));
        }
    }

    // Open a WS, send SYNC, wait up to 600 ms for SYSTEM_INFO.
    // Returns the firmware version string, or null if not an ATR-1000.
    private static async Task<string?> ProbeIpAsync(string ip, CancellationToken ct)
    {
        using var probeCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        probeCts.CancelAfter(TimeSpan.FromMilliseconds(700));
        var token = probeCts.Token;

        try
        {
            // Fast TCP reachability check first (200 ms).
            using var tcpCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            tcpCts.CancelAfter(400);
            using var tcp = new System.Net.Sockets.TcpClient();
            await tcp.ConnectAsync(ip, 60001, tcpCts.Token).ConfigureAwait(false);
        }
        catch { return null; }  // port not open

        // Port is open — try WebSocket handshake.
        try
        {
            using var ws = new System.Net.WebSockets.ClientWebSocket();
            await ws.ConnectAsync(new Uri($"ws://{ip}:60001/"), probeCts.Token)
                    .ConfigureAwait(false);

            // Send SYNC.
            var sync = new byte[] { 0xFF, 0x01, 0x00 };
            await ws.SendAsync(new ArraySegment<byte>(sync),
                System.Net.WebSockets.WebSocketMessageType.Binary, true, token)
                    .ConfigureAwait(false);

            // Read frames until SYSTEM_INFO (cmd 13 / 0x0D) or timeout.
            var buf = new byte[256];
            while (!token.IsCancellationRequested)
            {
                var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), token)
                                .ConfigureAwait(false);
                if (r.Count >= 3 && buf[0] == 0xFF && buf[1] == 0x0D)
                {
                    // Read null-terminated version string from offset 3.
                    var sb = new System.Text.StringBuilder();
                    for (int i = 3; i < r.Count; i++)
                    {
                        if (buf[i] == 0) break;
                        sb.Append((char)buf[i]);
                    }
                    var ver = sb.ToString().Trim();
                    await ws.CloseOutputAsync(
                        System.Net.WebSockets.WebSocketCloseStatus.NormalClosure,
                        "probe done", CancellationToken.None).ConfigureAwait(false);
                    return ver.Length > 0 ? ver : "unknown";
                }
            }
        }
        catch { }
        return null;
    }

    // Return all unique /24 base strings from active non-loopback interfaces.
    private static List<string> GetLocalSubnets()
    {
        var result = new HashSet<string>();
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType is
                System.Net.NetworkInformation.NetworkInterfaceType.Loopback or
                System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;

            foreach (var ua in ni.GetIPProperties().UnicastAddresses)
            {
                if (ua.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                var parts = ua.Address.ToString().Split('.');
                if (parts.Length == 4 && parts[0] != "127" &&
                    !(parts[0] == "169" && parts[1] == "254"))  // skip APIPA only
                    result.Add($"{parts[0]}.{parts[1]}.{parts[2]}.");
            }
        }
        return result.ToList();
    }

    private static uint IpSortKey(string ip)
    {
        var p = ip.Split('.');
        if (p.Length != 4) return 0;
        return (uint.Parse(p[0]) << 24) | (uint.Parse(p[1]) << 16) |
               (uint.Parse(p[2]) << 8)  |  uint.Parse(p[3]);
    }

    private void StartConnection(string host, int wsPort, string wsPath)
    {
        var conn = new Atr1000Connection(host, wsPort, wsPath, _ctx?.Logger);
        _conn = conn;
        _ = conn.RunAsync(_cts?.Token ?? CancellationToken.None);
    }

    // ── Auto-tune on band change / MOX handler ────────────────────────────

    private void OnMoxChanged(bool mox) { /* reserved for future tune-on-TX */ }

    private void OnFrequencyChanged(long hz)
    {
        if (!_autoTune) return;
        var band = Bands.FromMhz(hz / 1_000_000.0);
        if (band == _lastBand) return;
        _lastBand = band;

        // Debounce: VFO sweeps fire many events; act 1 s after it settles.
        _bandDebounce?.Dispose();
        _bandDebounce = new Timer(_ => TryRecallForBand(band), null, 1000, Timeout.Infinite);
    }

    private void TryRecallForBand(string band)
    {
        var conn = _conn;
        var radio = _ctx?.Radio;
        if (!_autoTune || conn is null || radio is null) return;
        if (radio.Mox) return; // never switch relays during transmit

        // Confirm we're still on this band before acting.
        if (Bands.FromMhz(radio.FrequencyHz / 1_000_000.0) != band) return;

        var slot = conn.FindMemorySlotForBand(band);
        if (slot > 0)
        {
            _ = conn.MemorySelectAsync(slot);
            _ctx?.Logger.LogInformation("ATR-1000 auto-tune: band {Band} → recalled M{Slot}", band, slot);
        }
        else
        {
            _ctx?.Logger.LogDebug("ATR-1000 auto-tune: no stored memory for band {Band}", band);
        }
    }

    private sealed record TuneRequest(string? Mode);
    private sealed record BypassRequest(bool Bypass);
    private sealed record NetworkRequest(string? Network);
    private sealed record LcRequest(int DeltaL, int DeltaC);
    private sealed record MemoryRequest(int Slot);
    private sealed record MemorySaveRequest(int? Slot, int? FreqKhz);
    private sealed record OptionsRequest(bool AutoTune);
}

// ── Amateur-band lookup ─────────────────────────────────────────────────────

internal static class Bands
{
    public static string FromMhz(double mhz) => mhz switch
    {
        >= 1.8   and < 2.0     => "160m",
        >= 3.5   and < 4.0     => "80m",
        >= 5.3   and < 5.45    => "60m",
        >= 7.0   and < 7.3     => "40m",
        >= 10.1  and < 10.15   => "30m",
        >= 14.0  and < 14.35   => "20m",
        >= 18.068 and < 18.168 => "17m",
        >= 21.0  and < 21.45   => "15m",
        >= 24.89 and < 24.99   => "12m",
        >= 28.0  and < 29.7    => "10m",
        _ => "",
    };
}

// ── DTOs ──────────────────────────────────────────────────────────────────

public sealed record ConfigDto(
    [property: JsonPropertyName("host")] string Host,
    [property: JsonPropertyName("wsPort")] int WsPort,
    [property: JsonPropertyName("wsPath")] string WsPath,
    [property: JsonPropertyName("autoTune")] bool AutoTune);

public sealed record FoundDeviceDto(
    [property: JsonPropertyName("ip")]      string Ip,
    [property: JsonPropertyName("version")] string Version);

public sealed record DiscoverResultDto(
    [property: JsonPropertyName("devices")]  FoundDeviceDto[] Devices,
    [property: JsonPropertyName("subnets")]  string[] Subnets,
    [property: JsonPropertyName("error")]    string? Error);

public sealed record MemoryEntryDto
{
    [JsonPropertyName("slot")]          public int Slot { get; init; }
    [JsonPropertyName("network")]       public string Network { get; init; } = "LC";
    [JsonPropertyName("freqMhz")]       public double FreqMhz { get; init; }
    [JsonPropertyName("inductanceUh")]  public double InductanceUh { get; init; }
    [JsonPropertyName("capacitancePf")] public int CapacitancePf { get; init; }
    [JsonPropertyName("band")]          public string Band { get; init; } = "";
}

public sealed record Atr1000StatusDto
{
    [JsonPropertyName("configured")]    public bool Configured { get; init; }
    [JsonPropertyName("host")]          public string Host { get; init; } = "";
    [JsonPropertyName("isConnected")]   public bool IsConnected { get; init; }
    [JsonPropertyName("version")]       public string Version { get; init; } = "";

    [JsonPropertyName("forwardPowerW")] public int ForwardPowerW { get; init; }
    [JsonPropertyName("maxForwardW")]   public int MaxForwardW { get; init; }
    [JsonPropertyName("swr")]           public double Swr { get; init; } = 1.0;

    [JsonPropertyName("isTuning")]      public bool IsTuning { get; init; }
    [JsonPropertyName("tuneMode")]      public int TuneMode { get; init; }
    [JsonPropertyName("isBypassed")]    public bool IsBypassed { get; init; }
    [JsonPropertyName("network")]       public string Network { get; init; } = "LC";
    [JsonPropertyName("indCode")]       public int IndCode { get; init; }
    [JsonPropertyName("capCode")]       public int CapCode { get; init; }
    [JsonPropertyName("inductanceUh")]  public double InductanceUh { get; init; }
    [JsonPropertyName("capacitancePf")] public int CapacitancePf { get; init; }

    [JsonPropertyName("memorySlot")]    public int MemorySlot { get; init; }
    [JsonPropertyName("memoryMax")]     public int MemoryMax { get; init; }
    [JsonPropertyName("memoryFreqMhz")] public double MemoryFreqMhz { get; init; }
    [JsonPropertyName("memories")]      public IReadOnlyList<MemoryEntryDto> Memories { get; init; } = Array.Empty<MemoryEntryDto>();

    [JsonPropertyName("autoTune")]      public bool AutoTune { get; init; }
    [JsonPropertyName("autoCarrier")]   public bool AutoCarrier { get; init; } // ControlRadio granted

    [JsonPropertyName("radioFreqMhz")]  public double? RadioFreqMhz { get; init; }
    [JsonPropertyName("radioBand")]     public string? RadioBand { get; init; }
    [JsonPropertyName("radioMox")]      public bool? RadioMox { get; init; }

    public static Atr1000StatusDto Unconfigured() => new() { Configured = false, IsConnected = false };
}

// ── Connection class ──────────────────────────────────────────────────────

internal sealed class Atr1000Connection : IAsyncDisposable
{
    private const byte FLAG = 0xFF;
    private const byte SYNC = 1;
    private const byte METER_STATUS = 2;
    private const byte TUNE_STATUS = 3;
    private const byte TUNE_MODE = 4;
    private const byte RELAY_STATUS = 5;
    private const byte MEMORY_STATUS = 6;
    private const byte MEMORY_INFO = 7;
    private const byte MEMORY_APPLY = 8;
    private const byte MEMORY_ACTION = 9;
    private const byte MEMORY_FREQ   = 10;  // FF 0A 05 [slot] [kHz_lo] [kHz_hi] 00 00
    private const byte SYSTEM_INFO = 13;
    private const byte SYSTEM_REBOOT = 19;
    private const byte TEST = 254;
    private const byte TEST_REPLAY = 253;

    private const int RelayMin = 0;
    private const int RelayMax = 127;

    private readonly string _host;
    private readonly int _wsPort;
    private readonly string _wsPath;
    private readonly ILogger? _logger;
    private readonly CancellationTokenSource _internalCts = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    private ClientWebSocket? _ws;
    private volatile bool _connected;

    // Parsed state.
    private string _version = "";
    private int _fwdW;
    private int _maxFwdW = 10;
    private double _swr = 1.0;
    private int _sw;
    private int _indCode;
    private int _capCode;
    private double _lUh;
    private int _cPf;
    private int _memorySlot;
    private int _memoryMax;
    private double _memoryFreqMhz;
    private int _tuneMode;    // 0=reset 1=memory 2=full 3=fine
    private bool _isTuning;   // true while a tune cycle runs
    public bool IsTuning => _isTuning;
    private readonly ConcurrentDictionary<int, MemoryEntryDto> _memories = new();

    public Atr1000Connection(string host, int wsPort, string wsPath, ILogger? logger)
    {
        _host = host;
        _wsPort = wsPort;
        _wsPath = wsPath;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _internalCts.Token);
        var token = linked.Token;

        while (!token.IsCancellationRequested)
        {
            try
            {
                var uri = new Uri($"ws://{_host}:{_wsPort}{_wsPath}");
                _logger?.LogInformation("ATR-1000: connecting WebSocket {Uri}", uri);

                var ws = new ClientWebSocket();
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                await ws.ConnectAsync(uri, token);
                _ws = ws;
                _connected = true;
                _logger?.LogInformation("ATR-1000: connected to {Host}", _host);

                await Task.Delay(500, token);     // device is silent until SYNC
                await SendAsync(Frame(SYNC), token);

                await ReceiveLoopAsync(ws, token);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "ATR-1000: WebSocket error ({Host})", _host);
            }

            _connected = false;
            CloseQuietly();

            if (!token.IsCancellationRequested)
            {
                _logger?.LogInformation("ATR-1000: reconnecting to {Host} in 5s…", _host);
                try { await Task.Delay(5000, token); }
                catch (OperationCanceledException) { break; }
            }
        }

        _connected = false;
        CloseQuietly();
    }

    private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken token)
    {
        var buffer = new byte[4096];
        using var ms = new MemoryStream();

        while (!token.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            ms.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", token);
                    return;
                }
                ms.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            var frame = ms.ToArray();
            try { ParseFrame(frame); }
            catch (Exception ex) { _logger?.LogDebug(ex, "ATR-1000: parse error ({Len} bytes)", frame.Length); }
        }
    }

    private async Task SendAsync(byte[] frame, CancellationToken token = default)
    {
        var ws = _ws;
        if (ws is null || ws.State != WebSocketState.Open) return;

        await _sendLock.WaitAsync(token);
        try
        {
            await ws.SendAsync(new ArraySegment<byte>(frame), WebSocketMessageType.Binary, true, token);
            _logger?.LogDebug("ATR-1000 → cmd={Cmd} ({Len}B)", frame.Length > 1 ? frame[1] : 0, frame.Length);
        }
        catch (Exception ex) { _logger?.LogWarning(ex, "ATR-1000: send failed"); }
        finally { _sendLock.Release(); }
    }

    private static byte[] Frame(byte cmd, params byte[] payload)
    {
        var f = new byte[3 + payload.Length];
        f[0] = FLAG;
        f[1] = cmd;
        f[2] = (byte)payload.Length;
        Array.Copy(payload, 0, f, 3, payload.Length);
        return f;
    }

    private static byte U8(int v) => (byte)Math.Clamp(v, 0, 255);
    private static int U16LE(byte[] b, int i) => b[i] | (b[i + 1] << 8);

    private void ParseFrame(byte[] b)
    {
        if (b.Length < 3 || b[0] != FLAG) return;
        byte cmd = b[1];

        switch (cmd)
        {
            case METER_STATUS when b.Length >= 10:
            {
                int swrRaw = U16LE(b, 4);
                _fwdW = U16LE(b, 6);
                int maxFwd = U16LE(b, 8);
                if (maxFwd > 0) _maxFwdW = maxFwd;
                _swr = swrRaw >= 100 ? Math.Round(swrRaw / 100.0, 2) : swrRaw;
                break;
            }
            case RELAY_STATUS when b.Length >= 10:
            {
                _sw = b[3];
                _indCode = b[4];
                _capCode = b[5];
                _lUh = U16LE(b, 6) / 100.0;
                _cPf = U16LE(b, 8);
                break;
            }
            case MEMORY_STATUS when b.Length >= 7:
            {
                _memorySlot = b[3];
                _memoryFreqMhz = Math.Round(U16LE(b, 4) * 0.001, 3);
                _memoryMax = b[6];
                break;
            }
            case MEMORY_INFO when b.Length >= 13:
            {
                int id = b[3];
                if (id > 0)
                {
                    double freq = Math.Round(U16LE(b, 10) * 0.001, 3);
                    _memories[id] = new MemoryEntryDto
                    {
                        Slot = id,
                        Network = b[12] == 0 ? "LC" : "CL",
                        InductanceUh = U16LE(b, 6) / 100.0,
                        CapacitancePf = U16LE(b, 8),
                        FreqMhz = freq,
                        Band = Bands.FromMhz(freq),
                    };
                }
                break;
            }
            case SYSTEM_INFO:
            {
                _version = ReadString(b, 3, 20);
                break;
            }
            case TUNE_MODE when b.Length >= 4:
            {
                _tuneMode = b[3];
                // Memory (mode 1) is instant — no carrier needed, not "tuning".
                // Full (2) and Fine (3) need carrier and show as active tuning.
                _isTuning = _tuneMode >= 2;
                break;
            }
            case TEST:
                _ = SendAsync(Frame(TEST_REPLAY));
                break;
        }
    }

    private static string ReadString(byte[] b, int offset, int size)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < size && offset + i < b.Length; i++)
        {
            byte c = b[offset + i];
            if (c == 0) break;
            sb.Append((char)c);
        }
        return sb.ToString().Trim();
    }

    // ── Public command surface ──────────────────────────────────────────────

    public Task TuneAsync(string mode)
    {
        byte m = mode switch
        {
            "reset"  => 0,
            "memory" => 1,
            "full"   => 2,
            "fine"   => 3,
            _        => 1,
        };
        _tuneMode = m;
        _isTuning = m >= 2;  // only Full/Fine need carrier and show as tuning
        return SendAsync(Frame(TUNE_MODE, m));
    }

    public Task SetBypassAsync(bool bypass)
        => SendAsync(Frame(TUNE_STATUS, (byte)(bypass ? 0 : 1)));

    public Task SetNetworkAsync(string net)
    {
        _sw = net == "CL" ? 1 : 0;
        return SendAsync(Frame(RELAY_STATUS, U8(_sw), U8(_indCode), U8(_capCode)));
    }

    public Task AdjustLcAsync(int deltaL, int deltaC)
    {
        _indCode = Math.Clamp(_indCode + deltaL, RelayMin, RelayMax);
        _capCode = Math.Clamp(_capCode + deltaC, RelayMin, RelayMax);
        return SendAsync(Frame(RELAY_STATUS, U8(_sw), U8(_indCode), U8(_capCode)));
    }

    public Task MemorySelectAsync(int slot)
        => SendAsync(Frame(MEMORY_APPLY, U8(slot)));

    public async Task MemorySaveAsync(int slot, int freqKhz)
    {
        int s = slot > 0 ? slot : (_memorySlot > 0 ? _memorySlot : 1);

        // Step 1: save current relay state (L/C/network) to the slot
        await SendAsync(Frame(MEMORY_ACTION, 1));

        // Step 2: store frequency label for this slot
        // Frame: FF 0A 05 [slot] [freq_lo] [freq_hi] 00 00  (matches web app setMemoryFreq)
        if (freqKhz > 0)
        {
            await SendAsync(new byte[] {
                FLAG, MEMORY_FREQ, 5,
                (byte)s,
                (byte)(freqKhz & 0xFF), (byte)((freqKhz >> 8) & 0xFF),
                0, 0
            });
        }

        await SendAsync(Frame(SYNC));
    }

    public Task MemoryResetAsync()
        => SendAsync(Frame(MEMORY_APPLY, U8(_memorySlot)));

    public Task SendSyncAsync()
        => SendAsync(Frame(SYNC));

    public Task RestartDeviceAsync()
        => SendAsync(Frame(SYSTEM_REBOOT, 1));

    public int FindMemorySlotForBand(string band)
    {
        if (string.IsNullOrEmpty(band)) return 0;
        foreach (var m in _memories.Values)
            if (m.FreqMhz > 0 && m.Band == band)
                return m.Slot;
        return 0;
    }

    // ── Snapshot ────────────────────────────────────────────────────────────

    public Atr1000StatusDto GetStatus() => new()
    {
        Configured = true,
        Host = _host,
        IsConnected = _connected,
        Version = _version,
        ForwardPowerW = _fwdW,
        MaxForwardW = _maxFwdW,
        Swr = _swr,
        IsBypassed = _indCode == 0 && _capCode == 0,
        IsTuning = _isTuning,
        TuneMode = _tuneMode,
        Network = _sw == 0 ? "LC" : "CL",
        IndCode = _indCode,
        CapCode = _capCode,
        InductanceUh = _lUh,
        CapacitancePf = _cPf,
        MemorySlot = _memorySlot,
        MemoryMax = _memoryMax,
        MemoryFreqMhz = _memoryFreqMhz,
        Memories = _memories.Values.OrderBy(m => m.Slot).ToList(),
    };

    private void CloseQuietly()
    {
        try { _ws?.Dispose(); } catch { /* ignore */ }
        _ws = null;
    }

    public async ValueTask DisposeAsync()
    {
        _internalCts.Cancel();
        var ws = _ws;
        if (ws is { State: WebSocketState.Open })
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "shutdown", cts.Token);
            }
            catch { /* ignore */ }
        }
        CloseQuietly();
        _internalCts.Dispose();
        _sendLock.Dispose();
    }
}
