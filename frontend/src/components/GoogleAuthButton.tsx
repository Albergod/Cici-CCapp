import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// BOTÓN "CONTINUAR CON GOOGLE".
//
// Está activo solo si el backend reporta un GOOGLE_CLIENT_ID (GET /api/auth/config).
// Así un solo valor (el del backend) controla el botón en producción, sin
// incrustar credenciales en el build del frontend.
//
// ACTIVACIÓN (desarrollo):
//   1. Google Cloud Console → Credenciales → "ID de cliente OAuth" (Aplicación web,
//      origen autorizado http://localhost:5173).
//   2. backend .env → GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
//   3. Reinicia backend. El botón aparece en Registro y en Login.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    google?: any;
  }
}

export function GoogleAuthButton({ refCode, onSuccess }: { refCode?: string; onSuccess: () => void }) {
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);
  const { login } = useAuth();

  // Pregunta al backend si el login con Google está configurado.
  useEffect(() => {
    let cancelled = false;
    api.auth
      .config()
      .then(({ googleClientId }) => {
        if (!cancelled) setClientId(googleClientId);
      })
      .catch(() => {
        if (!cancelled) setClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Carga el script oficial de Google Identity Services cuando hay client id.
  useEffect(() => {
    if (!clientId) return;
    if (scriptLoadedRef.current) return;

    const initGoogle = async () => {
      if (!window.google || !window.google.accounts?.id) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('No se pudo cargar el script de Google'));
          document.body.appendChild(script);
        });
      }
      scriptLoadedRef.current = true;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: any) => {
          try {
            setLoading(true);
            setError(null);
            const { token, user } = await api.auth.google(response.credential, refCode);
            login(token, user);
            onSuccess();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al entrar con Google');
          } finally {
            setLoading(false);
          }
        },
      });

      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
          shape: 'rectangular',
        });
      }
    };

    initGoogle().catch((err) => {
      setError(err instanceof Error ? err.message : 'Error al cargar Google');
    });

    return () => {
      // Limpieza opcional: revocar para que no persista la sesión de Google en la página.
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) {
    return null; // Desactivado: no se renderiza nada.
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 w-full">
        <div className="flex-1 h-px bg-surface-200" />
        <span className="text-xs text-surface-400 font-medium">o</span>
        <div className="flex-1 h-px bg-surface-200" />
      </div>
      {error && (
        <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600 w-full">
          {error}
        </div>
      )}
      <div ref={buttonRef} className="min-h-[40px] flex items-center justify-center">
        {loading && <Loader2 className="w-5 h-5 animate-spin text-surface-400" />}
      </div>
    </div>
  );
}