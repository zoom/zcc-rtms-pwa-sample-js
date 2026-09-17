// Keeps the active engagement ID and status current by polling the backend and, when available, reading the Zoom Apps SDK context.
import { useState, useEffect } from 'react';
import zoomSdk from '@zoom/appssdk';

export function useEngagement() {
  const [isActive, setIsActive] = useState(false);
  const [engagementId, setEngagementId] = useState(null);

  useEffect(() => {
    const fetchActive = async () => {
      try {
        const res = await fetch('/api/engagement/active');
        const data = await res.json();
        if (data.isActive && data.engagementId) {
          setIsActive(true);
          setEngagementId(data.engagementId);
        } else {
          setIsActive(false);
          setEngagementId(null);
        }
      } catch (err) {
        console.error('Error fetching active engagement:', err);
      }
    };
    fetchActive();
    const interval = setInterval(fetchActive, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function initZoomSdk() {
      try {
        await zoomSdk.config({ version: '0.16.0', capabilities: ['getEngagementContext', 'getEngagementStatus'] });
        const context = await zoomSdk.getEngagementContext();
        if (context?.engagementContext?.engagementId) {
          setEngagementId(prev => prev || context.engagementContext.engagementId);
        }
        const status = await zoomSdk.getEngagementStatus();
        if (status?.engagementStatus?.state === 'active') setIsActive(true);
      } catch {
        // App works without SDK via webhooks
      }
    }
    initZoomSdk();
  }, []);

  return { isActive, engagementId };
}
