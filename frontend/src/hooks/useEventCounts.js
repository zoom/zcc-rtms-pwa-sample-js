// Polls the backend for the active engagement's transfer, conference, and BMW event counters.
import { useState, useEffect } from 'react';

export function useEventCounts() {
  const [eventCounts, setEventCounts] = useState({ transfer: 0, conference: 0, bmw: 0 });

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch('/api/engagement/counts');
        setEventCounts(await res.json());
      } catch (err) {
        console.error('Error fetching event counts:', err);
      }
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 2000);
    return () => clearInterval(interval);
  }, []);

  return { eventCounts };
}
