import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { useWindowActivity } from "../hooks/useWindowActivity";

/** Optical rim and a restrained specular reflection, independent of content. */
export function GlassSurface() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const visible = useWindowActivity();
  useEffect(() => {
    if (reduced || !visible) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = ref.current?.getBoundingClientRect();
        if (!bounds || !ref.current) return;
        const reflection = ref.current.querySelector<HTMLElement>(".glass-reflection");
        if (reflection) reflection.style.transform = `translate3d(${(event.clientX - bounds.x - bounds.width / 2) * 0.12}px, ${(event.clientY - bounds.y - bounds.height / 2) * 0.08}px, 0)`;
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); };
  }, [reduced, visible]);
  return <div ref={ref} className="glass-optics" aria-hidden="true">
    <div className="glass-reflection" />
    <div className="glass-rim" />
  </div>;
}
