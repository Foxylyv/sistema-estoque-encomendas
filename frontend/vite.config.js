import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, /api é redirecionado para o Django (porta 8000).
// host: true expõe na rede local para testar no tablet/celular.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
