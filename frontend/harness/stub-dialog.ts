const w = window as never as { __dialogSave?: string | null; __dialogCalls?: unknown[] };
export async function open() { return null; }
export async function save(options?: unknown) {
  (w.__dialogCalls ??= []).push(options);
  return w.__dialogSave ?? null;
}
