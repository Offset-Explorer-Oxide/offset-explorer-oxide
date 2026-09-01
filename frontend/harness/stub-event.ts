type Listener = (event: { payload: unknown }) => void;
const listeners: Record<string, Listener[]> = {};
(window as unknown as { __emit: (e: string, payload: unknown) => void }).__emit = (e, payload) => {
  for (const l of listeners[e] ?? []) l({ payload });
};
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> {
  (listeners[event] ??= []).push(handler as Listener);
  return () => {
    listeners[event] = (listeners[event] ?? []).filter((l) => l !== handler);
  };
}
export async function emit() {}
