export interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  fullName: string;
}

interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  platform?: string;
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppInstance;
    };
  }
}

export function getTelegramWebApp(): TelegramWebAppInstance | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp || null;
}

export function isTelegramMiniApp(): boolean {
  const tg = getTelegramWebApp();
  if (!tg) return false;
  return Boolean(tg.initData && tg.initData.length > 0) || Boolean(tg.initDataUnsafe?.user);
}

export function initTelegramMiniApp(): TelegramMiniAppUser | null {
  const tg = getTelegramWebApp();
  if (!tg) return null;

  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#ffffff');
    tg.setBackgroundColor?.('#f1f5f9');
  } catch {}

  return getTelegramMiniAppUser();
}

export function getTelegramMiniAppUser(): TelegramMiniAppUser | null {
  const tg = getTelegramWebApp();
  const user = tg?.initDataUnsafe?.user;
  if (!user) return null;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    ...user,
    fullName: fullName || user.username || `Kassir ${user.id}`,
  };
}

export function hapticSuccess(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred('success');
  } catch {}
}

export function hapticImpact(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.impactOccurred('light');
  } catch {}
}
