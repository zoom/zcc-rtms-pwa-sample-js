import React from 'react';
import { formatHoldTime } from '../utils/format';

export default function SnapshotPage({ snap }) {
  return (
    <div className="App">
      <div className="container">
        <div className="header snapshot-header">
          <h1>Engagement Snapshot</h1>
          <div className="snapshot-meta">
            <div className="snapshot-meta-item">
              <span className="snapshot-meta-label">Agent</span>
              <span className="snapshot-meta-value">{snap.agentName}</span>
            </div>
            <div className="snapshot-meta-item">
              <span className="snapshot-meta-label">Consumer</span>
              <span className="snapshot-meta-value">{snap.consumerName}</span>
            </div>
            <div className="snapshot-meta-item">
              <span className="snapshot-meta-label">Engagement ID</span>
              <span className="snapshot-meta-value">{snap.engagementId}</span>
            </div>
            <div className="snapshot-meta-item">
              <span className="snapshot-meta-label">Date</span>
              <span className="snapshot-meta-value">{new Date(snap.generatedAt).toLocaleDateString()}</span>
            </div>
            <div className="snapshot-meta-item">
              <span className="snapshot-meta-label">Time</span>
              <span className="snapshot-meta-value">{new Date(snap.generatedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>

        <div className="summary-two-col">
          <div className="summary-left">
            <h3 className="summary-section-label">Call Statistics</h3>
            <div className="summary-stats-grid">
              <div className="summary-stat-card stat-duration">
                <span className="summary-stat-label">Duration</span>
                <span className="summary-stat-value">{formatHoldTime(snap.stats.durationMs)}</span>
              </div>
              <div className="summary-stat-card stat-hold">
                <span className="summary-stat-label">Time on Hold</span>
                <span className="summary-stat-value">{snap.stats.holdPct}%</span>
                <span className="summary-stat-sub">{snap.stats.holdCount} time{snap.stats.holdCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="summary-stat-card stat-transfer">
                <span className="summary-stat-label">Transfers</span>
                <span className="summary-stat-value">{snap.stats.transferCount}</span>
              </div>
              <div className="summary-stat-card stat-conference">
                <span className="summary-stat-label">Conferences</span>
                <span className="summary-stat-value">{snap.stats.conferenceCount}</span>
              </div>
            </div>

            {snap.transferDetails && (
              <div className="summary-detail-block">
                <h4>Transfers</h4>
                <pre>{snap.transferDetails}</pre>
              </div>
            )}

            {snap.conferenceDetails && (
              <div className="summary-detail-block">
                <h4>Conferences</h4>
                <pre>{snap.conferenceDetails}</pre>
              </div>
            )}

            <div className="summary-detail-block">
              <h4>Hold</h4>
              <p className="summary-hold-line">
                {snap.stats.holdPct}% of this engagement was spent on hold
                {snap.stats.holdCount > 0 ? ` across ${snap.stats.holdCount} hold period${snap.stats.holdCount > 1 ? 's' : ''}.` : '.'}
              </p>
            </div>

            {snap.eventLog?.length > 0 && (
              <div className="summary-detail-block">
                <h4>Event Timeline</h4>
                <ul className="event-timeline-list">
                  {snap.eventLog.map((entry, i) => (
                    <li key={i} className="event-timeline-item">
                      <span className="event-timeline-time">{formatHoldTime(entry.elapsedMs)}</span>
                      <div className="event-timeline-body">
                        <span className="event-timeline-message">{entry.message}</span>
                        <span className="event-timeline-reason">{entry.reason}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="summary-right">
            <div>
              <h3 className="summary-section-label">Call Summary</h3>
              <p className="summary-ai">{snap.aiSummary}</p>
            </div>

            {snap.coachingNotes?.length > 0 && (
              <div>
                <h3 className="summary-section-label summary-section-label--red">Coaching Notes</h3>
                <ul className="coaching-list">
                  {snap.coachingNotes.map((item, i) => (
                    <li key={i} className={`coaching-item coaching-${item.type}`}>
                      <span className="coaching-badge">
                        {item.type === 'positive' ? 'Well done' : item.type === 'improve' ? 'Improve' : 'Note'}
                      </span>
                      {item.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="footer">
          <p className="footer-text">Zoom RTMS App | Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
