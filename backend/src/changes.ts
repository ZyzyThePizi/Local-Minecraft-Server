/**
 * A tiny signal for "something others can see about this machine changed" (a server started or
 * stopped, a player joined, a server was added, the machine was renamed). The registry heartbeat
 * listens to it, so the network view updates in seconds; the emitters do not need to know who listens.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener) {
  listeners.add(fn);
}

export function changed() {
  for (const fn of listeners) fn();
}
