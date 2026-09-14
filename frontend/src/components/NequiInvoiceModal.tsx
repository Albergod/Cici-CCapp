import { X, Wallet, Check, Smartphone, ShieldCheck, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getActivePrices } from '@/lib/plan-config';
import { formatCOP } from '@/lib/format';

export type PlanCycle = 'MONTHLY' | 'BI_MONTHLY';

// ─── Configuración del cobro Nequi Negocios ──────────────────────────
// Cada ciclo de pago tiene SU PROPIO QR con el monto predefinido, para que el
// cliente escanee el correcto y pague bien. Cuando tengas tu cuenta de Nequi
// Negocios, genera UN link/QR de cobro por cada monto y pégalo aquí.
const APP_BRAND = 'CC Platform';

// IMPORTANTE: pega aquí la URL real de cobro Nequi (con monto predefinido) de
// CADA plan. Mientras no la tengas, déjalos en null y se generará un marcador
// para que la factura luzca igual.
const NEQUI_URLS: Record<PlanCycle, string | null> = {
  MONTHLY: null, // ej. "https://cuenta-nequi.com/cobrar?monto=20000&concepto=mes"
  BI_MONTHLY: null, // ej. "https://cuenta-nequi.com/cobrar?monto=30000&concepto=bimensual"
};

function buildPaymentData(cycle: PlanCycle): string {
  // Usa el QR con monto específico del ciclo; si no está configurado aún,
  // genera un marcador con el plan y monto para no romper la factura.
  const url = NEQUI_URLS[cycle];
  const price = String(getActivePrices()[cycle].amount);
  if (url) return url;
  return cycle === 'MONTHLY'
    ? `CC Platform · Espacio Mensual · ${price}`
    : `CC Platform · Espacio Bimensual · ${price}`;
}

function buildInvoiceData(cycle: PlanCycle) {
  const price = getActivePrices()[cycle];
  return {
    price: String(price.amount),
    perMonth: cycle === 'MONTHLY' ? '/mes' : '/2 meses',
    period: cycle === 'MONTHLY' ? '1 mes de espacio' : '2 meses de espacio',
    savings: price.savings,
    badge: cycle === 'MONTHLY' ? 'Mensual' : 'Bimensual',
  };
}

interface NequiInvoiceModalProps {
  open: boolean;
  cycle: PlanCycle;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
  bottomNote?: string;
}

export function NequiInvoiceModal({
  open,
  cycle,
  onConfirm,
  onClose,
  confirmLabel = 'Ya pagué, crear mi tienda',
  bottomNote = 'Al confirmar, tu tienda se crea con el Espacio Premium activo y se desbloquea tu sistema de prestigio y referidos. La validación manual del pago se habilita en una próxima fase.',
}: NequiInvoiceModalProps) {
  if (!open) return null;

  const data = buildInvoiceData(cycle);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-accent-500 to-brand-600 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-surface-900 leading-tight">
              Paga con Nequi
            </h2>
            <p className="text-sm text-surface-500">Escanea y completa tu pago</p>
          </div>
        </div>

        {/* Monto */}
        <div className="mt-5 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-500 p-6 text-white text-center shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
            Total a pagar
          </p>
          <p className="text-4xl font-extrabold mt-1">{formatCOP(Number(data.price))}</p>
          <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold">
            {data.badge} · {data.perMonth}
          </span>
        </div>

        {/* QR de cobro */}
        <div className="mt-6 flex flex-col items-center">
          <div className="p-4 bg-white border-2 border-surface-200 rounded-2xl">
            <QRCodeSVG
              value={buildPaymentData(cycle)}
              size={168}
              level="M"
              marginSize={0}
            />
          </div>
          <p className="mt-2 text-xs font-bold text-surface-700 flex items-center gap-1">
            <QrCode className="w-3.5 h-3.5 text-brand-500" />
            Escanea para pagar {formatCOP(Number(data.price))} a {APP_BRAND}
          </p>
        </div>

        {/* Detalles de la factura */}
        <div className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between py-2 border-b border-surface-100">
            <span className="text-surface-500">Beneficiario</span>
            <span className="font-semibold text-surface-900">{APP_BRAND}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-surface-100">
            <span className="text-surface-500">Concepto</span>
            <span className="font-semibold text-surface-900">
              Arriendo de espacio · {data.period}
            </span>
          </div>
          <div className="flex justify-between py-2 border-b border-surface-100">
            <span className="text-surface-500">Período cubierto</span>
            <span className="font-semibold text-surface-900">{data.period}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-surface-100">
            <span className="text-surface-500">Monto</span>
            <span className="font-semibold text-surface-900">{formatCOP(Number(data.price))}</span>
          </div>
          {data.savings && (
            <div className="flex justify-between py-2">
              <span className="text-surface-500">Ahorro</span>
              <span className="font-semibold text-emerald-600">{data.savings}</span>
            </div>
          )}
        </div>

        {/* Cómo pagar */}
        <div className="mt-4 p-4 bg-accent-50 border border-accent-200 rounded-xl text-sm">
          <p className="flex items-start gap-2 text-accent-700">
            <Smartphone className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Paso a paso:</strong> abre Nequi → selecciona pagar con código QR →
              escanea este código → confirma el pago de <strong>{formatCOP(Number(data.price))}</strong>.
            </span>
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <button onClick={onConfirm} className="btn-primary w-full">
            <Check className="w-4 h-4" />
            {confirmLabel}
          </button>
          <button
            onClick={onClose}
            className="w-full text-center text-sm font-semibold text-surface-500 hover:text-surface-700 py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[11px] text-surface-400">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {bottomNote}
        </p>
      </div>
    </div>
  );
}