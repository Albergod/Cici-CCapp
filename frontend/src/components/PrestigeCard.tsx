import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Copy,
  Check,
  Link2,
  Trophy,
  Star,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';
import { ReferralInfo } from '@/types';
import { api } from '@/services/api';

interface PrestigeCardProps {
  onUpgrade: () => void;
}

export function PrestigeCard({ onUpgrade }: PrestigeCardProps) {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stores
      .referral()
      .then(setInfo)
      .catch(() => setError('No tienes una tienda todavía.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
      </div>
    );
  }

  // Plan gratuito: el sistema de prestigio está bloqueado (upsell).
  if (info && info.active === false) {
    return (
      <div className="card p-6 border-dashed border-2 border-surface-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-surface-100 text-surface-400 flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-surface-900">Sistema de Prestigio</h3>
            <p className="text-xs text-surface-500">Reservado para planes de pago</p>
          </div>
        </div>
        <p className="text-sm text-surface-600 leading-relaxed">
          {info.message ??
            'Activa tu Espacio Premium y gana un enlace de referidos. Cada emprendedor que invites y abra tienda suma puntos; con 100 puntos obtienes el check verificado.'}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={onUpgrade} className="btn-primary">
            <Sparkles className="w-4 h-4" />
            Activar Espacio Premium
          </button>
          {error && <span className="text-xs text-accent-600 font-semibold">{error}</span>}
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="card p-6 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-surface-100 text-surface-500 flex items-center justify-center shrink-0">
          <Star className="w-5 h-5" />
        </div>
        <p className="text-sm text-surface-500">{error ?? 'No disponible.'}</p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((info.prestigePoints / info.required) * 100));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(info.referralLink ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-1">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            info.verified ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-600'
          }`}
        >
          {info.verified ? <BadgeCheck className="w-6 h-6" /> : <Trophy className="w-5 h-5" />}
        </div>
        <div>
          <h3 className="text-lg font-extrabold text-surface-900 flex items-center gap-2">
            Sistema de Prestigio
            {info.verified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-600 text-white text-xs font-bold rounded-full">
                <BadgeCheck className="w-3.5 h-3.5" />
                Verificado
              </span>
            )}
          </h3>
          <p className="text-xs text-surface-500">
            Invita emprendedores y gana prestigio
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-3xl font-extrabold text-surface-900">
            {info.prestigePoints}
            <span className="text-base font-semibold text-surface-400"> / {info.required}</span>
          </p>
          <p className="text-xs font-semibold text-surface-500">
            puntos de prestigio · meta para el check
          </p>
        </div>
        <div className="text-right">
          {info.verified ? (
            <span className="text-xs font-bold text-brand-600">¡Estás verificado!</span>
          ) : (
            <span className="text-xs font-semibold text-surface-500">
              Te faltan {Math.max(0, info.required - info.prestigePoints)} pts para el check azul
            </span>
          )}
        </div>
      </div>

      <div className="h-2.5 bg-surface-100 rounded-full mt-3">
        <div
          className="h-2.5 bg-gradient-to-r from-brand-500 to-accent-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-surface-500 mt-3">
        Ganas <strong className="text-brand-600">25 pts</strong> por cada emprendedor que invite y
        pague su plan. Un referido que crea su tienda FREE no suma.
      </p>
      <p className="text-xs text-surface-500 mt-1">
        Tu meta sube <strong className="text-brand-600">100 pts</strong> cada vez que activas,
        renuevas o mejoras tu plan (tope 1000 pts). Una vez consigas el check, no se pierde.
      </p>

      <div className="mt-5 p-4 bg-surface-50 rounded-2xl border border-surface-200 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-surface-400 shrink-0" />
        <input
          readOnly
          value={info.referralLink ?? ''}
          className="w-full bg-transparent text-sm text-surface-700 font-semibold truncate outline-none"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          onClick={handleCopy}
          className="btn-ghost text-sm shrink-0"
          title="Copiar enlace"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}