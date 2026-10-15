import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, X } from 'lucide-react';
import { api } from '@/services/api';
import { formatCOP } from '@/lib/format';

interface ProtectedCheckoutModalProps {
  orderId: string;
  onClose: () => void;
  onPaid: () => void;
}

type Phase = 'form' | 'waiting' | 'done';

export function ProtectedCheckoutModal({ orderId, onClose, onPaid }: ProtectedCheckoutModalProps) {
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [charge, setCharge] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const pollUntilHeld = () => {
    const started = Date.now();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await api.protected.status(orderId);
        if (s.status === 'held' || s.status === 'released' || s.status === 'paid_out') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setPhase('done');
          onPaid();
        } else if (s.status === 'refunded' || s.status === 'cancelled') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setError('El pago fue devuelto o cancelado.');
          setPhase('form');
        } else if (Date.now() - started > 3 * 60 * 1000) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setError('Sigue pendiente en Nequi. Puedes cerrar y volver a revisar más tarde.');
          setPhase('form');
        }
      } catch {
        /* reintenta en el siguiente ciclo */
      }
    }, 4000);
  };

  const start = async () => {
    setError(null);
    if (!/^3\d{9}$/.test(phone.trim())) {
      setError('Pon tu Nequi (10 dígitos, empieza en 3).');
      return;
    }
    setBusy(true);
    try {
      const r = await api.protected.checkout(orderId, phone.trim());
      setCharge(r.charge);
      setPhase('waiting');
      pollUntilHeld();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el cobro.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-surface-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative card p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-bold text-lg text-surface-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Pago protegido
          </h3>
          <button onClick={onClose} className="p-1.5 text-surface-400 hover:text-surface-700" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-surface-500 mb-4">
          Tu plata queda retenida hasta que recibas el pedido (máx 48h). Comisión 2.5% + 2.5% la tienda.{' '}
          <a href="/como-funciona#pago-protegido" target="_blank" rel="noreferrer" className="font-semibold text-brand-600 underline">
            ¿Qué es esto?
          </a>
        </p>

        {error && (
          <div className="p-3 mb-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
            {error}
          </div>
        )}

        {phase === 'form' && (
          <>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">
              Tu Nequi para aprobar el cobro
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="input"
              placeholder="3101234567"
            />
            <button onClick={() => void start()} disabled={busy} className="btn-primary w-full mt-4">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Pagar con Nequi'}
            </button>
          </>
        )}

        {phase === 'waiting' && (
          <div className="text-center py-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-emerald-600" />
            <p className="font-bold text-surface-900">
              {charge != null ? formatCOP(charge) : ''} en camino a tu Nequi…
            </p>
            <p className="text-sm text-surface-500 mt-1">
              Aprueba la notificación de Nequi. Esto se cierra solo.
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="text-center py-4">
            <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-emerald-600" />
            <p className="font-bold text-surface-900">¡Pago retenido con éxito!</p>
            <p className="text-sm text-surface-500 mt-1">
              Se libera a la tienda cuando recibas (máx 48h).
            </p>
            <button onClick={onClose} className="btn-primary w-full mt-4">
              Listo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
