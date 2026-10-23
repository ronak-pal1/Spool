import type { AuthResponse, User, Workspace } from '@spool/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  user: User | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  setSession: (session: AuthResponse) => void;
  setProfile: (user: User, workspaces: Workspace[]) => void;
  setActiveWorkspace: (id: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      workspaces: [],
      activeWorkspaceId: null,
      setSession: (session) =>
        set({
          token: session.token,
          user: session.user,
          workspaces: session.workspaces,
          activeWorkspaceId: session.workspaces[0]?.id ?? null,
        }),
      setProfile: (user, workspaces) => {
        const active = get().activeWorkspaceId;
        set({
          user,
          workspaces,
          activeWorkspaceId: workspaces.some((w) => w.id === active) ? active : (workspaces[0]?.id ?? null),
        });
      },
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      logout: () => set({ token: null, user: null, workspaces: [], activeWorkspaceId: null }),
    }),
    {
      name: 'spool-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    },
  ),
);

export function useActiveWorkspace(): Workspace | null {
  return useAuthStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0] ?? null);
}
