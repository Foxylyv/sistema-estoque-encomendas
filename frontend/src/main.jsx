import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter;
import { AuthProvider, useAuth } from "./auth";
import Layout, { navItems } from "./components/Layout";
import { Spinner, ToastProvider } from "./components/ui";
import Baixa from "./pages/Baixa";
import Encomendas from "./pages/Encomendas";
import Entrada from "./pages/Entrada";
import Estoque from "./pages/Estoque";
import Historico from "./pages/Historico";
import Ingredientes from "./pages/Ingredientes";
import Login from "./pages/Login";
import NovaEncomenda from "./pages/NovaEncomenda";
import Painel from "./pages/Painel";
import Produtos from "./pages/Produtos";
import Unidades from "./pages/Unidades";
import Usuarios from "./pages/Usuarios";
import "./styles.css";

function AppRoutes() {
  const auth = useAuth();
  const { user, ready, can, isMaster } = auth;
  if (!ready) return <div className="boot"><Spinner /></div>;
  if (!user) return <Login />;
  const { kitchenOnly, mode } = navItems(auth);
  const home = !kitchenOnly ? <Painel /> : mode ? <Navigate to="/encomendas" replace /> : <Baixa />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={home} />
        {can("baixa") && (!kitchenOnly || mode) && <Route path="baixa" element={<Baixa />} />}
        {mode && <Route path="encomendas" element={<Encomendas />} />}
        {mode === "loja" && <Route path="encomendas/nova" element={<NovaEncomenda />} />}
        {(isMaster || mode === "fabrica") && <Route path="produtos" element={<Produtos />} />}
        {can("entrada") && <Route path="entrada" element={<Entrada />} />}
        {can("ingredientes") && <Route path="ingredientes" element={<Ingredientes />} />}
        {can("usuarios") && <Route path="usuarios" element={<Usuarios />} />}
        {isMaster && <Route path="unidades" element={<Unidades />} />}
        <Route path="estoque" element={<Estoque />} />
        <Route path="historico" element={<Historico />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
      {import.meta.env.VITE_DEMO && <div className="demo-badge">Demonstração · dados fictícios</div>}
    </Router>
  </React.StrictMode>
);
