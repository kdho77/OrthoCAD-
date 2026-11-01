import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("pressureMapE2E")) {
    void import("@/lib/pressure-map/e2e-bootstrap").then(({ installPressureMapE2E }) => installPressureMapE2E());
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
