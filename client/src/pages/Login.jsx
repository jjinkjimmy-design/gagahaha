import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../store/auth";
import s from "./Login.module.css";

export default function Login() {
  const navigate = useNavigate();
  const { setAuth, set2faPending } = useAuthStore();

  const [stage,     setStage]     = useState("creds"); // creds | totp | register
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [name,      setName]      = useState("");
  const [code,      setCode]      = useState("");
  const [tempToken, setTempToken] = useState(null);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [showPw,    setShowPw]    = useState(false);

  const go = async (fn) => {
    setError(""); setLoading(true);
    try { await fn(); }
    catch (e) { setError(e.response?.data?.error ?? e.response?.data?.errors?.[0]?.msg ?? "Request failed"); }
    finally { setLoading(false); }
  };

  const handleLogin = () => go(async () => {
    const { data } = await axios.post("/api/auth/login", { email, password });
    if (data.require2fa) { setTempToken(data.tempToken); set2faPending(data.tempToken); setStage("totp"); }
    else { setAuth(data.user, data.accessToken, data.refreshToken); navigate("/dashboard"); }
  });

  const handleTotp = () => go(async () => {
    const { data } = await axios.post("/api/auth/2fa/verify", { tempToken, code });
    setAuth(data.user, data.accessToken, data.refreshToken);
    navigate("/dashboard");
  });

  const handleRegister = () => go(async () => {
    await axios.post("/api/auth/register", { email, password, name });
    setStage("creds"); setError(""); setName("");
    setError("Account created — sign in now.");
  });

  return (
    <div className={s.root}>
      {/* Grid + glow */}
      <div className={s.grid} />
      <div className={s.glow} />

      <div className={s.card}>
        {/* Header */}
        <div className={s.brand}>
          <div className={s.logo}>
            <span className={s.logoInner}>N</span>
          </div>
          <div>
            <div className={s.brandName}>NEXUS<span className={s.brandAccent}>RDM</span></div>
            <div className={s.brandSub}>Remote Device Management</div>
          </div>
        </div>

        <div className={s.divider} />

        {/* ── Credentials stage ── */}
        {stage === "creds" && (
          <div className={s.form}>
            <div className={s.stageLabel}>// AUTHENTICATE</div>
            <Field label="EMAIL" type="email" value={email} onChange={setEmail} placeholder="operator@company.com" autoComplete="email" />
            <Field label="PASSWORD" type={showPw ? "text" : "password"} value={password} onChange={setPassword}
              placeholder="••••••••••••" autoComplete="current-password"
              suffix={<button type="button" className={s.eyeBtn} onClick={() => setShowPw(!showPw)}>{showPw ? "HIDE" : "SHOW"}</button>} />

            {error && <div className={s.error}><span className={s.errIcon}>!</span>{error}</div>}

            <button className={`btn-primary ${s.submit}`} onClick={handleLogin} disabled={loading || !email || !password}>
              {loading ? "AUTHENTICATING…" : "SIGN IN →"}
            </button>

            <button className={s.switchBtn} onClick={() => { setStage("register"); setError(""); }}>
              First run? Create admin account
            </button>
          </div>
        )}

        {/* ── TOTP stage ── */}
        {stage === "totp" && (
          <div className={s.form}>
            <div className={s.stageLabel}>// TWO-FACTOR AUTH</div>
            <p className={s.hint}>Enter the 6-digit code from your authenticator app.</p>
            <input
              className={s.totpInput}
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              value={code}
              placeholder="000 000"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />

            {error && <div className={s.error}><span className={s.errIcon}>!</span>{error}</div>}

            <button className={`btn-primary ${s.submit}`} onClick={handleTotp} disabled={loading || code.length < 6}>
              {loading ? "VERIFYING…" : "VERIFY →"}
            </button>
            <button className={s.switchBtn} onClick={() => { setStage("creds"); setCode(""); setError(""); }}>
              ← Back to login
            </button>
          </div>
        )}

        {/* ── Register stage ── */}
        {stage === "register" && (
          <div className={s.form}>
            <div className={s.stageLabel}>// CREATE ADMIN</div>
            <p className={s.hint}>First-run only. Subsequent registrations are disabled.</p>
            <Field label="FULL NAME" type="text" value={name} onChange={setName} placeholder="Your name" />
            <Field label="EMAIL" type="email" value={email} onChange={setEmail} placeholder="admin@company.com" />
            <Field label="PASSWORD" type={showPw ? "text" : "password"} value={password} onChange={setPassword}
              placeholder="Min 12 characters"
              suffix={<button type="button" className={s.eyeBtn} onClick={() => setShowPw(!showPw)}>{showPw ? "HIDE" : "SHOW"}</button>} />

            {error && <div className={s.error}><span className={s.errIcon}>!</span>{error}</div>}

            <button className={`btn-primary ${s.submit}`} onClick={handleRegister} disabled={loading || !email || password.length < 12 || !name}>
              {loading ? "CREATING…" : "CREATE ACCOUNT →"}
            </button>
            <button className={s.switchBtn} onClick={() => { setStage("creds"); setError(""); }}>
              ← Back to login
            </button>
          </div>
        )}

        {/* Footer */}
        <div className={s.footer}>
          <span className={s.badge}>TLS</span>
          <span className={s.badge}>ARGON2ID</span>
          <span className={s.badge}>JWT+2FA</span>
          <span className={s.badge}>AES-256-GCM</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder, autoComplete, suffix }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)", letterSpacing: "0.12em" }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input type={type} value={value} autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={suffix ? { paddingRight: "4rem" } : {}} />
        {suffix && <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>{suffix}</div>}
      </div>
    </div>
  );
}
