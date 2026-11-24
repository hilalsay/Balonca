export interface Toast { id: number; msg: string; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void } }
export const toasts = $state<{ list: Toast[] }>({ list: [] });
let n = 0;

/** Visible, screen-reader-announced message that disappears on its own. */
export function toast(msg: string, kind: Toast['kind'] = 'info', ms = 4500, action?: Toast['action']) {
  const id = ++n;
  toasts.list.push({ id, msg, kind, ...(action ? { action } : {}) });
  setTimeout(() => dismiss(id), ms);
}
export const dismiss = (id: number) => { toasts.list = toasts.list.filter((x) => x.id !== id); };
