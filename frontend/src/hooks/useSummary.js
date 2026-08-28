import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useSummary(mountTime) {
  const [summary, setSummary] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await fetch('/api/engagement/summary');
        const data = await res.json();
        if (!data) {
          setSummary(null);
        } else if (data.generatedAt >= mountTime.current) {
          setSummary(data);
        }
      } catch (err) {
        console.error('Error fetching summary:', err);
      }
    };
    fetchSummary();
    const interval = setInterval(fetchSummary, 3000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (summary) navigate('/snapshot');
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  return { summary };
}
