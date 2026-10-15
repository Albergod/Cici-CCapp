import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  LogOut,
  User,
  Search,
  Store,
  LayoutDashboard,
  Settings,
  ShoppingBag,
  CircleHelp,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/stores/authStore';
import { api } from '@/services/api';
import { useEffect, useState } from 'react';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pingKey, setPingKey] = useState(0);
  const isChat = pathname.startsWith('/chat');

  // El toast se auto-oculta a los 6s.
  useEffect(() => {
    if (!pingKey) return;
    const t = setTimeout(() => setPingKey(0), 6000);
    return () => clearTimeout(t);
  }, [pingKey]);

  // Cierra el menú cuando se cambia de ruta.
  useEffect(() => {
    setMenuOpen(false);
    if (pathname.startsWith('/chat')) {
      document.title = 'CC Platform - Tu Centro Comercial Digital';
    }
  }, [pathname]);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      api.chat
        .unreadCount()
        .then(({ totalUnread }) => {
          if (cancelled) return;
          setUnread((prev) => {
            // Subió y no estoy en un chat: toast + pestaña (si no lo apagó en Ajustes).
            if (totalUnread > prev && !window.location.pathname.startsWith('/chat')) {
              try {
                if (localStorage.getItem('cici-notify-messages') !== 'off') {
                  setPingKey((k) => k + 1);
                  document.title = `(${totalUnread}) CiCi - Tu Centro Comercial Digital`;
                }
              } catch {
                /* noop */
              }
            } else if (totalUnread === 0) {
              document.title = 'CC Platform - Tu Centro Comercial Digital';
            }
            return totalUnread;
          });
        })
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [isAuthenticated]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-surface-200/70">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-instagram flex items-center justify-center shadow-soft">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <span className="text-lg font-extrabold tracking-tight bg-brand-grad bg-clip-text text-transparent">
              CiCi
            </span>
            <span className="block text-[10px] text-surface-400 font-medium -mt-0.5">
              ¡Tu Centro comercial digital!
            </span>
          </div>
        </Link>

        <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text"
              placeholder="Buscar productos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-surface-50 border border-surface-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-all"
            />
          </div>
        </form>

        <div className="flex items-center gap-1.5">
          {isAuthenticated ? (
            <>
              <Link
                to="/dashboard"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 rounded-xl transition-all text-sm font-semibold text-white shadow-soft"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">Mi Tienda</span>
              </Link>
              <Link
                to="/chat"
                className="relative p-2.5 hover:bg-surface-100 rounded-xl transition-colors text-surface-600 hover:text-brand-600"
              >
                <MessageSquare className="w-5 h-5" />
                {unread > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>

              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className={`flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl transition-colors ${
                    menuOpen ? 'bg-surface-100' : 'hover:bg-surface-100'
                  }`}
                  aria-label="Menú de usuario"
                >
                  <div className="w-8 h-8 rounded-full bg-instagram flex items-center justify-center overflow-hidden ring-2 ring-white shadow-sm">
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-sm font-semibold hidden sm:block text-surface-800 max-w-[120px] truncate">
                    {user?.name}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-surface-400 hidden sm:block transition-transform ${
                      menuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                      aria-hidden
                    />
                    <div className="absolute right-0 top-full mt-2 w-64 card overflow-hidden z-50">
                      <div className="flex items-center gap-3 p-4 border-b border-surface-100 bg-surface-50/60">
                        <div className="w-10 h-10 rounded-full bg-instagram flex items-center justify-center overflow-hidden ring-2 ring-white shadow-sm shrink-0">
                          {user?.avatarUrl ? (
                            <img
                              src={user.avatarUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-5 h-5 text-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-surface-900 truncate">
                            {user?.name}
                          </p>
                          <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                        </div>
                      </div>
                      <div className="p-1.5">
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            navigate('/mis-compras');
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-surface-700 hover:bg-surface-50 transition-colors"
                        >
                          <ShoppingBag className="w-4 h-4" />
                          Mis compras
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            navigate('/como-funciona');
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-surface-700 hover:bg-surface-50 transition-colors"
                        >
                          <CircleHelp className="w-4 h-4" />
                          Cómo funciona
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            window.dispatchEvent(new CustomEvent('cici:open-ajustes'));
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-surface-700 hover:bg-surface-50 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          Ajustes
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-accent-600 hover:bg-accent-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Cerrar sesión
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-semibold text-surface-700 hover:text-brand-600 transition-colors"
              >
                Iniciar Sesión
              </Link>
              <Link
                to="/register"
                className="px-5 py-2.5 bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 rounded-xl transition-all text-sm font-semibold text-white shadow-soft"
              >
                Registrarse
              </Link>
            </>
          )}
        </div>
      </div>

      {!isChat && (
        <div className="md:hidden max-w-7xl mx-auto px-4 pb-3">
          <form onSubmit={handleSearch}>
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
              <input
                type="text"
                placeholder="Buscar productos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-surface-50 border border-surface-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-all"
              />
            </div>
          </form>
        </div>
      )}

      {pingKey > 0 && (
        <button
          onClick={() => {
            setPingKey(0);
            document.title = 'CC Platform - Tu Centro Comercial Digital';
            navigate('/chat');
          }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-surface-900 text-white text-sm font-bold shadow-lift animate-bounce"
        >
          <MessageSquare className="w-4 h-4" />
          Tienes mensajes nuevos · tocar para ver
        </button>
      )}
    </nav>
  );
}
