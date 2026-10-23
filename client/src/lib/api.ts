import { ApiError, SpoolApi } from '@spool/shared';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:4000';

export const api = new SpoolApi({
  baseUrl: API_URL,
  getToken: () => useAuthStore.getState().token,
  getWorkspaceId: () => useAuthStore.getState().activeWorkspaceId,
  onUnauthorized: () => {
    useAuthStore.getState().logout();
    queryClient.clear();
  },
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export const queryKeys = {
  me: ['me'] as const,
  videos: (workspaceId: string | null, filters: object) => ['videos', workspaceId, filters] as const,
  allVideos: ['videos'] as const,
  video: (id: string) => ['video', id] as const,
  share: (shareId: string) => ['share', shareId] as const,
  tags: (workspaceId: string | null) => ['tags', workspaceId] as const,
  analytics: (id: string) => ['analytics', id] as const,
  chat: (shareId: string) => ['chat', shareId] as const,
  members: (workspaceId: string) => ['members', workspaceId] as const,
  health: ['health'] as const,
  search: (q: string) => ['search', q] as const,
};
