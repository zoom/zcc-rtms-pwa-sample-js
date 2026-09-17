// Polls recent backend webhook status messages and provides a local action to clear the displayed list.
import { useState, useEffect } from 'react';

export function useWebhookEvents() {
  const [webhookEvents, setWebhookEvents] = useState([]);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch('/api/webhooks/events');
        const data = await res.json();
        setWebhookEvents(data.events || []);
      } catch (err) {
        console.error('Error fetching webhook events:', err);
      }
    };
    fetchEvents();
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, []);

  const clearEvents = () => setWebhookEvents([]);

  return { webhookEvents, clearEvents };
}
