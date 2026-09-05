import { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let state: AuthState = {
  user: loadUser(),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),
};

const listeners = new Set<() => void>();

function setState(updater: Partial<AuthState>) {
  state = { ...state, ...updater };
  if (updater.token !== undefined) {
    if (updater.token) {
      localStorage.setItem('token', updater.token);
    } else {
      localStorage.removeItem('token');
    }
  }
  if (updater.user !== undefined) {
    if (updater.user) {
      localStorage.setItem('user', JSON.stringify(updater.user));
    } else {
      localStorage.removeItem('user');
    }
  }
  listeners.forEach((l) => l());
}

export function useAuth() {
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getSnapshot = () => state;

  return {
    ...state,
    subscribe,
    getSnapshot,
    login: (token: string, user: User) => {
      setState({ token, user, isAuthenticated: true });
    },
    logout: () => {
      setState({ token: null, user: null, isAuthenticated: false });
    },
    setUser: (user: User) => {
      setState({ user });
    },
  };
}