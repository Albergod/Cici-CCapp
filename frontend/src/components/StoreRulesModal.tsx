import { X, Check, Clock, MessageSquare, Store, Bot } from 'lucide-react';

interface StoreRulesModalProps {
  open: boolean;
  onAccept: () => void;
  onClose: () => void;
}

export function StoreRulesModal({ open, onAccept, onClose }: StoreRulesModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card p-6 md:p-8 w-full max-w-lg relative shadow-lift">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shrink-0">
            <Store className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-surface-900 leading-tight">
              Crea tu espacio de venta
            </h2>
            <p className="text-sm text-surface-500">Antes de empezar, lee las condiciones</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-surface-700">
          <div className="p-3.5 bg-brand-50 rounded-xl border border-brand-200 flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-surface-900">Periodo de prueba gratis</p>
              <p className="text-surface-600 mt-1">
                Este espacio de venta es <strong className="text-surface-800">solo para emprendedores y comerciantes</strong>.
                Obtienes <strong className="text-brand-700">14 días de prueba</strong> con todo el plan abierto
                (asistente IA, agenda y prestigio) para publicar tus productos y vender con tu cliente.
              </p>
            </div>
          </div>

          <div className="p-3.5 bg-surface-50 rounded-xl border border-surface-200 flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-100 text-surface-600 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-surface-900">Contacto con clientes</p>
              <p className="text-surface-600 mt-1">
                El canal de <strong className="text-surface-800">contacto directo con tus clientes</strong> está
                siempre disponible: durante la prueba de 14 días la IA atiende por ti, y
                después puedes seguir comunicándote tú mismo en modo manual.
              </p>
            </div>
          </div>

          <div className="p-3.5 bg-accent-50 rounded-xl border border-accent-200 flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-surface-900">Después de la prueba</p>
              <p className="text-surface-600 mt-1">
                Al finalizar tus 14 días, la <strong className="text-surface-800">asistencia IA</strong> se apaga a
                menos que elijas un plan de pago. Tu tienda sigue visible y tú atiendes el
                chat manualmente; tus clientes no pierden el contacto.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <div className="flex items-start gap-2 text-xs text-surface-500">
            <Check className="w-4 h-4 text-brand-500 shrink-0" />
            <span>
              Al continuar aceptas que este espacio es para uso comercial y que la asistencia IA depende del
              periodo de prueba o de una suscripción activa.
            </span>
          </div>
          <div className="flex gap-3">
            <button onClick={onAccept} className="btn-primary flex-1">
              <Store className="w-4 h-4" />
              Entendido, crear mi tienda
            </button>
            <button onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}