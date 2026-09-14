import { useEffect, useState } from 'react';

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}

function remaining(target: number): Countdown {
  const diff = Math.max(0, target - Date.now());
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return { days, hours, minutes, seconds, ended: diff === 0 };
}

export function useCountdown(target: number): Countdown {
  const [countdown, setCountdown] = useState<Countdown>(() => remaining(target));
  useEffect(() => {
    const id = setInterval(() => setCountdown(remaining(target)), 1000);
    return () => clearInterval(id);
  }, [target]);
  return countdown;
}