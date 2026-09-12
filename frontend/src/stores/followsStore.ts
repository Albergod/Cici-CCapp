let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

export function useFollowsVersion() {
  return {
    version,
    subscribe,
    getSnapshot: () => version,
    notifyFollowsChanged: notify,
  };
}