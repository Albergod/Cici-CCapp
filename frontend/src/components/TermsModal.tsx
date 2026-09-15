import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
}

const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. El servicio',
    body:
      'Esta plataforma conecta clientes con comerciantes locales. Las ventas se cierran por el WhatsApp del comerciante y este es el único canal de contacto directo entre las partes. La plataforma cobra únicamente por el plan del comerciante (Nequi o Mercado Pago); nunca recibe el dinero de tus ventas.',
  },
  {
    title: '2. Comunicación respetuosa (obligatoria)',
    body:
      'El chat se usa para comprar y vender, no para insultar ni maltratar. Está prohibido: groserías e insultos, acoso, presión agresiva, intimidación, amenazas, discriminación, extorsión y divulgar datos privados de otra persona (doxxing).',
  },
  {
    title: '3. Cómo se vigila el chat',
    body:
      'Los mensajes se revisan con filtros automáticos y con inteligencia artificial. Un mensaje ofensivo no se publica y queda registrado como una falta. Si la IA detecta abuso después de enviado, el mensaje se retira. No necesitas reportar para que actuemos: el sistema corrige de manera automática, y una persona puede revisar tu caso si lo pides.',
  },
  {
    title: '4. Sanciones por conducta (escalera)',
    body:
      'Cada falta cuenta dentro de los últimos 30 días y sube de nivel sin excepción:\n• 1.ª falta: aviso.\n• 2.ª falta: silencio del chat por 48 horas.\n• 3.ª falta: suspensión de la cuenta por 7 días (tu tienda también se suspende).\n• 4.ª falta en adelante: expulsión permanente.\nLas faltas graves (amenaza, odio, extorsión, doxxing) se castigan con expulsión inmediata, sin aviso previo.',
  },
  {
    title: '5. Impacto para comerciantes',
    body:
      'Si el dueño de una tienda es quien incurre en faltas, su tienda queda suspendida o expulsada junto con la cuenta. Mientras dura la sanción no puede operar ni recibir contactos.',
  },
  {
    title: '6. Responsabilidad de los mensajes',
    body:
      'Tú eres responsable del contenido que escribes. La plataforma no garantiza la veracidad de los mensajes entre usuarios: antes de pagar o acordar algo, confirma los detalles con el comerciante y compra solo si estás seguro.',
  },
  {
    title: '7. Datos personales',
    body:
      'Guardamos solo los datos necesarios para el servicio (correo, nombre y mensajes del chat). Los usamos para hacer cumplir estas normas y nunca se venden a terceros.',
  },
  {
    title: '8. Cambios en las normas',
    body:
      'Podemos actualizar estos términos. Si cambian algo importante, te lo avisamos en la aplicación antes de que entre en vigor. Seguir usando la plataforma significa que aceptas la versión vigente.',
  },
];

export default function TermsModal({ open, onClose }: TermsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex overflow-y-auto p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="m-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Términos y Condiciones
            </h2>
            <p className="text-xs text-gray-500">
              Reglas de la comunidad y de uso del chat
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-gray-700">
          <p className="font-medium text-gray-900">
            Bienvenido. Antes de usar la plataforma lee estas reglas: son cortas
            y te evitan malentendidos.
          </p>
          {TERMS_SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="text-sm font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-1 whitespace-pre-line">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-6 py-4 text-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#F472B6] px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}