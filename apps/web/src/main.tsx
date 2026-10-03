import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./transitions.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("No se encontró el nodo raíz.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
