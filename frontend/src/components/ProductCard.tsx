import { Product } from '@/types';
import { MessageSquare, Package } from 'lucide-react';
import { attributesToTitledList, BusinessType } from '@/lib/categoryFields';
import { formatCOP } from '@/lib/format';

interface ProductCardProps {
  product: Product;
  onContact?: (productId: string) => void;
  businessType?: BusinessType;
}

export function ProductCard({ product, onContact, businessType }: ProductCardProps) {
  const chips = attributesToTitledList(businessType, product.attributes);
  return (
    <div className="group bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lift transition-all duration-300 hover:-translate-y-0.5 border border-surface-200/60 flex flex-col">
      <div className="relative aspect-square bg-surface-100 overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
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
    </div>
  );
}