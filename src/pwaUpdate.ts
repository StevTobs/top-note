import { useSyncExternalStore } from "react";

// Bridges vite-plugin-pwa's imperative registerSW() callback (called from main.tsx, outside
// React) into a tiny reactive store components can subscribe to, same useSyncExternalStore
// pattern as src/store.ts. registerType is "prompt": a new service worker installs in the
// background but stays "waiting" until something calls update(true) — without this, a tab
// left open (or reopened before all old tabs closed) never sees a newer deploy.
let needsRefresh = false;
let apply: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export function announceUpdate(
  update: (reloadPage?: boolean) => Promise<void>,
) {
  needsRefresh = true;
  apply = update;
  listeners.forEach((l) => l());
}
export function applyUpdate() {
  void apply?.(true);
}
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => needsRefresh,
  );
}
