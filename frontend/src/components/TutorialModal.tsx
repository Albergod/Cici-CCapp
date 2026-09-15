import { useEffect, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Store,
  CreditCard,
  MessageSquare,
  Rocket,
  ShieldCheck,
  Send,
} from 'lucide-react';

type Step = {
  icon: typeof HelpCircle;
  tag: string;
  title: string;
  points: string[];
  tip?: string;
};

const STEPS: Step[] = [
  {
    icon: HelpCircle,
    tag: '¡Bienvenido!',
    title: 'La página principal',
    points: [
      'Estás en la página inicial de todo. Aquí puedes ver las tiendas y sus productos.',
      'Entra a cualquier tienda, mira lo que vende y chatea con el vendedor si algo te gusta.',
      '¿Tienes algo para vender? Toca "Tienda" y crea tu espacio gratis.',
    ],
    tip: 'Piénsalo como un centro comercial: todo lo que buscas, a un toque de distancia.',
  },
  {
    icon: Store,
    tag: 'Tu espacio',
    title: 'El botón "Tienda"',
    points: [
      'En esta página está tu tienda: aquí pones tus productos, eliges tu plan y ves tus pedidos.',
      'Empiezas con el plan Gratis, sin pagar nada, para que lo pruebes tranquilo.',
      'Desde aquí también chateas con tus clientes en tiempo real cada vez que te escriben.',
    ],
  },
  {
    icon: Rocket,
    tag: 'Elige tu plan',
    title: 'Planes y ventajas',
    points: [
      'El plan Gratis siempre está ahí: con él puedes empezar y probar tu tienda.',
      'Con Premium destacas más y no pagas comisión por tus ventas.',
      'Puedes pagar tu plan con Nequi o Mercado Pago, como más te guste.',
    ],
    tip: 'Sin comisiones por venta: solo pagas el plan que elijas.',
  },
  {
    icon: CreditCard,
    tag: 'El pago de tu plan',
    title: 'Los pagos',
    points: [
      'En la app el pago es para activar tu plan: Gratis para empezar y Premium cuando quieras crecer.',
      'Pagas fácil con Nequi o Mercado Pago y tu plan se activa al instante.',
      'Tus ventas se cierran por WhatsApp con tus clientes; tu plan te ayuda a hacerlo más fácil.',
    ],
    tip: 'Nada de tarjetas complicadas: eliges cómo pagar y listo.',
  },
  {
    icon: MessageSquare,
    tag: 'Ventas que fluyen',
    title: 'WhatsApp y la factura',
    points: [
      'Hablas con tus clientes por el chat de la app, directo y en tiempo real.',
      'Con Premium, cuando tu cliente confirma su pedido con la IA, la app le permite mandar la factura directo a tu WhatsApp.',
    ],
    tip: 'Factura a WhatsApp en un toque: menos vueltas y más ventas.',
  },
  {
    icon: ShieldCheck,
    tag: 'Nuestra meta',
    title: 'Qué queremos',
    points: [
      'No cobramos comisión por tus ventas: solo queremos darte un espacio en internet para que promociones y vendas más rápido.',
      'Queremos un servicio serio, por eso hay reglas claras y castigos para quien no las cumpla.',
      'Así todos jugamos limpio y las tiendas son de verdad.',
    ],
  },
];

type TutorialModalProps = {
  open: boolean;
  onClose: () => void;
};

export function TutorialModal({ open, onClose }: TutorialModalProps) {
  const [step, setStep] = useState(0);
  const total = STEPS.length;

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const stepData = STEPS[step];
  const isLast = step === total - 1;
  const Icon = stepData.icon;

  return (
    <div className="fixed inset-0 z-[100] flex overflow-y-auto p-4">
      <div
        className="fixed inset-0 bg-surface-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="card w-full max-w-2xl relative shadow-lift overflow-hidden m-auto">
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/90 hover:bg-surface-100 text-surface-500 shadow-sm transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="grid md:grid-cols-[240px,1fr]">
          {/* Panel lateral decorativo (desktop) */}
          <div className="hidden md:flex flex-col justify-between p-6 bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 text-white">
            <div>
              <span className="inline-block px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold tracking-wide uppercase">
                {stepData.tag}
              </span>
              <div className="mt-6">
                <Icon className="w-12 h-12" strokeWidth={1.5} />
              </div>
              <h3 className="mt-3 font-display text-xl font-bold leading-snug">
                {stepData.title}
              </h3>
            </div>
            <div className="mt-6">
              <p className="text-xs text-white/70 mb-2">
                Paso {step + 1} de {total}
              </p>
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step
                        ? 'w-5 bg-white'
                        : i < step
                          ? 'w-1.5 bg-white/60'
                          : 'w-1.5 bg-white/25'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Contenido */}
          <div className="p-5 md:p-6">
            {/* Cabecera compacta (móvil) */}
            <div className="flex items-center gap-3 md:hidden mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-brand-600 uppercase tracking-wide">
                  {stepData.tag}
                </p>
                <h3 className="font-display font-bold text-surface-900 leading-tight truncate">
                  {stepData.title}
                </h3>
              </div>
              <span className="ml-auto shrink-0 text-xs font-semibold text-surface-400">
                {step + 1}/{total}
              </span>
            </div>

            {/* Progreso (móvil) */}
            <div className="flex gap-1.5 md:hidden mb-4">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? 'bg-brand-500' : 'bg-surface-200'
                  }`}
                />
              ))}
            </div>

            <ul className="space-y-2.5 md:mt-2 mb-4">
              {stepData.points.map((point, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm text-surface-600 leading-snug"
                >
                  <span className="w-1 h-1 rounded-full bg-accent-400 mt-[7px] shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            {stepData.tip && (
              <div className="flex items-start gap-2.5 rounded-xl bg-brand-50 border border-brand-100 text-brand-700 text-[13px] leading-snug p-3 mb-4">
                <Send className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{stepData.tip}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-4 border-t border-surface-200/60 mt-2">
              {step > 0 ? (
                <button onClick={() => setStep(step - 1)} className="btn-ghost">
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
              ) : (
                <span />
              )}
              {isLast ? (
                <button onClick={onClose} className="btn-primary">
                  ¡Entendido!
                </button>
              ) : (
                <button onClick={() => setStep(step + 1)} className="btn-primary">
                  Siguiente
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}