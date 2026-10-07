import { useState } from 'react';
import { Product } from '@/types';
import { formatCOP } from '@/lib/format';
import { Loader2, Tag, X } from 'lucide-react';
import { api } from '@/services/api';

interface OfferModalProps {
  product: Product;
  onClose: () => void;
  onSaved: (updated: Product) => void;
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function OfferModal({ product, onClose, onSaved }: OfferModalProps) {
  const [price, setPrice] = useState(
    product.offerPrice != null ? String(product.offerPrice) : ''
  );
  const [endsAt, setEndsAt] = useState(toDateInput(product.offerEndsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (remove = false) => {
    setError(null);
    const promo = Number(price);
    if (!remove) {
      if (!price.trim() || Number.isNaN(promo) || promo <= 0) {
        setError('Pon un precio de oferta mayor a 0.');
        return;
      }
      if (promo >= product.price) {
        setError(`Debe ser menor al precio normal (${formatCOP(product.price)}).`);
        return;
      }
      if (!endsAt) {
        setError('Elige hasta cuándo va la oferta (máx 30 días).');
        return;
      }
    }
    setBusy(true);
    try {
      const updated = await api.products.update(product.id, {
        offerPrice: remove ? 0 : promo,
        offerEndsAt: remove ? undefined : new Date(`${endsAt}T23:59:59`).toISOString(),
      });
      onSaved({ ...product, ...updated });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la oferta.');
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
            <Tag className="w-5 h-5 text-brand-600" />
            Oferta
          </h3>
          <button onClick={onClose} className="p-1.5 text-surface-400 hover:text-surface-700" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-surface-500 mb-4">
          {product.name} · normal <strong className="text-surface-800">{formatCOP(product.price)}</strong>
        </p>

        {error && (
          <div className="p-3 mb-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
            {error}
          </div>
        )}

        <label className="block text-sm font-semibold text-surface-700 mb-1.5">
          Precio de oferta
        </label>
        <input
          type="number"
          min={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="input"
          placeholder="Ej. 75000"
        />

        <label className="block text-sm font-semibold text-surface-700 mb-1.5 mt-4">
          Termina el día
        </label>
        <input
          type="date"
          value={endsAt}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setEndsAt(e.target.value)}
          className="input"
        />
        <p className="text-xs text-surface-400 mt-1.5">Máximo 30 días. Al vencer, el precio vuelve solo.</p>

        <div className="flex gap-2 mt-5">
          <button onClick={() => void save(false)} disabled={busy} className="btn-primary flex-1">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Activar oferta'}
          </button>
          {product.onOffer && (
            <button onClick={() => void save(true)} disabled={busy} className="btn-ghost">
              Quitar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
