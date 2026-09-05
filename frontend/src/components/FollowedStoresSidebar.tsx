import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Store } from '@/types';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { Store as StoreIcon, Heart, LogIn, Compass, Loader2, X } from 'lucide-react';

interface FollowedStoresSidebarProps {
  mode?: 'fixed' | 'drawer';
  onClose?: () => void;
}

export function FollowedStoresSidebar({
  mode = 'fixed',
  onClose,
}: FollowedStoresSidebarProps) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const isDrawer = mode === 'drawer';
  const shell = isDrawer
    ? 'flex w-80 h-full flex-col bg-white'
    : 'hidden lg:flex w-64 h-[calc(100vh-4rem)] sticky top-16 bg-white border-r border-surface-200 flex-col shrink-0';

  useEffect(() => {
    if (!isAuthenticated) {
      setStores([]);
      return;
    }
    let active = true;
    setLoading(true);
    api.stores
      .following()
      .then((data) => {
        if (active) setStores(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  return (
    <>
      <aside className={shell}>
        {isDrawer && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200">
            <p className="text-sm font-extrabold text-surface-900">Tus tiendas</p>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {!isAuthenticated ? (
          <div className="flex flex-col items-center justify-center p-6 h-full">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center mb-3">
              <StoreIcon className="w-7 h-7 text-white" />
            </div>
            <p className="text-center font-bold text-surface-900 mb-1">
              Tu centro comercial
            </p>
            <p className="text-center text-sm text-surface-500 mb-5">
              Inicia sesión para seguir tiendas y tenerlas a la mano.
            </p>
            <button
              onClick={() => {
                navigate('/login');
                onClose?.();
              }}
              className="btn-primary w-full"
            >
              <LogIn className="w-4 h-4" />
              Iniciar sesión
            </button>
          </div>
        ) : (
          <>
            <div className={isDrawer ? 'p-4 pb-2' : 'p-5 pb-3'}>
              <p className="flex items-center gap-2 text-sm font-extrabold text-surface-900">
                <Heart className="w-4 h-4 text-accent-500" />
                Tiendas que sigues
              </p>
              <p className="text-xs text-surface-400 mt-0.5">
                Acceso rápido a tus favoritas
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
                </div>
              ) : stores.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <div className="w-12 h-12 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-3">
                    <Heart className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-surface-500 mb-1">
                    Aún no sigues ninguna tienda
                  </p>
                  <p className="text-xs text-surface-400">
                    Sigue tiendas para tenerlas aquí a la mano.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {stores.map((s) => (
                    <Link
                      key={s.id}
                      to={`/store/${s.slug}`}
                      onClick={() => onClose?.()}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-50 transition-colors group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center overflow-hidden shrink-0">
                        {s.logoUrl ? (
                          <img src={s.logoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sm font-extrabold text-white">
                            {s.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-surface-900 text-sm truncate group-hover:text-brand-600 transition-colors">
                          {s.name}
                        </p>
                        {s.plan !== 'FREE' && (
                          <p className="text-[11px] font-bold text-brand-600">{s.plan}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-surface-200">
              <Link
                to="/"
                onClick={() => onClose?.()}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-surface-600 hover:text-brand-600 hover:bg-surface-50 transition-colors"
              >
                <Compass className="w-4 h-4" />
                Explorar tiendas
              </Link>
            </div>
          </>
        )}
      </aside>

      {isDrawer && (
        <div
          className="absolute inset-0 bg-black/40 z-0"
          onClick={onClose}
          aria-hidden
        />
      )}
    </>
  );
}