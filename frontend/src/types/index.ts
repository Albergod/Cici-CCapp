export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt?: string;
}

export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export interface Store {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  plan: 'FREE' | 'PRO' | 'BUSINESS';
  subscriptionCycle?: 'MONTHLY' | 'BI_MONTHLY' | null;
  ownerId: string;
  createdAt: string;
  trialStartedAt?: string;
  subscriptionExpiresAt?: string | null;
  followersCount?: number;
  productsCount?: number;
  contactAvailable?: boolean;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: number;
  products?: Product[];
  categories?: Category[];
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  available: boolean;
  storeId: string;
  categoryId: string | null;
  createdAt: string;
  store?: Pick<Store, 'name' | 'slug' | 'logoUrl'>;
}

export interface Category {
  id: string;
  name: string;
  storeId: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  storeId: string;
  createdAt: string;
  store?: Pick<Store, 'name' | 'slug' | 'logoUrl'>;
  customer?: Pick<User, 'name' | 'avatarUrl'>;
  lastMessage?: Message;
}

export interface Message {
  id: string;
  content: string;
  conversationId: string;
  senderId: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface SaleItemSummary {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface RecentSale {
  id: string;
  total: number;
  soldAt: string;
  note: string | null;
  customerName: string | null;
  itemsSummary: SaleItemSummary[];
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
}

export interface SaleStats {
  totalSales: number;
  totalRevenue: number;
  todayCount: number;
  todayRevenue: number;
  customerCount: number;
  productCount: number;
  topProducts: TopProduct[];
  recentSales: RecentSale[];
}