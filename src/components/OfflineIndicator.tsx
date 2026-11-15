import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-500 text-amber-950 text-xs font-bold px-4 py-2 flex items-center justify-center gap-2 no-print"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        Oflayn rejim — Internet yo&apos;q, ma&apos;lumotlar qurilma xotirasiga saqlanmoqda (ulanganda sinxronlanadi)
      </span>
    </div>
  );
}
