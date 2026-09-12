import { AuthResponse, Conversation, Store, Product, Message, SaleStats, ReferralInfo } from '@/types';

const API_BASE = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(error.error || error.message || `Error ${response.status}`);
  }

  return response.json();
}

async function uploadImage(file: File): Promise<string> {
  const token = localStorage.getItem('token');
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error al subir la imagen' }));
    throw new Error(error.error || 'Error al subir la imagen');
  }

  const data = await response.json();
  return data.url as string;
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, name: string, refCode?: string) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, refCode }),
      }),
    google: (credential: string, refCode?: string) =>
      request<AuthResponse>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, refCode }),
      }),
    config: () => request<{ googleClientId: string | null }>('/auth/config'),
  },

  stores: {
    list: async (skip = 0, take = 20): Promise<Store[]> => {
      const data = await request<Store[]>(`/stores?skip=${skip}&take=${take}`);
      return data.map((s) => ({
        ...s,
        products:
          s.products?.map((p) => ({ ...p, price: toNumber(p.price) })) ?? [],
      }));
    },
    getBySlug: async (slug: string): Promise<Store> => {
      const data = await request<Store>(`/stores/${slug}`);
      return {
        ...data,
        products: data.products?.map((p) => ({ ...p, price: toNumber(p.price) })) ?? [],
      };
    },
    create: (data: {
      name: string;
      description?: string;
      businessType?: 'ROPA' | 'CALZADO' | 'ACCESORIOS' | 'HOGAR' | 'ALIMENTOS' | 'SERVICIOS' | 'OTRO';
    }) =>
      request<Store>('/stores', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    follow: (id: string) =>
      request<{ following: boolean }>(`/stores/${id}/follow`, {
        method: 'POST',
      }),
    following: () => request<Store[]>('/stores/following'),
    update: (id: string, data: {
      name?: string;
      description?: string;
      logoUrl?: string;
      bannerUrl?: string;
      whatsapp?: string;
      businessType?: 'ROPA' | 'CALZADO' | 'ACCESORIOS' | 'HOGAR' | 'ALIMENTOS' | 'SERVICIOS' | 'OTRO';
    }) =>
      request<Store>(`/stores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    referral: () => request<ReferralInfo>('/stores/referral'),
  },
  upload: uploadImage,

  payments: {
    createPreference: async (storeId: string, plan: 'PRO' | 'BUSINESS', cycle: 'MONTHLY' | 'BI_MONTHLY') =>
      request<{ preferenceId: string; initPoint: string; amount: number; cycle: 'MONTHLY' | 'BI_MONTHLY' }>(
        '/payments/preferences',
        {
          method: 'POST',
          body: JSON.stringify({ storeId, plan, cycle }),
        }
      ),
    status: (paymentId: string) =>
      request<{ approved: boolean; status: string; detail?: string; plan?: 'PRO' | 'BUSINESS'; cycle?: 'MONTHLY' | 'BI_MONTHLY'; amount?: number }>(
        `/payments/status?paymentId=${encodeURIComponent(paymentId)}`
      ),
  },

  products: {
    list: async (take = 20): Promise<Product[]> => {
      const data = await request<Product[]>(`/products?take=${take}`);
      return data.map((p) => ({ ...p, price: toNumber(p.price) }));
    },
    search: async (q: string, take = 20): Promise<Product[]> => {
      const data = await request<Product[]>(
        `/products?q=${encodeURIComponent(q)}&take=${take}`
      );
      return data.map((p) => ({ ...p, price: toNumber(p.price) }));
    },
    create: (storeId: string, data: any) =>
      request<Product>(`/stores/${storeId}/products`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<Product>(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    registerView: (id: string) =>
      request<void>(`/products/${id}/views`, { method: 'POST' }),
  },

  sales: {
    stats: () => request<SaleStats>('/sales/stats'),
    add: (data: { items: { productId: string; quantity: number }[]; note?: string }) =>
      request<Record<string, unknown>>('/sales', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  chat: {
    openConversation: (storeId: string, productId?: string, cartItems?: { productId: string; quantity: number }[]) =>
      request<Conversation>(`/stores/${storeId}/conversation`, {
        method: 'POST',
        body: JSON.stringify({ productId, cartItems }),
      }),
    listConversations: async (): Promise<Conversation[]> => {
      const data = await request<{
        asCustomer: Conversation[];
        asStoreOwner: Conversation[];
      }>('/conversations');
      return [...(data.asCustomer || []), ...(data.asStoreOwner || [])];
    },
    getMessages: (conversationId: string) =>
      request<Message[]>(
        `/conversations/${conversationId}/messages`
      ),
    sendMessage: (conversationId: string, content: string, cartItems?: { productId: string; quantity: number }[]) =>
      request<{ message: Message; aiReply?: Message | null }>(
        `/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content, cartItems }),
        }
      ),
    markRead: (conversationId: string) =>
      request<{ ok: boolean }>(`/conversations/${conversationId}/read`, {
        method: 'POST',
      }),
    unreadCount: () =>
      request<{ totalUnread: number }>('/conversations/unread-count'),
  },
};

// ── Admin API ──────────────────────────────────────────────────
// Requiere que el admin pegue su token en localStorage.getItem('adminToken').
// Token generado en el .env del backend (ADMIN_TOKEN).
const ADMIN_TOKEN_KEY = 'adminToken';

async function adminRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { 'X-Admin-Token': token }),
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error de admin' }));
    throw new Error(error.error || `Error ${response.status}`);
  }

  return response.json();
}

export const adminApi = {
  stats: () =>
    adminRequest<{
      totalStores: number;
      totalFree: number;
      totalPro: number;
      totalBusiness: number;
      totalPayments: number;
      recentPayments: Array<{
        id: string;
        status: string;
        plan: string;
        cycle: string;
        amount: number;
        processedAt: string;
      }>;
    }>('/stores/admin/stats'),

  payments: (page = 1) =>
    adminRequest<{
      rows: Array<{
        id: string;
        storeId: string;
        status: string;
        plan: string;
        cycle: string;
        amount: number;
        processedAt: string;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/stores/admin/payments?page=${page}`),
};