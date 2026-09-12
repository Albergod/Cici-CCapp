import { Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { FollowedStoresSidebar } from '@/components/FollowedStoresSidebar';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { StorePage } from '@/pages/StorePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ChatPage } from '@/pages/ChatPage';
import { SearchPage } from '@/pages/SearchPage';
import { AdminPage } from '@/pages/AdminPage';

const AUTH_PAGES = ['/login', '/register'];

function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const path = window.location.pathname;
  const showSidebar = !AUTH_PAGES.some((p) => path.startsWith(p));

  return (
    <div className="text-surface-900">
      <Navbar />
      <div className="flex">
        {showSidebar && <FollowedStoresSidebar />}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {showSidebar && (
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
            <LoginPage />
          </AppLayout>
        }
      />
      <Route
        path="/register"
        element={
          <AppLayout>
            <RegisterPage />
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