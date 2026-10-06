import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, Download, ShieldCheck, Loader2, ArrowLeft } from 'lucide-react';

interface AppVersion {
  versionName: string;
  versionCode: number;
  size: number;
  sha256: string;
  file: string;
  updatedAt?: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STEPS = [
  'Toca el botón Descargar y abre el archivo cuando termine.',
  'Android pedirá permiso para “instalar apps desconocidas”: acéptalo solo para el navegador.',
  'Si Play Protect muestra una advertencia, verifica que el SHA-256 coincida con el publicado abajo.',
  'Abre CiCi, crea tu cuenta o entra como invitado. ¡Listo!',
];

export function DownloadPage() {
  const [version, setVersion] = useState<AppVersion | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/app-version.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setVersion)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio
        </Link>

        <div className="card p-8 md:p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-8 h-8" />
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight mb-2">
            Descarga la app CiCi
          </h1>
          <p className="text-surface-500 mb-6">
            Tiendas, chat y pedidos desde tu Android.
          </p>

          {error ? (
            <p className="text-sm text-red-500 mb-4">
              No pudimos leer la versión publicada. Intenta más tarde.
            </p>
          ) : !version ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-4 text-brand-500" />
          ) : (
            <>
              <a
                href="/cici.apk"
                download
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white font-semibold shadow-lift hover:opacity-95 transition mb-3"
              >
                <Download className="w-5 h-5" />
                Descargar v{version.versionName}
              </a>
              <p className="text-xs text-surface-500 mb-8">
                {formatSize(version.size)} • Actualizada el{' '}
                {version.updatedAt ? new Date(version.updatedAt).toLocaleDateString('es-CO') : '—'}
              </p>
            </>
          )}

          <div className="text-left bg-surface-50 rounded-2xl p-5 mb-6">
            <h2 className="font-semibold mb-3">Cómo instalarla</h2>
            <ol className="space-y-2.5 text-sm text-surface-600">
              {STEPS.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          {version && (
            <p className="text-xs text-surface-400 break-all flex items-start gap-1.5 justify-center">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              SHA-256: {version.sha256}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
