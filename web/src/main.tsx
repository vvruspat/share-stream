import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { DesktopApp } from "./desktop/DesktopApp.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{window.shareStreamDesktop ? <DesktopApp /> : <App />}</StrictMode>,
);
