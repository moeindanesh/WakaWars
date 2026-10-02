import { useEffect, useState } from "react";

export function useWindowActivity() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const remove = window.molty?.onWindowVisibility?.(setVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      remove?.();
    };
  }, []);
  return visible;
}
