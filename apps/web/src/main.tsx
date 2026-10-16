import "@fontsource-variable/anek-latin/standard.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('index.html is missing <div id="root">');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
