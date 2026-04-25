import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(<App />);
