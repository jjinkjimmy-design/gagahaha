import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user:         null,
      accessToken:  null,
      refreshToken: null,
      tempToken:    null,
      require2fa:   false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, tempToken: null, require2fa: false }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      set2faPending: (tempToken) =>
        set({ require2fa: true, tempToken }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, tempToken: null, require2fa: false }),

      isAuthed: () => !!(get().accessToken && get().user),
    }),
    {
      name: "nrdm-auth",
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }),
    }
  )
);
