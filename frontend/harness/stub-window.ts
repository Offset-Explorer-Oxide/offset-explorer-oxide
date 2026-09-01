export function getCurrentWindow() {
  return {
    close: async () => {},
    onFocusChanged: async (_h: (e: { payload: boolean }) => void) => () => {},
  };
}
