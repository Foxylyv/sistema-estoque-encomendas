import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  api, login as apiLogin, logout as apiLogout, setEstablishment, setUnauthorizedHandler, tokens,
} from "./api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const EST_KEY = "srgrao.unidade";
const readEst = () => {
  try {
    return Number(localStorage.getItem(EST_KEY)) || null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState({ allow_negative_stock: false, kitchen_undo_minutes: 15, capabilities: [] });
  const [establishments, setEstablishments] = useState([]);
  const [current, setCurrent] = useState(null);

  const loadEstablishments = useCallback(async (u) => {
    const list = await api("/establishments/");
    setEstablishments(list);
    let chosen;
    if (u.is_master_user) {
      const saved = readEst();
      const active = list.filter((e) => e.active);
      chosen = active.find((e) => e.id === saved) || active[0] || null;
    } else {
      chosen = list.find((e) => e.id === u.establishment) || null;
    }
    setEstablishment(chosen?.id ?? null);
    setCurrent(chosen);
    return list;
  }, []);

  async function bootstrap(u) {
    await loadEstablishments(u).catch(() => {});
    api("/meta/").then(setMeta).catch(() => {});
    setUser(u);
  }

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!tokens.get()) {
      setReady(true);
      return;
    }
    api("/auth/me/")
      .then(bootstrap)
      .catch(() => tokens.set(null))
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const caps = user?.effective_capabilities || [];
  const value = {
    user,
    ready,
    meta,
    isMaster: !!user?.is_master_user,
    can: (code) => caps.includes(code),
    establishments,
    establishment: current,
    selectEstablishment(est) {
      setEstablishment(est.id);
      setCurrent(est);
      try {
        localStorage.setItem(EST_KEY, String(est.id));
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
    },
    reloadEstablishments: () => user && loadEstablishments(user),
    async login(username, password) {
      const me = await apiLogin(username, password);
      await bootstrap(me);
      return me;
    },
    logout() {
      apiLogout();
      setEstablishment(null);
      setUser(null);
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
