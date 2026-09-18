export type ModerationStatus = 'ACTIVE' | 'MUTED' | 'SUSPENDED' | 'BANNED';

export type BusinessType =
  | 'ROPA'
  | 'CALZADO'
  | 'ACCESORIOS'
  | 'HOGAR'
  | 'ALIMENTOS'
  | 'SERVICIOS'
  | 'BELLEZA'
  | 'OTRO';

export interface ScheduleConfig {
  openTime: string;
  closeTime: string;
  lunchStart: string;
  lunchEnd: string;
  workingDays: number[];
  bookingHorizonDays: number;
  timezone: string;
}

export interface StoreService {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  storeId: string;
  createdAt?: string;
}

export type AppointmentStatus = 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  appointmentDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  note?: string | null;
  saleId?: string | null;
  service: { name: string; price: number; durationMinutes: number };
  customer?: { id: string; name: string };
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt?: string;
  termsAcceptedAt?: string | null;
  moderationStatus?: ModerationStatus;
  moderationUntil?: string | null;
}

export type SubscriptionStatus = 'trial' | 'active' | 'free' | 'expired';

export interface Store {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  whatsapp?: string | null;
  plan: 'FREE' | 'PRO' | 'BUSINESS';
  businessType?: BusinessType;
  subscriptionCycle?: 'MONTHLY' | 'BI_MONTHLY' | null;
  schedule?: ScheduleConfig;
  services?: StoreService[];
  ownerId: string;
  createdAt: string;
  trialStartedAt?: string;
  subscriptionExpiresAt?: string | null;
  followersCount?: number;
  productsCount?: number;
  contactAvailable?: boolean;
  following?: boolean;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: number;
  /** true: plan de pago abierto por la prueba de 14 días (aún no pagó). */
  onTrial?: boolean;
  /** true: la prueba terminó y la tienda bajó a modo FREE (manual). */
  trialEnded?: boolean;
  prestigePoints?: number;
  prestigeGoal?: number;
  prestigeActive?: boolean;
  verified?: boolean;
  referralCode?: string;
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
  views?: number;
  stock?: number;
  storeId: string;
  categoryId: string | null;
  createdAt: string;
  attributes?: Record<string, string | number | boolean>;
  store?: Pick<Store, 'name' | 'slug' | 'logoUrl' | 'businessType'>;
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
  assertedProductId?: string;
  store?: Pick<Store, "name" | "slug" | "logoUrl" | "plan" | "whatsapp" | "businessType">;
  customer?: Pick<User, "name" | "avatarUrl">;
  lastMessage?: Message;
  messages?: Message[];
  unreadCount?: number;
}

export interface Message {
  id: string;
  content: string;
  conversationId: string;
  senderId: string;
  createdAt: string;
  aiGenerated?: boolean;
  waText?: string | null;
  removedAt?: string | null;
  removedReason?: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface SaleItemSummary {
  name: string;
  quantity: number;
  unitPrice: number;
  kind?: 'product' | 'service';
}

export interface RecentSale {
  id: string;
  total: number;
  soldAt: string;
  note: string | null;
  origin?: 'manual' | 'appointment' | 'order';
  customerName: string | null;
  itemsSummary: SaleItemSummary[];
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
}

export interface TopService {
  serviceId: string;
  name: string;
  quantity: number;
}

export interface ViewedProduct {
  productId: string;
  name: string;
  views: number;
}

export interface SaleStats {
  totalSales: number;
  totalRevenue: number;
  todayCount: number;
  todayRevenue: number;
  customerCount: number;
  productCount: number;
  topProducts: TopProduct[];
  topServices?: TopService[];
  topViewed: ViewedProduct[];
  conversionRate: number;
  totalViews: number;
  recentSales: RecentSale[];
}

export interface ReferralInfo {
  active: boolean;
  referralCode?: string;
  referralLink?: string;
  prestigePoints: number;
  prestigeGoal?: number;
  required: number;
  verified: boolean;
  productLimit: number;
  message?: string;
  criteria?: {
    minAgeDays: number;
    minSales: number;
    storeAgeDays: number;
    trackedSales: number;
  };
}

export type OrderStatus = 'pending' | 'sold' | 'cancelled';

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  createdAt: string;
  storeId: string;
  customerId?: string | null;
  customer?: { id: string; name: string } | null;
  note?: string | null;
  saleId?: string | null;
  sale?: { id: string; total: number } | null;
  items: OrderItem[];
}