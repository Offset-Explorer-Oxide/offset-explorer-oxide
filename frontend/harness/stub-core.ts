type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
(window as unknown as { __handlers: Record<string, Handler> }).__handlers = handlers;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const h = handlers[cmd];
  if (!h) {
    console.warn("[stub] unhandled invoke", cmd, args);
    return undefined as T;
  }
  return (await h(args ?? {})) as T;
}
