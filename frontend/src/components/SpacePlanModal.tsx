import { useState } from 'react';
import {
  X,
  Check,
  Store,
  Star,
  ShoppingBag,
  Sparkles,
  ChevronRight,
} from 'lucide-react';

export type SpaceSelection =
  | { type: 'free' }
  | { type: 'paid'; cycle: 'MONTHLY' | 'BI_MONTHLY' };

const PLAN_PRICES: Record<'MONTHLY' | 'BI_MONTHLY', { price: string; perMonth: string; badge: string | null }> = {
  MONTHLY: { price: '$30.000', perMonth: '/mes', badge: null },
  BI_MONTHLY: { price: '$55.000', perMonth: '/2 meses', badge: 'Ahorra $5.000' },
};

interface SpacePlanModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: SpaceSelection) => void;
}

export function SpacePlanModal({ open, onClose, onSelect }: SpacePlanModalProps) {
  const [cycle, setCycle] = useState<'MONTHLY' | 'BI_MONTHLY'>('MONTHLY');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card p-6 md:p-8 w-full max-w-2xl relative shadow-lift my-8">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shrink-0">
            <Store className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-surface-900 leading-tight">
              Elige tu espacio de venta
            </h2>
            <p className="text-sm text-surface-500">
              Arriendo del espacio dentro del centro comercial digital
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* Plan Free */}
          <button
            onClick={() => onSelect({ type: 'free' })}
            className="p-5 rounded-2xl border border-surface-200 hover:border-brand-300 hover:bg-surface-50 text-left transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-surface-100 text-surface-600 flex items-center justify-center mb-3 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-surface-900">Comerciante Free</h3>
            <p className="text-sm text-surface-500 mt-1">
              Comienza sin pagar nada. Publica tus productos y abre tu local.
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <span className="flex items-center gap-2 text-surface-700">
                <Check className="w-4 h-4 text-emerald-500" />
                Prueba de 2 meses y 15 días gratis
              </span>
              <span className="flex items-center gap-2 text-surface-700">
                <Check className="w-4 h-4 text-emerald-500" />
                Contacto con clientes durante la prueba
              </span>
              <span className="flex items-center gap-2 text-surface-400">
                <X className="w-4 h-4" />
                Sin contacto después de la prueba
              </span>
            </div>
            <span className={`mt-4 inline-flex items-center gap-1 text-sm font-bold px-3 py-1.5 bg-brand-100 text-brand-700 rounded-full`}>
              Crear mi tienda gratis
              <ChevronRight className="w-4 h-4" />
            </span>
          </button>

          {/* Plan Premium */}
          <div className="p-5 rounded-2xl border-2 border-brand-500 bg-brand-50/40 shadow-soft relative">
            <span className="absolute -top-3 left-5 px-2.5 py-0.5 text-[11px] font-extrabold bg-gradient-to-r from-brand-600 to-accent-500 text-white rounded-full flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> RECOMENDADO
            </span>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 text-white flex items-center justify-center mb-3">
              <Star className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-surface-900">Espacio Premium</h3>
            <p className="text-sm text-surface-500 mt-1">
              Contacto con clientes garantizado y espacio permanente.
            </p>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setCycle('MONTHLY')}
                className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
                  cycle === 'MONTHLY'
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-surface-200 bg-white text-surface-600 hover:border-brand-300'
                }`}
              >
                Mensual
              </button>
              <button
                onClick={() => setCycle('BI_MONTHLY')}
                className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
                  cycle === 'BI_MONTHLY'
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-surface-200 bg-white text-surface-600 hover:border-brand-300'
                }`}
              >
                Bimensual
              </button>
            </div>

            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold text-surface-400 uppercase tracking-wide">
                  Precio del espacio
                </p>
                <p className="text-3xl font-extrabold text-surface-900 leading-none mt-1">
                  {PLAN_PRICES[cycle].price}
                  <span className="text-sm font-semibold text-surface-500">
                    {PLAN_PRICES[cycle].perMonth}
                  </span>
                </p>
              </div>
              {PLAN_PRICES[cycle].badge && (
                <span className="px-2.5 py-1 text-xs font-extrabold bg-emerald-100 text-emerald-700 rounded-full">
                  {PLAN_PRICES[cycle].badge}
                </span>
              )}
            </div>

            <div className="mt-3 text-sm text-surface-700">
              {cycle === 'MONTHLY' ? (
                <p>
                  Pagas <strong className="text-surface-900">una vez al mes</strong>. Ideal si
                  quieres pagar ligero cada mes.
                </p>
              ) : (
                <p>
                  Pagas <strong className="text-surface-900">cada 2 meses</strong> con mejor precio
                  por mes. Perfecto para ahorrar.
                </p>
              )}
            </div>

            <span className="mt-3 text-xs font-semibold text-surface-400">
              El pago del espacio se habilitará próximamente.
            </span>
            <button
              onClick={() => onSelect({ type: 'paid', cycle })}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2.5 bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 rounded-xl text-sm font-bold text-white transition-all"
            >
              Elegir espacio por {PLAN_PRICES[cycle].price}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="mt-5 text-xs text-surface-400 text-center">
          Al continuar puedes cambiar tu decisión después desde el dashboard. La forma de pago del
          espacio Premium se habilitará próximamente.
        </p>
      </div>
    </div>
  );
}