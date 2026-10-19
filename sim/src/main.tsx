import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// NOTE: no StrictMode — its double-effect mount would fire two `initialize`
// handshakes and duplicate rows in the judges-facing tool inspector.
const el = document.getElementById("root");
if (!el) throw new Error("no #root");
createRoot(el).render(<App />);
