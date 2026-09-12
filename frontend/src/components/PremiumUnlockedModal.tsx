import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Sparkles,
  Award,
  BadgeCheck,
  Package,
  TrendingUp,
  Share2,
  X,
  Crown,
} from 'lucide-react';

export interface UnlockedPlanInfo {
  plan: 'PRO' | 'BUSINESS';
  cycle: 'MONTHLY' | 'BI_MONTHLY';
}

// Características que desbloquea cada plan de pago.
const PLAN_FEATURES: Record<'PRO' | 'BUSINESS', { title: string; desc: string; icon: React.ReactNode }[]> = {
  PRO: [
    {
      title: 'Sistema de prestigio activado',
      desc: 'Acumula puntos y sube en el centro comercial digital.',
      icon: <Award className="w-5 h-5" />,
    },
    {
      title: 'Código de referidos',
      desc: 'Invita a otros emprendedores y gana prestigio por cada uno.',
      icon: <Share2 className="w-5 h-5" />,
    },
    {
      title: 'Check verificado',
      desc: 'Al llegar a 100 puntos los clientes te verán con el sello oficial.',
      icon: <BadgeCheck className="w-5 h-5" />,
    },
    {
      title: 'Hasta 100 productos',
      desc: 'Publica sin tope el catálogo completo de tu local.',
      icon: <Package className="w-5 h-5" />,
    },
    {
      title: 'Métricas de ventas',
      desc: 'Sigue tu tasa de conversión y rendimiento de tu tienda.',
      icon: <TrendingUp className="w-5 h-5" />,
    },
  ],
  BUSINESS: [
    {
      title: 'Todo lo del plan Premium',
      desc: 'Prestigio, referidos, check verificado y métricas incluidas.',
      icon: <Sparkles className="w-5 h-5" />,
    },
    {
      title: 'Hasta 500 productos',
      desc: 'El catálogo más grande del centro comercial digital.',
      icon: <Package className="w-5 h-5" />,
    },
    {
      title: 'Máxima visibilidad',
      desc: 'Tu local se destaca en el feed del centro comercial.',
      icon: <TrendingUp className="w-5 h-5" />,
    },
    {
      title: 'Código de referidos',
      desc: 'Invita a otros emprendedores y gana prestigio por cada uno.',
      icon: <Share2 className="w-5 h-5" />,
    },
  ],
};

interface PremiumUnlockedModalProps {
  open: boolean;
  plan: 'PRO' | 'BUSINESS';
  cycle: 'MONTHLY' | 'BI_MONTHLY';
  onClose: () => void;
}

export function PremiumUnlockedModal({ open, plan, cycle, onClose }: PremiumUnlockedModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
    } else {
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!visible) return null;

  const features = PLAN_FEATURES[plan];
  const cycleLabel = cycle === 'MONTHLY' ? 'mensual' : 'bimensual';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`absolute inset-0 bg-surface-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`card p-6 md:p-8 w-full max-w-lg relative shadow-lift my-8 transition-all duration-300 ${
          open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center mx-auto shadow-soft">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h2 className="font-display text-2xl font-extrabold text-surface-900 mt-4">
            ¡Felicidades, tu espacio {plan} está activo!
          </h2>
          <p className="text-sm text-surface-500 mt-1.5">
            Tu pago fue confirmado con éxito. Disfruta tu plan {cycleLabel} con todas
            estas ventajas:
          </p>
        </div>

        <div className="mt-6 grid gap-2.5">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-3 p-3 rounded-2xl bg-surface-50 border border-surface-100"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
                {f.icon}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-surface-900 text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  {f.title}
                </p>
                <p className="text-xs text-surface-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose} className="btn-primary w-full mt-6">
          ¡Empezar a vender!
        </button>
      </div>
    </div>
  );
}