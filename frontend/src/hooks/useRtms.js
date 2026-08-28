import { useState, useRef } from 'react';

export function useRtms(engagementId) {
  const [isRtmsRunning, setIsRtmsRunning] = useState(false);
  const [audioConnected, setAudioConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);
  const nextPlayTimeRef = useRef(0);

  const handleStart = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/zoom/rtms/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ engagementId, action: 'start' }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('RTMS started successfully');
        setIsRtmsRunning(true);
        try {
          const ctx = new AudioContext({ sampleRate: 16000 });
          audioCtxRef.current = ctx;
          nextPlayTimeRef.current = ctx.currentTime + 0.2;

          const es = new EventSource('/api/rtms/audio/stream');
          es.onopen = () => setAudioConnected(true);
          es.onerror = () => setAudioConnected(false);
          es.onmessage = (event) => {
            const { data: b64 } = JSON.parse(event.data);
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
            const buf = ctx.createBuffer(1, float32.length, 16000);
            buf.getChannelData(0).set(float32);
            const source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);
            const now = ctx.currentTime;
            if (nextPlayTimeRef.current < now + 0.05) nextPlayTimeRef.current = now + 0.05;
            source.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += buf.duration;
          };
          audioSourceRef.current = es;
        } catch (audioErr) {
          console.error('Failed to start live audio:', audioErr);
        }
      } else {
        setError(data.error || 'Failed to start RTMS');
      }
    } catch (err) {
      setError(`Error starting RTMS: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/zoom/rtms/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ engagementId, action: 'stop' }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('RTMS stopped successfully');
        setIsRtmsRunning(false);
        audioSourceRef.current?.close();
        audioCtxRef.current?.close();
        audioSourceRef.current = null;
        audioCtxRef.current = null;
        setAudioConnected(false);
      } else {
        setError(data.error || 'Failed to stop RTMS');
      }
    } catch (err) {
      setError(`Error stopping RTMS: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { isRtmsRunning, audioConnected, loading, error, message, handleStart, handleStop };
}
