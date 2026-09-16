import { Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '@/stores/authStore';
import { Navbar } from '@/components/Navbar';
import { FollowedStoresSidebar } from '@/components/FollowedStoresSidebar';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { StorePage } from '@/pages/StorePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ChatPage } from '@/pages/ChatPage';
import { SearchPage } from '@/pages/SearchPage';
import { AdminPage } from '@/pages/AdminPage';

const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

// Un usuario ya autenticado no debería poder volver a las páginas de sesión
// (login/registro/recuperación): se le manda al inicio.
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const path = window.location.pathname;
  const showSidebar = !AUTH_PAGES.some((p) => path.startsWith(p));
  const isChat = path.startsWith('/chat');

  return (
    <div className="text-surface-900">
      {showSidebar && <Navbar />}
      <div className="flex">
        {showSidebar && <FollowedStoresSidebar />}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {showSidebar && !isChat && (
        <>
          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden fixed bottom-5 left-4 z-40 p-3.5 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white shadow-lift"
            aria-label="Tus tiendas"
          >
            <Heart className="w-5 h-5" />
          </button>

          {drawerOpen && (
            <div className="lg:hidden fixed inset-0 z-50">
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setDrawerOpen(false)}
                aria-hidden
              />
              <div className="absolute top-16 bottom-0 left-0 z-10 shadow-lift">
                <FollowedStoresSidebar
                  mode="drawer"
                  onClose={() => setDrawerOpen(false)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AppLayout>
            <HomePage />
          </AppLayout>
        }
      />
      <Route
        path="/login"
        element={
          <AppLayout>
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          </AppLayout>
        }
      />
      <Route
        path="/register"
        element={
          <AppLayout>
            <GuestOnly>
              <RegisterPage />
            </GuestOnly>
          </AppLayout>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <AppLayout>
            <GuestOnly>
              <ForgotPasswordPage />
            </GuestOnly>
          </AppLayout>
        }
      />
      <Route
        path="/reset-password/:token"
        element={
          <AppLayout>
            <GuestOnly>
              <ResetPasswordPage />
            </GuestOnly>
          </AppLayout>
        }
      />
      <Route
        path="/store/:slug"
        element={
          <AppLayout>
            <StorePage />
          </AppLayout>
        }
      />
      <Route
        path="/dashboard"
        element={
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        }
      />
      <Route
        path="/chat"
        element={
          <AppLayout>
            <ChatPage />
          </AppLayout>
        }
      />
      <Route
        path="/chat/:conversationId"
        element={
          <AppLayout>
            <ChatPage />
          </AppLayout>
        }
      />
      <Route
        path="/search"
        element={
          <AppLayout>
            <SearchPage />
          </AppLayout>
        }
      />
      <Route
        path="/admin"
        element={
          <AppLayout>
            <AdminPage />
          </AppLayout>
        }
      />
    </Routes>
  );
}

export default App;