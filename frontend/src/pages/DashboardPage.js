import React, { useRef, useEffect } from 'react';
import { useEngagement } from '../hooks/useEngagement';
import { useEventCounts } from '../hooks/useEventCounts';
import { useHoldData } from '../hooks/useHoldData';
import { useRtms } from '../hooks/useRtms';
import { useTranscript } from '../hooks/useTranscript';
import { useWebhookEvents } from '../hooks/useWebhookEvents';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { formatHoldTime } from '../utils/format';

export default function DashboardPage() {
  const mountTime = useRef(new Date().toISOString());
  const prevIsActive = useRef(false);

  const { isActive, engagementId } = useEngagement();
  const { eventCounts } = useEventCounts();
  const { holdCount, liveHoldMs, isOnHold } = useHoldData();
  const { isRtmsRunning, audioConnected, loading, error, message, handleStart, handleStop } = useRtms(engagementId);
  const { transcript, transcriptBoxRef } = useTranscript();
  const { webhookEvents, clearEvents } = useWebhookEvents();
  const { authMessage, authError } = useAuthRedirect();

  // Clear webhook events when an engagement ends
  useEffect(() => {
    if (prevIsActive.current && !isActive) clearEvents();
    prevIsActive.current = isActive;
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEvents = webhookEvents.filter(e => e.timestamp >= mountTime.current);
  const displayError = error || authError;
  const displayMessage = message || authMessage;

  return (
    <div className="App">
      <div className="container">
        <div className="header">
          <div>
            <h1>Remote Engagement View</h1>
            <p className="subtitle">Real-Time Media Stream Controls</p>
          </div>
          <div className="status-panel">
            <div className="status-panel-header">RTMS Status</div>
            <div className="webhook-events-container">
              {visibleEvents.length === 0 ? (
                <p className="no-events">No status messages yet</p>
              ) : (
                <div className="events-list">
                  {visibleEvents.map((event) => (
                    <div key={event.id} className={`status-message status-${event.type}`}>
                      <div className="status-message-content">
                        <span className="status-indicator"></span>
                        <span className="status-text">{event.message}</span>
                      </div>
                      <span className="status-timestamp">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {displayError && <div className="error-box"><strong>Error:</strong> {displayError}</div>}
        {displayMessage && <div className="success-box"><strong>Success:</strong> {displayMessage}</div>}

        <div className="section two-col-section">
          <div className="two-col-left">
            <h2>Status</h2>
            <div className="status-item">
              <span className="status-label">Engagement Active:</span>
              <span className={`status-value ${isActive ? 'success' : 'warning'}`}>
                {isActive ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Engagement ID:</span>
              <span className="status-value">{engagementId || 'Not available'}</span>
            </div>
          </div>
          <div className="two-col-right">
            <h3>RTMS Controls</h3>
            <div className="action-group">
              <button className="btn btn-success" onClick={handleStart} disabled={loading || !engagementId || !isActive}>
                {loading ? 'Starting...' : 'Start RTMS'}
              </button>
              <button className="btn btn-danger" onClick={handleStop} disabled={loading || !engagementId || !isActive}>
                {loading ? 'Stopping...' : 'Stop RTMS'}
              </button>
            </div>
            <div className={`audio-visualizer${isRtmsRunning ? ' active' : ''}`}>
              {[...Array(28)].map((_, i) => (
                <div
                  key={i}
                  className="audio-bar"
                  style={isRtmsRunning ? {
                    animationDuration: `${0.6 + (i % 7) * 0.13}s`,
                    animationDelay: `${(i * 0.04) % 0.7}s`,
                  } : {}}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="section">
          <h2>Active Engagement</h2>
          <div className="event-cards">
            <div className="event-card">
              <span className="event-card-label">Transfer</span>
              <span className="event-card-count">{eventCounts.transfer}</span>
            </div>
            <div className="event-card">
              <span className="event-card-label">Conference</span>
              <span className="event-card-count">{eventCounts.conference}</span>
            </div>
            <div className="event-card">
              <span className="event-card-label">BMW</span>
              <span className="event-card-count">{eventCounts.bmw}</span>
            </div>
          </div>
          <div className="hold-stats">
            <div className="hold-stat">
              <span className="hold-stat-label">Total hold time</span>
              <span className={`hold-stat-value${isOnHold ? ' hold-stat-active' : ''}`}>
                {formatHoldTime(liveHoldMs)}
              </span>
            </div>
            <div className="hold-stat-divider" />
            <div className="hold-stat">
              <span className="hold-stat-label">Times on hold</span>
              <span className="hold-stat-value">{holdCount}</span>
            </div>
          </div>
        </div>

        <div className="section">
          <h2>Live Audio</h2>
          <div className="audio-live-status">
            <div className={`audio-eq${audioConnected ? ' active' : ''}`}>
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="audio-eq-bar"
                  style={audioConnected ? {
                    animationDuration: `${0.45 + i * 0.12}s`,
                    animationDelay: `${i * 0.09}s`,
                  } : {}}
                />
              ))}
            </div>
            <span className="audio-live-label">
              {audioConnected ? 'Audio streaming to this device' : isRtmsRunning ? 'Connecting audio…' : 'Waiting for RTMS…'}
            </span>
          </div>
        </div>

        <div className="section">
          <h2>Call Transcript</h2>
          <div className="transcript-box" ref={transcriptBoxRef}>
            {transcript.length === 0 ? (
              <p className="transcript-empty">Transcript will appear here once the call is active and RTMS is running.</p>
            ) : (
              transcript.map((line, i) => (
                <div key={i} className="transcript-line">
                  <span className="transcript-time">{new Date(line.timestamp).toLocaleTimeString()}</span>
                  <span className="transcript-text">{line.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="footer">
          <p className="footer-text">Zoom RTMS App | Version 1.0.0</p>
          <button className="btn-demo" onClick={() => fetch('/api/engagement/summary/test', { method: 'POST' })}>
            Demo: Simulate Engagement End
          </button>
        </div>
      </div>
    </div>
  );
}
