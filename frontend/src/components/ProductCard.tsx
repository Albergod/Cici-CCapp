import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '@/types';
import { Eye, MessageSquare, Package, X } from 'lucide-react';
import { attributesToTitledList, BusinessType } from '@/lib/categoryFields';
import { formatCOP } from '@/lib/format';

interface ProductCardProps {
  product: Product;
  onContact?: (productId: string) => void;
  businessType?: BusinessType;
  /** Habilita el zoom por doble toque de la imagen (solo en la vista de tienda). */
  imageZoom?: boolean;
  /** Id del producto con el ojito activo. Uno solo a la vez: salta de producto en producto. */
  armedId?: string | null;
  onArm?: (productId: string | null) => void;
}

export function ProductCard({
  product,
  onContact,
  businessType,
  imageZoom = false,
  armedId = null,
  onArm,
}: ProductCardProps) {
  const chips = attributesToTitledList(businessType, product.attributes);
  const [open, setOpen] = useState(false); // imagen ampliada (2º toque)

  const hasImage = !!product.imageUrl;
  const zoomEnabled = imageZoom && hasImage;
  const armed = zoomEnabled && armedId === product.id;

  const handleImageTap = () => {
    if (!zoomEnabled) return;
    if (!armed) {
      onArm?.(product.id);
      return;
    }
    onArm?.(null);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleImageTap();
    }
  };

  return (
    <div className="group bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lift transition-all duration-300 hover:-translate-y-0.5 border border-surface-200/60 flex flex-col">
      <div
        className={[
          'relative aspect-square bg-surface-100 overflow-hidden',
          zoomEnabled ? 'cursor-pointer' : '',
        ].join(' ')}
        role={zoomEnabled ? 'button' : undefined}
        aria-label={zoomEnabled ? `Ampliar imagen de ${product.name}` : undefined}
        onClick={zoomEnabled ? handleImageTap : undefined}
        onKeyDown={zoomEnabled ? handleKeyDown : undefined}
      >
        {product.imageUrl ? (
          <>
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            {armed && (
              <div className="absolute inset-0 bg-surface-900/25 flex items-center justify-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-900/60 backdrop-blur-sm text-white text-xs font-semibold shadow-lg">
                  <Eye className="w-4 h-4" />
                  Ampliar
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-surface-300">
            <Package className="w-12 h-12" />
          </div>
        )}
        {!product.available && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
            <span className="px-3 py-1.5 bg-accent-500 text-white text-xs font-semibold rounded-full">
              No disponible
            </span>
          </div>
        )}
      </div>

      <div className="p-3.5 flex flex-col flex-1">
        <h3 className="font-display font-bold text-surface-900 text-sm truncate">{product.name}</h3>
        {product.description && (
          <p className="text-xs text-surface-500 line-clamp-2 mt-0.5 flex-1">
            {product.description}
          </p>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className="px-1.5 py-0.5 text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-100 rounded-md"
              >
                {c.label}: {c.value}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <span className="text-lg font-extrabold text-surface-900">
            {formatCOP(product.price)}
          </span>
          {product.available && onContact && (
            <button
              onClick={() => onContact(product.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 transition-all active:scale-95"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Contactar
            </button>
          )}
        </div>
      </div>

      {/* Lightbox: se monta en el body para que ningún overflow/transform lo recorte. */}
      {hasImage &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Imagen ampliada de ${product.name}`}
          >
            <div
              className="absolute inset-0 bg-surface-900/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <button
              className="absolute top-4 right-4 z-[1] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              onClick={() => setOpen(false)}
              aria-label="Cerrar imagen"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={product.imageUrl ?? undefined}
              alt={product.name}
              className="relative max-w-[90vw] max-h-[85vh] w-auto h-auto object-contain rounded-2xl shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </div>
  );
}