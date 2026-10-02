import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GlassSurface } from "./components/GlassSurface";
import "./styles.css";
import { MotionConfig } from "motion/react";
import { useWindowActivity } from "./hooks/useWindowActivity";

function AnimatedApp() {
  const visible = useWindowActivity();
  React.useEffect(() => {
    document.documentElement.dataset.windowHidden = String(!visible);
  }, [visible]);
  return (
    <MotionConfig reducedMotion={visible ? "user" : "always"}>
      <App />
      <GlassSurface />
    </MotionConfig>
  );
}

document.documentElement.dataset.desktop = String(Boolean(window.molty));
const container = document.getElementById("root");

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <AnimatedApp />
    </React.StrictMode>,
  );
}
