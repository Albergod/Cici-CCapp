import { AuthResponse, Conversation, Store, Product, Message, SaleStats, ReferralInfo, StoreService, Appointment, BusinessType, Order } from '@/types';

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
    // Sesión inválida o expirada: si es una API autenticada, cerramos sesión
    // solos para no dejar al usuario varado a mitad de pago con un error raro.
    if (response.status === 401 && !endpoint.startsWith('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
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
    register: (email: string, password: string, name: string, refCode?: string, termsAccepted?: boolean) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, refCode, termsAccepted: termsAccepted ?? false }),
      }),
    google: (credential: string, refCode?: string) =>
      request<AuthResponse>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, refCode }),
      }),
    forgotPassword: (email: string) =>
      request<{ ok: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, password: string) =>
      request<{ ok: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
    config: () => request<{ googleClientId: string | null }>('/auth/config'),
  },

  stores: {
    list: async (skip = 0, take = 20, tipo?: 'productos' | 'belleza'): Promise<Store[]> => {
      const q = new URLSearchParams({ skip: String(skip), take: String(take) });
      if (tipo) q.set('tipo', tipo);
      const data = await request<Store[]>(`/stores?${q.toString()}`);
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
      businessType?: BusinessType;
      schedule?: {
        openTime: string;
        closeTime: string;
        lunchStart: string;
        lunchEnd: string;
        workingDays: number[];
        bookingHorizonDays: number;
        timezone: string;
      };
    }) =>
      request<Store>('/stores', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    follow: (id: string) =>
      request<{ following: boolean }>(`/stores/${id}/follow`, {
        method: 'POST',
      }),
    report: (id: string, reason: string) =>
      request<{
        ok: boolean;
        action: 'none' | 'suspended' | 'banned';
        suspendedUntil: string | null;
        message: string;
      }>(`/stores/${id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    following: () => request<Store[]>('/stores/following'),
    update: (id: string, data: {
      name?: string;
      description?: string;
      logoUrl?: string;
      bannerUrl?: string;
      whatsapp?: string;
      businessType?: BusinessType;
      schedule?: {
        openTime: string;
        closeTime: string;
        lunchStart: string;
        lunchEnd: string;
        workingDays: number[];
        bookingHorizonDays: number;
        timezone: string;
      };
    }) =>
      request<Store>(`/stores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    referral: () => request<ReferralInfo>('/stores/referral'),
  },
  upload: uploadImage,

  payments: {
    createPreference: async (storeId: string | null | undefined, plan: 'PRO' | 'BUSINESS', cycle: 'MONTHLY' | 'BI_MONTHLY') =>
      request<{ preferenceId: string; initPoint: string; amount: number; cycle: 'MONTHLY' | 'BI_MONTHLY' }>(
        '/payments/preferences',
        {
          method: 'POST',
          body: JSON.stringify(storeId ? { storeId, plan, cycle } : { plan, cycle }),
        }
      ),
    status: (paymentId: string) =>
      request<{ approved: boolean; status: string; detail?: string; plan?: 'PRO' | 'BUSINESS'; cycle?: 'MONTHLY' | 'BI_MONTHLY'; amount?: number }>(
        `/payments/status?paymentId=${encodeURIComponent(paymentId)}`
      ),
    createNequi: (storeId: string | null | undefined, plan: 'PRO' | 'BUSINESS', cycle: 'MONTHLY' | 'BI_MONTHLY', phoneNumber: string) =>
      request<{ transactionId: string; reference: string; amount: number; cycle: 'MONTHLY' | 'BI_MONTHLY' }>(
        '/payments/wompi/nequi',
        {
          method: 'POST',
          body: JSON.stringify(storeId ? { storeId, plan, cycle, phoneNumber } : { plan, cycle, phoneNumber }),
        }
      ),
    wompiStatus: (transactionId: string) =>
      request<{ approved: boolean; status: string; detail?: string; plan?: 'PRO' | 'BUSINESS'; cycle?: 'MONTHLY' | 'BI_MONTHLY'; amount?: number }>(
        `/payments/wompi/status?transactionId=${encodeURIComponent(transactionId)}`
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
    openConversation: (storeId: string, opts?: { productId?: string; serviceId?: string }) =>
      request<Conversation>(`/stores/${storeId}/conversation`, {
        method: 'POST',
        body: JSON.stringify({
          productId: opts?.productId,
          serviceId: opts?.serviceId,
        }),
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
      request<{ message: Message; aiReply?: Message | null; appointmentId?: string | null; orderId?: string | null }>(
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

  services: {
    list: () => request<StoreService[]>('/services'),
    templates: async (): Promise<{ name: string; durationMinutes: number }[]> =>
      request('/services/templates'),
    create: (data: { name: string; description?: string; price: number; durationMinutes: number }) =>
      request<StoreService>('/services', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; description?: string; price: number; durationMinutes: number }>) =>
      request<StoreService>(`/services/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request<{ ok: boolean }>(`/services/${id}`, { method: 'DELETE' }),
  },

  appointments: {
    agenda: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      const q = qs.toString();
      return request<Appointment[]>(`/appointments/agenda${q ? `?${q}` : ''}`);
    },
    book: (data: { storeId: string; serviceId: string; date: string; startTime: string; note?: string }) =>
      request<{ ok: true; appointment: Appointment }>('/appointments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    cancel: (id: string) =>
      request<{ ok: boolean }>(`/appointments/${id}/cancel`, { method: 'PATCH' }),
    complete: (id: string) =>
      request<{ ok: boolean }>(`/appointments/${id}/complete`, { method: 'PATCH' }),
    close: (id: string, outcome: 'done' | 'no_show') =>
      request<{ ok: boolean; sale?: { id: string; total: number } | null }>(
        `/appointments/${id}/close`,
        { method: 'POST', body: JSON.stringify({ outcome }) },
      ),
  },

  orders: {
    list: (status?: Order['status']) =>
      request<Order[]>(`/orders${status ? `?status=${status}` : ''}`),
    confirm: (id: string) =>
      request<Order>(`/orders/${id}/confirm`, { method: 'POST' }),
    cancel: (id: string) =>
      request<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
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

  violations: (opts: { status?: string; type?: string; page?: number } = {}) =>
    adminRequest<{
      rows: Array<{
        id: string;
        type: string;
        severity: string;
        status: string;
        reason: string;
        metadata: Record<string, unknown> | null;
        actionTaken: string | null;
        resolvedNote: string | null;
        createdAt: string;
        resolvedAt: string | null;
        store: { name: string; slug: string; storeStatus: string } | null;
        reporter: { name: string; email: string } | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(
      `/admin/violations?${new URLSearchParams({
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.type ? { type: opts.type } : {}),
        page: String(opts.page ?? 1),
      })}`,
    ),

  resolveViolation: (id: string, body: { status: string; note?: string }) =>
    adminRequest<Record<string, unknown>>(`/admin/violations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  adminStores: (opts: { status?: string; page?: number } = {}) =>
    adminRequest<{
      rows: Array<{
        id: string;
        name: string;
        slug: string;
        plan: string;
        status: string;
        suspensionEndsAt: string | null;
        sanctionsCount: number;
        banReason: string | null;
        createdAt: string;
        openViolations: number;
        owner: { name: string; email: string } | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(
      `/admin/stores?${new URLSearchParams({
        ...(opts.status ? { status: opts.status } : {}),
        page: String(opts.page ?? 1),
      })}`,
    ),

  suspendStore: (id: string, body: { days?: number; hours?: number; reason: string }) =>
    adminRequest<{ ok: true; until: string }>(`/admin/stores/${id}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  banStore: (id: string, body: { reason: string }) =>
    adminRequest<{ ok: true }>(`/admin/stores/${id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  unbanStore: (id: string, body: { reason?: string }) =>
    adminRequest<{ ok: true }>(`/admin/stores/${id}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};