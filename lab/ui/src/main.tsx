// GUÍA DE LECTURA · lab/ui/src/main.tsx
// Arranca el inspector React. Los modelos y PostgreSQL solo existen en el servidor local.
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("No existe el nodo del Aula.");
createRoot(root).render(<App />);
