import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/Toaster';
import { AuthPage } from '@/pages/AuthPage';
import { EditorPage } from '@/pages/EditorPage';
import { EmbedPage } from '@/pages/EmbedPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RecordPage } from '@/pages/RecordPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WatchPage } from '@/pages/WatchPage';
import { useAuthStore } from '@/store/auth.store';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <>{children}</>;
}

function HomeRedirect() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? '/library' : '/login'} replace />;
}

function Root() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <AuthPage initialMode="login" /> },
      { path: '/register', element: <AuthPage initialMode="register" /> },
      { path: '/s/:shareId', element: <WatchPage /> },
      { path: '/embed/:shareId', element: <EmbedPage /> },
      {
        path: '/edit/:videoId',
        element: (
          <RequireAuth>
            <EditorPage />
          </RequireAuth>
        ),
      },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { path: '/library', element: <LibraryPage /> },
          { path: '/record', element: <RecordPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
