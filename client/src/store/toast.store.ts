import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>, durationMs?: number) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast, durationMs = 4200) => {
    const id = ++counter;
    set({ toasts: [...get().toasts.slice(-3), { ...toast, id }] });
    window.setTimeout(() => get().dismiss(id), durationMs);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ tone: 'error', title, description }, 6000),
  info: (title: string, description?: string) => useToastStore.getState().push({ tone: 'info', title, description }),
};
