import { AuthResponse, Conversation, Store, Product, Message, SaleStats } from '@/types';

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
    register: (email: string, password: string, name: string) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
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
      subscriptionCycle?: 'MONTHLY' | 'BI_MONTHLY';
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
    setSpace: (id: string, subscriptionCycle?: 'MONTHLY' | 'BI_MONTHLY' | null) =>
      request<Store>(`/stores/${id}/space`, {
        method: 'PATCH',
        body: JSON.stringify({ subscriptionCycle }),
      }),
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
    openConversation: (storeId: string) =>
      request<Conversation>(`/stores/${storeId}/conversation`, {
        method: 'POST',
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
  },
};