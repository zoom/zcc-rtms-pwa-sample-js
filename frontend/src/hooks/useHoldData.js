import { useState, useEffect } from 'react';

export function useHoldData() {
  const [holdCount, setHoldCount] = useState(0);
  const [totalHoldMs, setTotalHoldMs] = useState(0);
  const [isOnHold, setIsOnHold] = useState(false);
  const [holdStartedAt, setHoldStartedAt] = useState(null);
  const [liveHoldMs, setLiveHoldMs] = useState(0);

  useEffect(() => {
    const fetchHold = async () => {
      try {
        const res = await fetch('/api/engagement/hold');
        const data = await res.json();
        setHoldCount(data.count);
        setIsOnHold(data.isOnHold);
        setTotalHoldMs(data.totalHoldMs);
        setHoldStartedAt(data.holdStartedAt);
      } catch (err) {
        console.error('Error fetching hold data:', err);
      }
    };
    fetchHold();
    const interval = setInterval(fetchHold, 2000);
    return () => clearInterval(interval);
  }, []);

  // Update liveHoldMs every second while on hold so the display ticks smoothly
  useEffect(() => {
    if (!isOnHold || !holdStartedAt) {
      setLiveHoldMs(totalHoldMs);
      return;
    }
    const update = () => setLiveHoldMs(totalHoldMs + (Date.now() - holdStartedAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isOnHold, holdStartedAt, totalHoldMs]);

  return { holdCount, totalHoldMs, isOnHold, holdStartedAt, liveHoldMs };
}
