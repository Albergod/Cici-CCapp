import { useState } from 'react';
import {
  X,
  Check,
  Store,
  Star,
  ShoppingBag,
  ChevronRight,
  Timer,
} from 'lucide-react';
import {
  getActivePrices,
  isEarlyAccess,
  PLAN_PRICES_REGULAR,
  EARLY_ACCESS_ENDS_AT,
} from '@/lib/plan-config';
import { formatCOP } from '@/lib/format';
import { useCountdown, Countdown } from '@/lib/useCountdown';

export type SpaceSelection =
  | { type: 'free' }
  | { type: 'paid'; plan: 'PRO' | 'BUSINESS'; cycle: 'MONTHLY' | 'BI_MONTHLY' };

export type UpgradeSelection = {
  plan: 'PRO' | 'BUSINESS';
  cycle: 'MONTHLY' | 'BI_MONTHLY';
};

interface SpacePlanModalProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (selection: SpaceSelection) => void;
  onUpgrade?: (selection: UpgradeSelection) => void;
  mode?: 'create' | 'upgrade';
}

function PaidPlanCard({
  plan,
  title,
  desc,
  icon,
  badge,
  badgeClass,
  isHighlight,
  features,
  buttonLabel,
  onUpgrade,
  promoActive,
  countdown,
}: {
  plan: 'PRO' | 'BUSINESS';
  title: string;
  desc: string;
  icon: React.ReactNode;
  badge: string | null;
  badgeClass: string;
  isHighlight?: boolean;
  features: { text: string; included: boolean }[];
  buttonLabel: string;
  onUpgrade: (sel: UpgradeSelection) => void;
  promoActive: boolean;
  countdown: Countdown;
}) {
  const [cycle, setCycle] = useState<'MONTHLY' | 'BI_MONTHLY'>('MONTHLY');
  const prices = getActivePrices();
  const price = prices[cycle];
  const perMonth = cycle === 'MONTHLY' ? '/mes' : '/2 meses';
  const regularAmount = PLAN_PRICES_REGULAR[cycle].amount;

  const cd = countdown.ended ? null : (
    <span>
      {countdown.days > 0 && `${countdown.days}d `}
      {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:
      {String(countdown.seconds).padStart(2, '0')}
    </span>
  );

  return (
    <div
      className={`p-4 md:p-5 rounded-2xl text-left transition-all relative ${
        isHighlight
          ? 'border-2 border-brand-500 bg-brand-50/40 shadow-soft'
          : 'border border-surface-200'
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-3 left-5 px-2.5 py-0.5 text-[11px] font-extrabold text-white rounded-full flex items-center gap-1 ${badgeClass}`}
        >
          {badge}
        </span>
      )}
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
          isHighlight
            ? 'bg-gradient-to-r from-brand-600 to-accent-500 text-white'
            : 'bg-surface-100 text-surface-600'
        }`}
      >
        {icon}
      </div>
      <h3 className="font-extrabold text-surface-900">{title}</h3>
      <p className="text-sm text-surface-500 mt-1">{desc}</p>
      <div className="mt-3 space-y-2 text-sm">
        {features.map((f) => (
          <span
            key={f.text}
            className="flex items-center gap-2 text-surface-700"
          >
            {f.included ? (
              <Check className="w-4 h-4 text-emerald-500" />
            ) : (
              <X className="w-4 h-4 text-surface-300" />
            )}
            {f.text}
          </span>
        ))}
      </div>

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
          <p className="text-2xl md:text-3xl font-extrabold text-surface-900 leading-none mt-1">
            {formatCOP(price.amount)}
            <span className="text-sm font-semibold text-surface-500">
              {perMonth}
            </span>
          </p>
          {promoActive && (
            <p className="text-xs font-semibold text-surface-400 line-through mt-1">
              {formatCOP(regularAmount)}/mes regular
            </p>
          )}
        </div>
        {price.savings && (
          <span className="px-2.5 py-1 text-xs font-extrabold bg-emerald-100 text-emerald-700 rounded-full">
            {price.savings}
          </span>
        )}
      </div>

      {promoActive && cd && (
        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 rounded-full">
          <Timer className="w-3.5 h-3.5" />
          Promo por lanzamiento · termina en {cd}
        </div>
      )}

      <div className="mt-3 text-sm text-surface-700">
        {cycle === 'MONTHLY' ? (
          <p>
            Pagas <strong className="text-surface-900">una vez al mes</strong>. Ideal si quieres
            pagar ligero cada mes.
          </p>
        ) : (
          <p>
            Pagas <strong className="text-surface-900">cada 2 meses</strong> con mejor precio por
            mes. Perfecto para ahorrar.
          </p>
        )}
      </div>

      <button
        onClick={() => onUpgrade({ plan, cycle })}
        className={`mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${
          isHighlight
            ? 'bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600'
            : 'bg-surface-900 hover:bg-surface-800'
        }`}
      >
        {buttonLabel}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

export function SpacePlanModal({ open, onClose, onSelect, onUpgrade, mode = 'create' }: SpacePlanModalProps) {
  const promoActive = isEarlyAccess();
  const countdown = useCountdown(EARLY_ACCESS_ENDS_AT);

  if (!open) return null;

  const isUpgrade = mode === 'upgrade';

  return (
    <div className="fixed inset-0 z-[100] flex overflow-y-auto p-4">
      <div
        className="fixed inset-0 bg-surface-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card p-4 md:p-8 w-full max-w-2xl relative shadow-lift m-auto">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/90 hover:bg-surface-100 text-surface-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shrink-0">
            <Store className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg md:text-xl font-extrabold text-surface-900 leading-tight">
              {isUpgrade ? 'Activa tu Espacio Premium' : 'Elige tu espacio de venta'}
            </h2>
            <p className="text-sm text-surface-500">
              {isUpgrade
                ? 'Desbloquea los beneficios del plan de pago'
                : 'Arriendo del espacio dentro del centro comercial digital'}
            </p>
          </div>
        </div>

        <div className={`mt-6 ${isUpgrade ? 'max-w-md mx-auto' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}`}>
          {!isUpgrade && (
            <button
              onClick={() => onSelect?.({ type: 'free' })}
              className="p-4 rounded-2xl border border-surface-200 hover:border-brand-300 hover:bg-surface-50 text-left transition-all group"
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
                  Prueba de 30 días gratis
                </span>
                <span className="flex items-center gap-2 text-surface-700">
                  <Check className="w-4 h-4 text-emerald-500" />
                  Contacto con clientes siempre disponible
                </span>
                <span className="flex items-center gap-2 text-surface-400">
                  <X className="w-4 h-4" />
                  Sin sistema de prestigio ni referidos
                </span>
                <span className="flex items-center gap-2 text-surface-400">
                  <X className="w-4 h-4" />
                  Solo 20 productos
                </span>
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold px-3 py-1.5 bg-brand-100 text-brand-700 rounded-full">
                Crear mi tienda gratis
                <ChevronRight className="w-4 h-4" />
              </span>
            </button>
          )}

          <PaidPlanCard
            plan="PRO"
            title="Espacio Premium"
            desc="Contacto con clientes garantizado y espacio permanente."
            icon={<Star className="w-5 h-5" />}
            badge={isUpgrade ? null : 'RECOMENDADO'}
            badgeClass="bg-gradient-to-r from-brand-600 to-accent-500"
            isHighlight={true}
            features={[
              { text: 'Sistema de prestigio y referidos', included: true },
              { text: 'Check verificado al llegar a 100 puntos', included: true },
              { text: 'Hasta 100 productos', included: true },
              { text: 'Métricas de ventas y tasa de conversión', included: true },
            ]}
            buttonLabel="Elegir este espacio"
            onUpgrade={(sel) => (isUpgrade ? onUpgrade?.(sel) : onSelect?.({ type: 'paid', plan: sel.plan, cycle: sel.cycle }))}
            promoActive={promoActive}
            countdown={countdown}
          />
        </div>

        <p className="mt-5 text-xs text-surface-400 text-center">
          {isUpgrade
            ? 'Al elegir un plan de pago se desbloquea el sistema de prestigio, tu enlace de referidos y toda la suite de métricas exclusivas.'
            : 'Al continuar puedes cambiar tu decisión después desde el dashboard. Con el espacio Premium se desbloquea tu sistema de prestigio y tu enlace de referidos.'}
        </p>
      </div>
    </div>
  );
}