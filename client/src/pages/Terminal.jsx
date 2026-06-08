import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAuthStore } from "../store/auth";
import s from "./Terminal.module.css";

export default function Terminal() {
  const [params]    = useSearchParams();
  const deviceId    = params.get("deviceId");
  const deviceName  = params.get("name")  || "Device";
  const deviceHost  = params.get("host")  || "";
  const deviceUser  = params.get("user")  || "";
  const deviceOs    = params.get("os")    || "";

  const { accessToken } = useAuthStore();

  const termRef  = useRef(null);
  const xtermRef = useRef(null);
  const fitRef   = useRef(null);
  const wsRef    = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [info,   setInfo]   = useState(null);
  const [ready,  setReady]  = useState(false);

  const buildWsUrl = useCallback(() => {
    const base   = window.location.origin;
    const wsBase = base.replace(/^https/, "wss").replace(/^http/, "ws");
    return `${wsBase}/ws?token=${encodeURIComponent(accessToken)}&deviceId=${deviceId}`;
  }, [accessToken, deviceId]);

  useEffect(() => {
    if (!deviceId || !accessToken || !termRef.current) return;

    // ── Init xterm ────────────────────────────────────────────
    const term = new XTerm({
      cursorBlink:  true,
      cursorStyle:  "block",
      fontSize:     14,
      fontFamily:   '"Cascadia Code", "Fira Code", "Consolas", monospace',
      theme: {
        background:          "#080c10",
        foreground:          "#c9d1d9",
        cursor:              "#00e5c8",
        cursorAccent:        "#080c10",
        selectionBackground: "rgba(0,229,200,0.2)",
        black:               "#0d1117",
        red:                 "#f85149",
        green:               "#3fb950",
        yellow:              "#d29922",
        blue:                "#58a6ff",
        magenta:             "#bc8cff",
        cyan:                "#76e3ea",
        white:               "#b1bac4",
        brightBlack:         "#6e7681",
        brightRed:           "#ff7b72",
        brightGreen:         "#56d364",
        brightYellow:        "#e3b341",
        brightBlue:          "#79c0ff",
        brightMagenta:       "#d2a8ff",
        brightCyan:          "#87deea",
        brightWhite:         "#f0f6fc",
      },
      scrollback:        5000,
      allowTransparency: false,
      convertEol:        true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);

    // Fit after a frame so the DOM has settled
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
    });

    xtermRef.current = term;
    fitRef.current   = fit;

    // Resize observer
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(termRef.current);

    // Input → WS
    term.onData(data => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "shell:input", data }));
    });

    // Resize → WS
    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "shell:resize", cols, rows }));
    });

    // ── WebSocket ─────────────────────────────────────────────
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "shell:open" }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case "session:info":
            setInfo(msg.device);
            break;
          case "shell:ready":
            setReady(true);
            term.focus();
            break;
          case "shell:output":
            term.write(msg.data);
            break;
          case "shell:exit":
            setReady(false);
            setStatus("closed");
            term.write("\r\n\x1b[90m[Client disconnected]\x1b[0m\r\n");
            break;
          case "shell:error":
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            setStatus("error");
            break;
        }
      } catch {}
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      setStatus("closed");
      term.write("\r\n\x1b[90m[Client disconnected]\x1b[0m\r\n");
    };

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [deviceId, accessToken, buildWsUrl]);

  const reconnect    = () => window.location.reload();
  const sendCtrlC    = () => wsRef.current?.readyState === WebSocket.OPEN &&
                             wsRef.current.send(JSON.stringify({ type: "shell:input", data: "\x03" }));
  const clearTerminal = () => xtermRef.current?.clear();

  const statusColor = { connecting: "#f5a623", open: "#22d885", closed: "#f03e3e", error: "#f03e3e" }[status] ?? "#7a8fa8";
  const statusLabel = { connecting: "Connecting", open: "Connected", closed: "Closed", error: "Error" }[status] ?? status;

  const di = info || {};

  return (
    <div className={s.root}>
      <div className={s.topbar}>
        <div className={s.deviceInfo}>
          <InfoCol label="Client" value={(deviceId || "").slice(0, 8) + "…"} />
          <InfoCol label="Host"   value={di.hostname   || deviceHost || "—"} />
          <InfoCol label="User"   value={di.username   || deviceUser || "—"} />
          <InfoCol label="OS"     value={
            di.os
              ? `${di.os}${di.os_version ? " " + di.os_version : ""}`
              : deviceOs || "—"
          } />
        </div>

        <div className={s.actions}>
          <div className={s.statusPill} style={{ borderColor: statusColor + "55", color: statusColor }}>
            <span className={s.statusDot} style={{ background: statusColor }} />
            {statusLabel}
          </div>
          <button className={s.actionBtn}    onClick={reconnect}     title="Reconnect">↻ Reconnect</button>
          <button className={s.actionBtn}    onClick={sendCtrlC}     title="Ctrl+C">⬛ Ctrl+C</button>
          <button className={s.actionBtnAlt} onClick={clearTerminal} title="Clear">⌫ Clear</button>
        </div>
      </div>

      <div className={s.termWrap}>
        <div ref={termRef} className={s.term} />

        {status === "connecting" && (
          <div className={s.overlay}>
            <div className={s.spinner} />
            <div className={s.overlayText}>Connecting to {di.hostname || deviceHost || "device"}…</div>
          </div>
        )}

        {(status === "closed" || status === "error") && !ready && (
          <div className={s.overlayBottom}>
            <span className={s.overlayMsg}>{status === "error" ? "Connection error" : "Session closed"}</span>
            <button className={s.reconnectBtn} onClick={reconnect}>↻ Reconnect</button>
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
