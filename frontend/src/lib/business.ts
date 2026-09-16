import type { Store } from '@/types';

// "Business activation": el espacio está listo para activar la prueba PRO
// cuando tiene algo que probar (≥1 producto o ≥1 servicio). Se centraliza acá
// para que el requisito pueda ampliarse más adelante (perfil completo,
// publicación, horarios, etc.) sin tocar las pantallas.
export function isBusinessActivated(store: Pick<Store, 'products' | 'services'>): boolean {
  const products = store.products?.length ?? 0;
  const services = store.services?.length ?? 0;
  return products >= 1 || services >= 1;
}