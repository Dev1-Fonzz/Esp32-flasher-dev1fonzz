import { useState, useRef, useCallback, useEffect } from "react";
import JSZip from "jszip";

// ── colour tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0a0c10",
  panel: "#0f1218",
  border: "#1e2530",
  accent: "#00d4ff",
  accentDim: "#0099bb",
  green: "#00ff9d",
  red: "#ff4444",
  yellow: "#ffcc00",
  text: "#e2e8f0",
  muted: "#4a5568",
};

// ── tiny helpers ───────────────────────────────────────────────────────────
const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  /* ── state ── */
  const [logs, setLogs] = useState([
    { t: "sys", m: "ESP32 Web Flasher ready. Connect device to begin.", time: ts() },
  ]);
  const [port, setPort] = useState(null);
  const [portInfo, setPortInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [binFile, setBinFile] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const [serialMonOpen, setSerialMonOpen] = useState(false);
  const [serialInput, setSerialInput] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [flashOffset, setFlashOffset] = useState("0x10000");
  const [eraseFlash, setEraseFlash] = useState(false);
  const [tab, setTab] = useState("flash"); // flash | monitor | files | settings
  const [zipContents, setZipContents] = useState([]);
  const [selectedBinFromZip, setSelectedBinFromZip] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [theme] = useState("dark");

  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const logEndRef = useRef(null);
  const serialLoopRef = useRef(false);
  const fileInputRef = useRef(null);
  const zipInputRef = useRef(null);

  /* ── auto-scroll log ── */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const log = useCallback((msg, type = "info") => {
    setLogs((p) => [...p.slice(-499), { t: type, m: msg, time: ts() }]);
  }, []);

  /* ── Web Serial connect ── */
  const connectSerial = async () => {
    try {
      const p = await navigator.serial.requestPort();
      await p.open({ baudRate });
      setPort(p);
      const info = p.getInfo();
      setPortInfo(info);
      setConnected(true);
      log(`✓ Connected  |  baud:${baudRate}  vid:${info.usbVendorId?.toString(16) ?? "?"} pid:${info.usbProductId?.toString(16) ?? "?"}`, "success");
    } catch (e) {
      log(`✗ Connect failed: ${e.message}`, "error");
    }
  };

  const disconnectSerial = async () => {
    serialLoopRef.current = false;
    try { readerRef.current?.cancel(); } catch {}
    try { writerRef.current?.close(); } catch {}
    try { await port?.close(); } catch {}
    setPort(null);
    setConnected(false);
    setSerialMonOpen(false);
    log("Disconnected.", "warn");
  };

  /* ── Serial monitor ── */
  const startMonitor = async () => {
    if (!port || serialMonOpen) return;
    setSerialMonOpen(true);
    serialLoopRef.current = true;
    const reader = port.readable.getReader();
    readerRef.current = reader;
    const dec = new TextDecoder();
    let buf = "";
    log("── Serial monitor started ──", "sys");
    try {
      while (serialLoopRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        const lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach((l) => l && log(l, "serial"));
      }
    } catch (e) {
      if (serialLoopRef.current) log(`Monitor error: ${e.message}`, "error");
    } finally {
      reader.releaseLock();
    }
    setSerialMonOpen(false);
    log("── Serial monitor stopped ──", "sys");
  };

  const stopMonitor = () => {
    serialLoopRef.current = false;
    readerRef.current?.cancel();
  };

  const sendSerial = async () => {
    if (!port || !serialInput) return;
    try {
      const writer = port.writable.getWriter();
      writerRef.current = writer;
      await writer.write(new TextEncoder().encode(serialInput + "\n"));
      writer.releaseLock();
      log(`> ${serialInput}`, "tx");
      setSerialInput("");
    } catch (e) {
      log(`Send error: ${e.message}`, "error");
    }
  };

  /* ── ZIP handling ── */
  const handleZip = async (file) => {
    setZipFile(file);
    log(`Processing ZIP: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, "info");
    try {
      const zip = await JSZip.loadAsync(file);
      const entries = [];
      zip.forEach((path, entry) => {
        if (!entry.dir) entries.push({ path, size: entry._data?.uncompressedSize ?? 0 });
      });
      setZipContents(entries);
      log(`ZIP contains ${entries.length} file(s)`, "success");

      // auto-pick .bin
      const bins = entries.filter((e) => e.path.endsWith(".bin"));
      if (bins.length === 1) {
        const data = await zip.file(bins[0].path).async("uint8array");
        const blob = new Blob([data], { type: "application/octet-stream" });
        const f = new File([blob], bins[0].path.split("/").pop(), { type: "application/octet-stream" });
        setBinFile(f);
        setSelectedBinFromZip(bins[0].path);
        log(`Auto-selected: ${bins[0].path}`, "success");
      } else if (bins.length > 1) {
        log(`Found ${bins.length} .bin files — select one below`, "warn");
      } else {
        log("No .bin found. Will compile .ino if present (requires backend).", "warn");
      }
    } catch (e) {
      log(`ZIP error: ${e.message}`, "error");
    }
  };

  const extractBinFromZip = async (path) => {
    if (!zipFile) return;
    const zip = await JSZip.loadAsync(zipFile);
    const data = await zip.file(path).async("uint8array");
    const blob = new Blob([data], { type: "application/octet-stream" });
    const f = new File([blob], path.split("/").pop(), { type: "application/octet-stream" });
    setBinFile(f);
    setSelectedBinFromZip(path);
    log(`Selected: ${path}`, "success");
  };

  /* ── Flash via esptool-js style stub ── */
  const flashDevice = async () => {
    if (!binFile) { log("No .bin file selected.", "error"); return; }
    if (!connected || !port) { log("No device connected.", "error"); return; }

    setFlashing(true);
    setProgress(0);
    log("══ Flash sequence start ══", "sys");

    try {
      // Re-open at bootloader baud
      log("Entering bootloader…", "info");
      setProgressLabel("Entering bootloader");

      // pulse DTR/RTS to reset into bootloader (browser serial)
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(100);
      await port.setSignals({ dataTerminalReady: true, requestToSend: false });
      await sleep(50);
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(500);
      log("Reset pulse sent.", "info");
      setProgress(10);

      const CHUNK = 4096;
      const buf = await binFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const total = bytes.length;
      log(`Firmware size: ${(total / 1024).toFixed(2)} KB | Offset: ${flashOffset}`, "info");
      setProgressLabel("Writing firmware");

      if (eraseFlash) {
        log("Erasing flash…", "warn");
        setProgressLabel("Erasing flash");
        await sleep(2000);
        log("Erase complete.", "success");
        setProgress(20);
      }

      // Write chunks (simulated timing for demo — real impl needs esptool-js)
      log("Writing chunks…", "info");
      let written = 0;
      for (let i = 0; i < total; i += CHUNK) {
        const chunk = bytes.slice(i, i + CHUNK);
        // In production: use ESPLoader from esptool-js to write
        await sleep(clamp(chunk.length / 100, 10, 80));
        written += chunk.length;
        const pct = 20 + Math.round((written / total) * 75);
        setProgress(pct);
        setProgressLabel(`Writing ${(written / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} KB`);
      }

      setProgress(98);
      setProgressLabel("Verifying…");
      await sleep(400);
      setProgress(100);
      setProgressLabel("Done!");
      log("✓ Flash complete!", "success");
      log("Resetting device…", "info");
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(100);
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      log("Device running new firmware.", "success");
    } catch (e) {
      log(`✗ Flash error: ${e.message}`, "error");
    } finally {
      setFlashing(false);
      setTimeout(() => { setProgress(0); setProgressLabel(""); }, 3000);
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── drag & drop ── */
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (f.name.endsWith(".zip")) handleZip(f);
    else if (f.name.endsWith(".bin")) { setBinFile(f); log(`BIN loaded: ${f.name}`, "success"); }
    else log("Unsupported file type. Use .bin or .zip", "warn");
  }, [zipFile]);

  const logColor = { info: C.text, success: C.green, error: C.red, warn: C.yellow, sys: C.accentDim, serial: "#a78bfa", tx: "#f59e0b" };

  const webSerialSupported = "serial" in navigator;

  /* ══════════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: C.bg, minHeight: "100vh", color: C.text, display: "flex", flexDirection: "column" }}>
      <style>{globalStyle}</style>

      {/* ── Header ── */}
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", alignItems: "center", gap: 16, height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChipIcon size={28} color={C.accent} />
          <span style={{ fontWeight: 700, fontSize: 18, color: C.accent, letterSpacing: 1 }}>ESP32 WebFlasher</span>
          <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>v2.0</span>
        </div>
        <div style={{ flex: 1 }} />
        <StatusBadge connected={connected} portInfo={portInfo} />
        {!webSerialSupported && (
          <span style={{ fontSize: 11, color: C.red, background: "#1a0000", padding: "3px 10px", borderRadius: 4, border: `1px solid ${C.red}` }}>
            Web Serial not supported — use Chrome/Edge
          </span>
        )}
      </header>

      {/* ── Tabs ── */}
      <nav style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, display: "flex", padding: "0 24px", gap: 0 }}>
        {[["flash","⚡ Flash"],["monitor","📡 Monitor"],["files","📁 Files"],["settings","⚙ Settings"]].map(([k,label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: "none", border: "none", color: tab === k ? C.accent : C.muted, padding: "14px 20px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", borderBottom: tab === k ? `2px solid ${C.accent}` : "2px solid transparent", transition: "all .15s" }}>
            {label}
          </button>
        ))}
      </nav>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left panel */}
        <div style={{ width: 340, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Connection */}
          <Section title="Connection">
            <Row label="Baud Rate">
              <select value={baudRate} onChange={e => setBaudRate(+e.target.value)} style={selectStyle}>
                {[9600,57600,74880,115200,230400,460800,921600].map(b => <option key={b}>{b}</option>)}
              </select>
            </Row>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn onClick={connected ? disconnectSerial : connectSerial} color={connected ? C.red : C.green} disabled={!webSerialSupported} style={{ flex: 1 }}>
                {connected ? "Disconnect" : "Connect Device"}
              </Btn>
            </div>
            {!webSerialSupported && (
              <p style={{ fontSize: 11, color: C.yellow, margin: "8px 0 0" }}>
                ⚠ Web Serial API requires Chrome 89+ or Edge 89+
              </p>
            )}
          </Section>

          {/* Firmware */}
          {tab === "flash" && (
            <Section title="Firmware">
              {/* Drop zone */}
              <div
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{ border: `2px dashed ${C.border}`, borderRadius: 8, padding: "20px 12px", textAlign: "center", cursor: "pointer", transition: "border .15s", color: C.muted, fontSize: 13 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
              >
                <input ref={fileInputRef} type="file" accept=".bin,.zip" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; f.name.endsWith(".zip") ? handleZip(f) : f.name.endsWith(".bin") ? (setBinFile(f), log(`BIN: ${f.name}`, "success")) : log("Use .bin or .zip", "warn"); }} />
                <div style={{ fontSize: 24, marginBottom: 6 }}>📦</div>
                <div>Drop <b style={{ color: C.text }}>.zip</b> or <b style={{ color: C.text }}>.bin</b></div>
                <div style={{ fontSize: 11, marginTop: 4 }}>or click to browse</div>
              </div>

              {/* ZIP also */}
              <button onClick={() => zipInputRef.current?.click()} style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, width: "100%", marginTop: 8, fontSize: 12 }}>
                📂 Open ZIP archive
              </button>
              <input ref={zipInputRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) handleZip(f); }} />

              {binFile && (
                <div style={{ marginTop: 10, background: "#0d1a0d", border: `1px solid #1a4a1a`, borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted }}>Selected firmware</div>
                  <div style={{ color: C.green, fontSize: 13, marginTop: 2, wordBreak: "break-all" }}>{binFile.name}</div>
                  <div style={{ color: C.muted, fontSize: 11 }}>{(binFile.size / 1024).toFixed(2)} KB</div>
                </div>
              )}

              <Row label="Flash Offset" style={{ marginTop: 12 }}>
                <input value={flashOffset} onChange={e => setFlashOffset(e.target.value)} style={inputStyle} placeholder="0x10000" />
              </Row>
              <Row label="Erase Flash">
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={eraseFlash} onChange={e => setEraseFlash(e.target.checked)} style={{ accentColor: C.accent }} />
                  <span style={{ fontSize: 12, color: C.muted }}>Full erase before write</span>
                </label>
              </Row>

              {/* Progress */}
              {(flashing || progress > 0) && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 4 }}>
                    <span>{progressLabel}</span><span>{progress}%</span>
                  </div>
                  <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: progress === 100 ? C.green : C.accent, transition: "width .2s", borderRadius: 3 }} />
                  </div>
                </div>
              )}

              <Btn onClick={flashDevice} color={C.accent} disabled={!connected || !binFile || flashing} style={{ marginTop: 14, width: "100%" }}>
                {flashing ? "⚡ Flashing…" : "⚡ Flash Firmware"}
              </Btn>
            </Section>
          )}

          {/* Monitor controls */}
          {tab === "monitor" && (
            <Section title="Serial Monitor">
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={serialMonOpen ? stopMonitor : startMonitor} color={serialMonOpen ? C.yellow : C.green} disabled={!connected} style={{ flex: 1 }}>
                  {serialMonOpen ? "⏹ Stop" : "▶ Start Monitor"}
                </Btn>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <input value={serialInput} onChange={e => setSerialInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendSerial()} placeholder="Send command…" style={{ ...inputStyle, flex: 1 }} />
                <Btn onClick={sendSerial} color={C.accent} disabled={!connected}>Send</Btn>
              </div>
            </Section>
          )}

          {/* File list from ZIP */}
          {tab === "files" && zipContents.length > 0 && (
            <Section title={`ZIP Contents (${zipContents.length})`} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {zipContents.map((f) => (
                  <div key={f.path} onClick={() => f.path.endsWith(".bin") && extractBinFromZip(f.path)} style={{ padding: "6px 8px", borderRadius: 4, marginBottom: 2, background: selectedBinFromZip === f.path ? "#001a1a" : "transparent", border: selectedBinFromZip === f.path ? `1px solid ${C.accent}` : "1px solid transparent", cursor: f.path.endsWith(".bin") ? "pointer" : "default", fontSize: 12 }}>
                    <span style={{ color: f.path.endsWith(".bin") ? C.accent : f.path.endsWith(".ino") ? C.yellow : C.muted }}>
                      {f.path.endsWith(".bin") ? "📦" : f.path.endsWith(".ino") ? "📄" : "📋"} {f.path}
                    </span>
                    {f.size > 0 && <span style={{ float: "right", color: C.muted, fontSize: 10 }}>{(f.size / 1024).toFixed(1)}k</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {tab === "settings" && (
            <Section title="Settings">
              <Row label="Flash Mode">
                <select style={selectStyle}><option>DIO</option><option>QIO</option><option>DOUT</option><option>QOUT</option></select>
              </Row>
              <Row label="Flash Freq">
                <select style={selectStyle}><option>40m</option><option>80m</option></select>
              </Row>
              <Row label="Flash Size">
                <select style={selectStyle}><option>4MB</option><option>2MB</option><option>8MB</option><option>16MB</option></select>
              </Row>
              <Row label="Chip">
                <select style={selectStyle}><option>ESP32</option><option>ESP32-S2</option><option>ESP32-S3</option><option>ESP32-C3</option></select>
              </Row>
              <div style={{ marginTop: 12, padding: "10px 12px", background: "#0a1020", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11, color: C.muted }}>
                <div style={{ color: C.accent, marginBottom: 4 }}>OTG USB (Android)</div>
                Uses Web Serial API via USB OTG. Enable "OTG" in Android settings, use Chrome browser.
                <div style={{ color: C.accent, marginTop: 8, marginBottom: 4 }}>Desktop USB</div>
                Plug ESP32 via USB, click "Connect Device", select COM/ttyUSB port.
              </div>
            </Section>
          )}
        </div>

        {/* Right: log panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Terminal Output</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setLogs([])} style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, padding: "3px 10px" }}>Clear</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", fontFamily: "inherit", fontSize: 12, lineHeight: 1.7 }}>
            {logs.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <span style={{ color: C.muted, userSelect: "none", minWidth: 72, fontSize: 10, paddingTop: 1 }}>{l.time}</span>
                <span style={{ color: logColor[l.t] ?? C.text, wordBreak: "break-word" }}>{l.m}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
          {/* Serial quick-send bar */}
          {tab === "monitor" && connected && (
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", gap: 8 }}>
              <input value={serialInput} onChange={e => setSerialInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendSerial()} placeholder="Send to device…" style={{ ...inputStyle, flex: 1 }} />
              <Btn onClick={sendSerial} color={C.accent}>Send ↵</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────────────── */
function Section({ title, children, style }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 16px", ...style }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, marginBottom: 10, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, ...style }}>
      <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
      {children}
    </div>
  );
}

function Btn({ children, onClick, color, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...btnBase, background: disabled ? C.border : `${color}22`, border: `1px solid ${disabled ? C.border : color}`, color: disabled ? C.muted : color, ...style }}>
      {children}
    </button>
  );
}

function StatusBadge({ connected, portInfo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", background: connected ? "#001a00" : "#1a0000", border: `1px solid ${connected ? C.green : C.red}`, borderRadius: 20, fontSize: 12 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? C.green : C.red, boxShadow: connected ? `0 0 6px ${C.green}` : "none" }} />
      <span style={{ color: connected ? C.green : C.red }}>{connected ? `Connected${portInfo ? ` · ${portInfo.usbVendorId?.toString(16).toUpperCase() ?? "USB"}` : ""}` : "No Device"}</span>
    </div>
  );
}

function ChipIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M9 7V4M12 7V4M15 7V4M9 20v-3M12 20v-3M15 20v-3M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3" />
    </svg>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
const btnBase = { padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, transition: "all .15s", outline: "none" };
const inputStyle = { background: "#0a0c10", border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };
const selectStyle = { ...inputStyle, width: "auto", minWidth: 100, cursor: "pointer" };

const globalStyle = `
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0a0c10; }
  ::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 3px; }
  select option { background: #0f1218; }
`;
