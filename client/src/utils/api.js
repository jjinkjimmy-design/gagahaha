import axios from "axios";
import { useAuthStore } from "../store/auth";

// Same-origin: no base URL needed — all calls are /api/...
const api = axios.create({ withCredentials: false });

// Attach access token
api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Silent refresh on 401 TOKEN_EXPIRED
let refreshing = false;
let queue = [];

const flush = (err, token) => {
  queue.forEach((p) => (err ? p.reject(err) : p.resolve(token)));
  queue = [];
};

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config;
    if (err.response?.status === 401 && err.response?.data?.code === "TOKEN_EXPIRED" && !orig._retry) {
      if (refreshing)
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((t) => { orig.headers.Authorization = `Bearer ${t}`; return api(orig); });

      orig._retry = true;
      refreshing  = true;
      const { refreshToken, setTokens, logout } = useAuthStore.getState();

      if (!refreshToken) { logout(); return Promise.reject(err); }

      try {
        const { data } = await axios.post("/api/auth/refresh", { refreshToken });
        setTokens(data.accessToken, data.refreshToken);
        flush(null, data.accessToken);
        orig.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(orig);
      } catch (e) {
        flush(e, null);
        logout();
        return Promise.reject(e);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

export default api;
