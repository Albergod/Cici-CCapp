import { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { SpacePlanModal, UpgradeSelection } from '@/components/SpacePlanModal';
import { api } from '@/services/api';

type UpgradeStep = 'plan' | 'checkout' | 'error';

interface UpgradeSpaceModalProps {
  open: boolean;
  storeId?: string;
  onClose: () => void;
}

export function UpgradeSpaceModal({ open, storeId, onClose }: UpgradeSpaceModalProps) {
  const [step, setStep] = useState<UpgradeStep>('plan');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep('plan');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleUpgrade = async (sel: UpgradeSelection) => {
    setError(null);
    if (!storeId) {
      setStep('error');
      setError('Aún no tienes una tienda creada. Crea tu local primero.');
      return;
    }
    setStep('checkout');
    try {
      const pref = await api.payments.createPreference(storeId, sel.plan, sel.cycle);
      // Redirige al usuario al checkout de Mercado Pago. Al volver, la app
      // verifica el pago contra Mercado Pago y activa el plan SOLO si fue
      // aprobado (ver DashboardPage).
      window.location.href = pref.initPoint;
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago.');
    }
  };

  if (step === 'checkout') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mx-auto">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">
            Redirigiendo a Mercado Pago
          </h2>
          <p className="text-sm text-surface-600 mt-2">
            Verás el resumen de tu pago y podrás pagar con tarjeta, Nequi, PSE o
            tu medio favorito. Cuando completes el pago volverás por aquí con tu
            tienda actualizada.
          </p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent-100 text-accent-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">
            No se pudo iniciar el pago
          </h2>
          <p className="text-sm text-surface-600 mt-2">{error}</p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button onClick={() => setStep('plan')} className="btn-primary w-full">
              Intentar de nuevo
            </button>
            <button
              onClick={handleClose}
              className="w-full text-center text-sm font-semibold text-surface-500 hover:text-surface-700 py-2 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SpacePlanModal
      open={step === 'plan'}
      mode="upgrade"
      onUpgrade={handleUpgrade}
      onClose={handleClose}
    />
  );
}