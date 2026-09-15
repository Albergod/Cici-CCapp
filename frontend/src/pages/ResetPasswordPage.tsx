import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { Loader2, Store, CheckCircle2, ArrowLeft } from 'lucide-react';

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (!token) {
      setError('Enlace inválido o incompleto');
      return;
    }

    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-instagram flex items-center justify-center mx-auto mb-4 shadow-soft">
              <Store className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-surface-900">Nueva contraseña</h1>
            <p className="text-surface-500 mt-1.5">Elige una nueva contraseña para tu cuenta</p>
          </div>

          {done ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-sm text-surface-600">
                Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="btn-primary w-full !py-3"
              >
                Ir a iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Nueva contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="input"
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Restablecer contraseña'
                )}
              </button>

              <p className="text-center text-sm text-surface-500">
                <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:text-brand-700">
                  <ArrowLeft className="w-4 h-4" />
                  Volver a iniciar sesión
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}