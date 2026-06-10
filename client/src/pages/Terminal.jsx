import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAuthStore } from "../store/auth";
import s from "./Terminal.module.css";

export default function Terminal() {
  const [params]   = useSearchParams();
  const deviceId   = params.get("deviceId");
  const deviceHost = params.get("host") || "";
  const deviceUser = params.get("user") || "";
  const deviceOs   = params.get("os")   || "";

  const { accessToken: storeToken } = useAuthStore();
  const activeToken = params.get("token") || storeToken;

  const wrapRef  = useRef(null);  // outer clickable div
  const termRef  = useRef(null);  // xterm mount point
  const xtermRef = useRef(null);
  const fitRef   = useRef(null);
  const wsRef    = useRef(null);
  const readyRef = useRef(false); // track ready without triggering re-render

  const [status, setStatus] = useState("connecting");
  const [info,   setInfo]   = useState(null);

  const buildWsUrl = useCallback(() => {
    const o = window.location.origin;
    const w = o.replace(/^https/, "wss").replace(/^http/, "ws");
    return `${w}/ws?token=${encodeURIComponent(activeToken)}&deviceId=${deviceId}`;
  }, [activeToken, deviceId]);

  // ── Focus helper ─────────────────────────────────────────────
  const focusTerm = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    // xterm v5: find the helper textarea and focus it directly
    const textarea = termRef.current?.querySelector(".xterm-helper-textarea");
    if (textarea) {
      textarea.focus({ preventScroll: true });
    } else {
      term.focus();
    }
  }, []);

  // ── Send input to agent ───────────────────────────────────────
  const sendInput = useCallback((data) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "shell:input", data }));
    }
  }, []);

  useEffect(() => {
    if (!deviceId || !activeToken || !termRef.current) return;

    // ── Build terminal ────────────────────────────────────────
    const term = new XTerm({
      cursorBlink:       true,
      cursorStyle:       "block",
      fontSize:          14,
      fontFamily:        '"Cascadia Code","Fira Code","Consolas",monospace',
      allowTransparency: false,
      convertEol:        true,
      scrollback:        5000,
      disableStdin:      false,
      theme: {
        background: "#080c10", foreground: "#c9d1d9",
        cursor: "#00e5c8",     cursorAccent: "#080c10",
        selectionBackground: "rgba(0,229,200,0.2)",
        black:"#0d1117",   red:"#f85149",     green:"#3fb950",  yellow:"#d29922",
        blue:"#58a6ff",    magenta:"#bc8cff", cyan:"#76e3ea",   white:"#b1bac4",
        brightBlack:"#6e7681", brightRed:"#ff7b72",   brightGreen:"#56d364",
        brightYellow:"#e3b341",brightBlue:"#79c0ff",  brightMagenta:"#d2a8ff",
        brightCyan:"#87deea",  brightWhite:"#f0f6fc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    try { fit.fit(); } catch {}

    xtermRef.current = term;
    fitRef.current   = fit;

    // Resize observer
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(termRef.current);

    // xterm onData → send to agent
    term.onData(data => sendInput(data));

    // xterm onResize → tell agent new dimensions
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "shell:resize", cols, rows }));
    });

    // Focus after first paint
    setTimeout(focusTerm, 100);

    // ── WebSocket ─────────────────────────────────────────────
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "shell:open" }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case "session:info": setInfo(msg.device); break;
          case "shell:ready":
            readyRef.current = true;
            // Focus the textarea directly — most reliable method
            setTimeout(focusTerm, 80);
            break;
          case "shell:output":
            term.write(msg.data);
            break;
          case "shell:exit":
            readyRef.current = false;
            setStatus("closed");
            term.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
            break;
          case "shell:error":
            term.write(`\r\n\x1b[31m[${msg.message}]\x1b[0m\r\n`);
            setStatus("error");
            break;
        }
      } catch {}
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      term.write("\r\n\x1b[90m[Disconnected]\x1b[0m\r\n");
      setStatus(p => p === "connecting" ? "error" : "closed");
    };

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  // eslint-disable-next-line
  }, []);  // run once on mount — deps in refs

  const reconnect     = () => window.location.reload();
  const sendCtrlC     = () => { sendInput("\x03"); focusTerm(); };
  const clearTerminal = () => { xtermRef.current?.clear(); focusTerm(); };

  const statusColor = {
    connecting:"#f5a623", open:"#22d885", closed:"#f03e3e", error:"#f03e3e"
  }[status] ?? "#7a8fa8";

  const statusLabel = {
    connecting:"Connecting", open:"Connected", closed:"Closed", error:"Error"
  }[status] ?? status;

  const di = info || {};

  return (
    <div className={s.root}>
      <div className={s.topbar}>
        <div className={s.deviceInfo}>
          <InfoCol label="Client" value={(deviceId||"").slice(0,8)+"…"} />
          <InfoCol label="Host"   value={di.hostname||deviceHost||"—"} />
          <InfoCol label="User"   value={di.username||deviceUser||"—"} />
          <InfoCol label="OS"     value={di.os?(di.os+(di.os_version?" "+di.os_version:"")):deviceOs||"—"} />
        </div>
        <div className={s.actions}>
          <div className={s.statusPill} style={{borderColor:statusColor+"55",color:statusColor}}>
            <span className={s.statusDot} style={{background:statusColor}} />
            {statusLabel}
          </div>
          <button className={s.actionBtn}    onClick={reconnect}>↻ Reconnect</button>
          <button className={s.actionBtn}    onClick={sendCtrlC}>⬛ Ctrl+C</button>
          <button className={s.actionBtnAlt} onClick={clearTerminal}>⌫ Clear</button>
        </div>
      </div>

      {/* Clicking anywhere in this div focuses the terminal */}
      <div
        ref={wrapRef}
        className={s.termWrap}
        onClick={focusTerm}
        onMouseDown={focusTerm}
      >
        <div ref={termRef} className={s.term} />

        {status === "connecting" && (
          <div className={s.overlay}>
            <div className={s.spinner} />
            <div className={s.overlayText}>Connecting…</div>
          </div>
        )}
        {(status === "closed" || status === "error") && (
          <div className={s.overlayBottom}>
            <span className={s.overlayMsg}>
              {status === "error" ? "Error" : "Closed"}
            </span>
            <button className={s.reconnectBtn}
              onClick={e=>{e.stopPropagation();reconnect();}}>
              ↻ Reconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCol({ label, value }) {
  return (
    <div className={s.infoCol}>
      <div className={s.infoLabel}>{label}</div>
      <div className={s.infoValue}>{value}</div>
    </div>
  );
}
