import { Link } from 'react-router-dom';
import { Users, Package, BadgeCheck, Sparkles } from 'lucide-react';
import { Store } from '@/types';

interface StoreCardProps {
  store: Store;
}

export function StoreCard({ store }: StoreCardProps) {
  const gradient = 'bg-gradient-to-br from-brand-500 via-brand-400 to-accent-400';

  return (
    <Link
      to={`/store/${store.slug}`}
      className="group block bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lift transition-all duration-300 hover:-translate-y-0.5 border border-surface-200/60"
    >
      <div className={`relative h-28 ${gradient}`}>
        {store.bannerUrl && (
          <img
            src={store.bannerUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        {store.verified && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-soft">
            <BadgeCheck className="w-3 h-3" />
            Verificada
          </span>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start -mt-10 mb-3 relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-soft flex items-center justify-center overflow-hidden ring-4 ring-white">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              <span className={`w-full h-full ${gradient} flex items-center justify-center text-white text-xl font-extrabold`}>
                {store.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </div>
        <h3 className="font-display font-bold text-surface-900 truncate group-hover:text-brand-600 transition-colors">
          {store.name}
        </h3>
        <div className="flex items-center gap-1.5 mt-1">
          {store.plan !== 'FREE' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-brand-600 to-accent-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-soft">
              <Sparkles className="w-2.5 h-2.5" />
              Premium
            </span>
          )}
          {store.plan === 'FREE' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-100 text-surface-500 text-[10px] font-bold uppercase tracking-wider">
              Plan Gratis
            </span>
          )}
        </div>
        {store.description && (
          <p className="text-sm text-surface-500 line-clamp-2 mt-1">
            {store.description}
          </p>
        )}

        <div className="flex items-center gap-4 mt-4 text-xs text-surface-500 font-medium">
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-brand-500" />
            {store.followersCount || 0} seguidores
          </span>
          <span className="inline-flex items-center gap-1">
            <Package className="w-3.5 h-3.5 text-brand-500" />
            {store.productsCount || 0} productos
          </span>
        </div>
      </div>
    </Link>
  );
}