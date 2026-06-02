import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import api from "../utils/api";
import s from "./Dashboard.module.css";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();

  const [devices,  setDevices]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [newKey,   setNewKey]   = useState(null); // show API key once after create

  const load = useCallback(async () => {
    try {
      const [sr, dr] = await Promise.all([
        api.get("/api/devices/stats"),
        api.get("/api/devices"),
      ]);
      setStats(sr.data);
      setDevices(dr.data.devices);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleLogout = async () => {
    try { await api.post("/api/auth/logout", { refreshToken }); } catch {}
    logout();
    navigate("/login");
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device? This cannot be undone.")) return;
    await api.delete(`/api/devices/${id}`);
    load();
  };

  if (loading) return <Loader />;

  return (
    <div className={s.layout}>
      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.brand}>
            <span className={s.brandMark}>N</span>
            <div>
              <div className={s.brandName}>NEXUS<span style={{ color: "var(--accent)" }}>RDM</span></div>
            </div>
          </div>

          <nav className={s.nav}>
            <NavItem icon="⬡" label="DEVICES"  active />
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
        {/* Header */}
        <div className={s.header}>
          <div>
            <h1 className={s.pageTitle}>DEVICES</h1>
            <div className={s.pageSub}>// {devices.length} registered · auto-refresh 30s</div>
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ REGISTER DEVICE</button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className={s.statsRow}>
            <Stat label="TOTAL"   value={stats.total}   color="default" />
            <Stat label="ONLINE"  value={stats.online}  color="online" />
            <Stat label="OFFLINE" value={stats.offline} color="offline" />
            <Stat label="WARNING" value={stats.warning} color="warning" />
          </div>
        )}

        {/* New API key banner */}
        {newKey && (
          <div className={s.keyBanner}>
            <div className={s.keyBannerTitle}>⚠ DEVICE KEY — COPY NOW. NEVER SHOWN AGAIN.</div>
            <div className={s.keyValue}>{newKey}</div>
            <button className={s.keyClose} onClick={() => setNewKey(null)}>DISMISS</button>
          </div>
        )}

        {/* Device grid */}
        {devices.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <div className={s.deviceGrid}>
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} onDelete={() => handleDelete(d.id)} />
            ))}
          </div>
        )}
      </main>

      {/* ── Add device modal ── */}
      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onCreated={(key) => { setNewKey(key); setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

/* ─── Device Card ─────────────────────────────────────────── */
function DeviceCard({ device: d, onDelete }) {
  const status = d.status ?? "offline";
  const statusColor = { online: "var(--online)", offline: "var(--offline)", warning: "var(--warning)" }[status];
  const age = d.last_seen ? timeAgo(new Date(d.last_seen)) : "never";

  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <span className={s.dot} style={{ background: statusColor, boxShadow: status === "online" ? `0 0 6px ${statusColor}` : "none" }} />
        <span className={s.cardName}>{d.name}</span>
        <span className={s.cardStatus} style={{ color: statusColor }}>{status.toUpperCase()}</span>
      </div>

      <div className={s.cardMeta}>
        <MetaRow icon="⬡" label="HOST"     value={d.hostname ?? "—"} />
        <MetaRow icon="◈" label="OS"       value={d.os       ?? "—"} />
        <MetaRow icon="◎" label="IP"       value={d.ip_address ?? "—"} />
        <MetaRow icon="↻" label="INTERVAL" value={`${d.heartbeat_interval}s`} />
        <MetaRow icon="◷" label="LAST SEEN" value={age} />
      </div>

      {d.tags?.length > 0 && (
        <div className={s.tags}>
          {d.tags.map((t) => <span key={t} className={s.tag}>{t}</span>)}
        </div>
      )}

      <div className={s.cardActions}>
        <button className="btn-ghost" style={{ flex: 1 }}>TERMINAL</button>
        <button className="btn-ghost" style={{ flex: 1 }}>METRICS</button>
        <button className="btn-danger" onClick={onDelete}>DEL</button>
      </div>
    </div>
  );
}

/* ─── Add Device Modal ────────────────────────────────────── */
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
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        heartbeat_interval: iv,
      });
      onCreated(data.apiKey);
    } catch (e) {
      setError(e.response?.data?.error ?? "Failed to create device");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>// REGISTER DEVICE</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={s.modalBody}>
          <ModalField label="DEVICE NAME" value={name} onChange={setName} placeholder="e.g. office-pc-01" />
          <ModalField label="TAGS (comma separated, optional)" value={tags} onChange={setTags} placeholder="production, windows, dc-1" />
          <div>
            <label className={s.modalLabel}>HEARTBEAT INTERVAL (seconds, 10–300)</label>
            <input type="number" min={10} max={300} value={interval}
              onChange={(e) => setInterval(e.target.value)} />
          </div>

          {error && <div className={s.modalError}>{error}</div>}

          <div className={s.modalNote}>
            After creating, you will receive a one-time API key. Use it in build.bat to compile the agent.
          </div>
        </div>

        <div className={s.modalFooter}>
          <button className="btn-ghost" onClick={onClose}>CANCEL</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? "CREATING…" : "CREATE DEVICE →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Small components ────────────────────────────────────── */
function NavItem({ icon, label, active }) {
  return (
    <div className={`${s.navItem} ${active ? s.navActive : ""}`}>
      <span className={s.navIcon}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Stat({ label, value, color }) {
  const colors = {
    online:  "var(--online)",
    offline: "var(--text-3)",
    warning: "var(--warning)",
    default: "var(--accent)",
  };
  return (
    <div className={s.stat}>
      <div className={s.statVal} style={{ color: colors[color] }}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function MetaRow({ icon, label, value }) {
  return (
    <div className={s.metaRow}>
      <span className={s.metaIcon}>{icon}</span>
      <span className={s.metaLabel}>{label}</span>
      <span className={s.metaVal}>{value}</span>
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className={s.modalLabel}>{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyGlyph}>⬡</div>
      <div className={s.emptyTitle}>NO DEVICES REGISTERED</div>
      <div className={s.emptySub}>Register a device to get an API key, then build the agent .exe</div>
      <button className="btn-primary" style={{ marginTop: "1.25rem" }} onClick={onAdd}>+ REGISTER FIRST DEVICE</button>
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

function timeAgo(date) {
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}
