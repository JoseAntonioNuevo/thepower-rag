// GUÍA DE LECTURA · apps/web/src/main.tsx
// Arranque de React: monta App en el nodo #root con StrictMode y carga los estilos.
// StrictMode avisa de efectos y usos inseguros en desarrollo.
import { StrictMode } from "react";
// createRoot monta la aplicación en el DOM.
import { createRoot } from "react-dom/client";
// Componente principal.
import { App } from "./App";
// Estilos generales.
import "./styles.css";
// Animaciones.
import "./transitions.css";

// Nodo raíz del index.html.
const root = document.querySelector("#root");
// Si no existe.
if (root === null) {
  // Error.
  throw new Error("No se encontró el nodo raíz.");
}

// Renderiza la app.
createRoot(root).render(
  <StrictMode>
    {/* Componente App. */}
    <App />
  </StrictMode>,
);
