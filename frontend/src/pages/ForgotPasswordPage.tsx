import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { Loader2, Store, MailCheck, ArrowLeft } from 'lucide-react';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el correo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-instagram flex items-center justify-center mx-auto mb-4 shadow-soft">
              <Store className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-surface-900">Recuperar contraseña</h1>
            <p className="text-surface-500 mt-1.5">Te enviaremos un enlace para reiniciarla</p>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <MailCheck className="w-7 h-7" />
              </div>
              <p className="text-sm text-surface-600">
                Si el correo <strong>{email}</strong> está registrado, recibirás un enlace para
                restablecer tu contraseña. Revisa tu bandeja de entrada (y la de spam). El enlace
                caduca en 1 hora.
              </p>
              <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:text-brand-700">
                <ArrowLeft className="w-4 h-4" />
                Volver a iniciar sesión
              </Link>
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
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="tu@email.com"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar enlace de recuperación'
                )}
              </button>

              <p className="text-center text-sm text-surface-500">
                <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
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