import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";

export type ProfileOrigin = { row: DOMRect; avatar: DOMRect };
const OriginContext = createContext<ProfileOrigin | null>(null);
const travel = { type: "spring" as const, stiffness: 260, damping: 29, mass: 1 };

// Keep the original list mounted. The glass opens from the selected row,
// while the avatar travels independently so text never stretches with the panel.
export function ProfileTransition({ open, origin, username, onClose, onClosed, children }: {
  open: boolean; origin: ProfileOrigin; username: string;
  onClose: () => void; onClosed: () => void; children: ReactNode;
}) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>("#root > .app");
    const overflow = document.body.style.overflow;
    app?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      app?.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, []);
  const width = Math.min(window.innerWidth, 460);
  const left = (window.innerWidth - width) / 2;
  const top = window.innerWidth >= 600 ? 28 : 0;
  const inset = `inset(${Math.max(0, origin.row.top - top)}px ${Math.max(0, left + width - origin.row.right)}px ${Math.max(0, window.innerHeight - top - origin.row.bottom)}px ${Math.max(0, origin.row.left - left)}px round 15px)`;
  return createPortal(
    <OriginContext.Provider value={origin}>
      <AnimatePresence onExitComplete={onClosed}>
        {open && (
          <motion.div
            className="profile-layer"
            role="dialog"
            aria-modal="true"
            aria-label={`${username} activity`}
            initial={reduced ? { opacity: 0 } : { clipPath: inset }}
            animate={{ opacity: 1, clipPath: "inset(0px 0px 0px 0px round 20px)" }}
            exit={reduced ? { opacity: 0 } : { clipPath: inset, transition: { duration: 0.42, ease: [0.32, 0, 0.2, 1] } }}
            transition={reduced ? { duration: 0.1 } : travel}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                onClose();
              }
              if (event.key !== "Tab") return;
              const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
              )).filter((node) => node.getClientRects().length > 0);
              const first = nodes[0], last = nodes.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
              }
            }}
          >
            <div className="profile-scroll">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </OriginContext.Provider>, document.body,
  );
}

export function TravelingAvatar({ children }: { children: ReactNode }) {
  const origin = useContext(OriginContext);
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0, scale: 1 });
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const target = ref.current?.getBoundingClientRect();
    if (origin && target) setOffset({
      x: origin.avatar.x + origin.avatar.width / 2 - target.x - target.width / 2,
      y: origin.avatar.y + origin.avatar.height / 2 - target.y - target.height / 2,
      scale: origin.avatar.width / target.width,
    });
    setMeasured(true);
  }, [origin]);
  return (
    <div className="traveling-avatar" ref={ref}>
      {measured && <motion.div
        initial={reduced ? false : offset}
        animate={{ x: 0, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { ...offset, transition: { duration: 0.4, ease: [0.32, 0, 0.2, 1] } }}
        transition={travel}
        style={{ visibility: present || !reduced ? "visible" : "hidden" }}
      >{children}</motion.div>}
    </div>
  );
}
