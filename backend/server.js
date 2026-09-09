const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { securityHeaders } = require('./middleware/security');
const { handleRtmsControl } = require('./controllers/zoomController');
const { zoomApiRequest } = require('./helpers/zoom-api');
const { setTokens, getTokens, clearTokens } = require('./helpers/token-store');

const app = express();
const server = http.createServer(app);

// Trust proxy - required for ngrok and other reverse proxies
// This allows Express to trust X-Forwarded-* headers for proper cookie handling
app.set('trust proxy', 1);

const PORT = process.env.BACKEND_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // Dev default — set FRONTEND_URL in .env for production
const FRONTEND_INTERNAL_URL = process.env.FRONTEND_INTERNAL_URL || FRONTEND_URL;

// Middleware - IMPORTANT: Order matters!
// 1. CORS must come FIRST
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 2. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Security headers AFTER CORS
app.use(securityHeaders);

// Session configuration with in-memory store
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
  }
}));

// Serve static frontend files (for production/ngrok deployment)
// Only serve static files if build directory exists (not in Docker dev mode)
const frontendBuildPath = path.join(__dirname, '../frontend/build');
const fs = require('fs');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Check authentication status
app.get('/api/auth/status', async (_req, res) => {
  const tokens = await getTokens();
  const isAuthenticated = !!tokens.accessToken;

  res.json({
    authenticated: isAuthenticated,
    hasToken: !!tokens.accessToken
  });
});

// Clear tokens from Redis (logout)
app.delete('/api/auth/logout', async (_req, res) => {
  await clearTokens();
  res.json({ success: true, message: 'Tokens cleared' });
});

// Debug: Log all incoming requests to /api/webhooks/zoom
app.use('/api/webhooks/zoom', (req, _res, next) => {
  console.log('Webhook request received');
  next();
});

// Home endpoint - serves the React app (for Zoom Marketplace)
// In Docker mode, this redirects to root which is proxied to frontend
app.get('/api/home', (req, res) => {
  // Redirect to root - the proxy will handle serving the frontend
  res.redirect('/');
});

// OAuth: Callback endpoint
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokenUrl = `${process.env.ZOOM_HOST || 'https://zoom.us'}/oauth/token`;
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.ZOOM_REDIRECT_URL || `${process.env.PUBLIC_URL}/api/auth/callback`
    });

    const authHeader = Buffer.from(
      `${process.env.ZOOM_APP_CLIENT_ID}:${process.env.ZOOM_APP_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // Store tokens in global storage (session cookies don't work in Zoom iframe)
    await setTokens({
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + ((expires_in || 3600) * 1000)
    });

    console.log('OAuth successful - Tokens saved');

    // Redirect back to app with success indicator
    const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000');
    redirectUrl.searchParams.set('auth', 'success');
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error.response?.status, error.message);
    const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000');
    redirectUrl.searchParams.set('auth', 'error');
    res.redirect(redirectUrl.toString());
  }
});

// Forward webhook to RTMS server with exponential backoff retry
async function forwardWithRetry(url, body, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      return;
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      } else {
        throw error;
      }
    }
  }
}

// Store recent webhook event signatures to prevent duplicates
const recentWebhooks = new Map();
const WEBHOOK_DEDUP_WINDOW_MS = 5000; // 5 seconds

// Store RTMS status messages for display (keep last 100)
const statusMessages = [];
const MAX_STATUS_MESSAGES = 100;

// Store active engagements (engagement_id -> engagement data)
const activeEngagements = new Map();

// Event bucket counters
const eventCounts = { transfer: 0, conference: 0, bmw: 0 };

// Hold tracking
const holdData = { count: 0, isOnHold: false, totalHoldMs: 0, holdStartedAt: null };

// Per-engagement event tracking
const engagementTracker = { startTime: null, engagementId: null, transfers: [], conferences: [] };

// Latest engagement summary (generated on engagement_ended)
let engagementSummary = null;

// Persistent log of all event reasons for the current engagement
const eventLog = [];

// Live transcript lines for the current engagement
const transcriptLines = [];

const HOLD_REASON_FALLBACK = { message: 'Agent placed consumer on hold.', reason: 'Likely searching for support article to assist with billing charges.' };

async function generateHoldReason(engagementId, elapsedMs) {
  try {
    const rtmsUrl = process.env.RTMS_SERVER_URL || 'http://localhost:8080';
    const { data } = await axios.get(`${rtmsUrl}/transcript/recent/${engagementId}`, { timeout: 2000 });
    const transcript = data.transcript?.trim();

    const reason = transcript
      ? await (async () => {
          const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: process.env.AI_MODEL || 'anthropic/claude-3-haiku',
            messages: [{
              role: 'user',
              content: `This is a snippet from a customer service call transcript captured just before the agent placed the customer on hold:\n\n"${transcript}"\n\nIn one concise sentence, why did the agent likely put the customer on hold?`
            }],
            max_tokens: 80
          }, {
            headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          });
          return response.data.choices[0]?.message?.content?.trim();
        })()
      : null;

    eventLog.push({
      message: 'Agent placed consumer on hold.',
      reason: reason || HOLD_REASON_FALLBACK.reason,
      timestamp: new Date().toISOString(),
      elapsedMs
    });
  } catch (err) {
    console.error('[Hold reason] Failed:', err.message);
    eventLog.push({
      message: 'Agent placed consumer on hold.',
      reason: HOLD_REASON_FALLBACK.reason,
      timestamp: new Date().toISOString(),
      elapsedMs
    });
  }
}

function formatElapsed(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function extractName(payload) {
  return (
    payload?.transfer_to_queue_name ||
    payload?.object?.transfer_to_queue_name ||
    payload?.object?.agent?.display_name ||
    payload?.object?.transferee?.display_name ||
    payload?.object?.queue?.name ||
    payload?.agent?.display_name ||
    payload?.to?.display_name ||
    payload?.queue_name ||
    'unknown'
  );
}


function generateEngagementSummary(engagementId, snapshot) {
  const { durationMs, holdMs, holdCount, transfers, conferences } = snapshot;
  const holdPct = durationMs > 0 ? ((holdMs / durationMs) * 100).toFixed(1) : '0.0';

  const transferLines = transfers.map(t =>
    `- Transfer to ${extractName(t.payload)} at ${formatElapsed(t.elapsedMs)} into the call`
  ).join('\n');

  const conferenceLines = conferences.map(c =>
    `- Conference with ${extractName(c.payload)} at ${formatElapsed(c.elapsedMs)} into the call`
  ).join('\n');

  engagementSummary = {
    engagementId,
    generatedAt: new Date().toISOString(),
    agentName: 'Sarah Johnson',
    consumerName: 'Marcus Thompson',
    stats: {
      durationMs,
      holdPct,
      holdCount,
      transferCount: transfers.length,
      conferenceCount: conferences.length,
    },
    transferDetails: transferLines,
    conferenceDetails: conferenceLines,
    aiSummary: 'The customer called in regarding a billing discrepancy on their account, specifically an unrecognized charge from the previous billing cycle. The agent greeted the customer professionally, verified their identity, and quickly located the account. After reviewing the transaction history, the agent identified an erroneous duplicate charge and applied a $34.99 credit. The customer expressed frustration mid-call when placed on hold without being told the reason, but was satisfied with the resolution. The call ended positively with the customer confirming the credit and thanking the agent.',
    coachingNotes: [
      { type: 'positive', note: 'Strong opening — agent verified identity and pulled up the account within the first 30 seconds.' },
      { type: 'positive', note: 'Correct escalation path used when the billing system flagged the duplicate charge.' },
      { type: 'improve', note: 'Customer was placed on hold without explanation at 2m 14s. Always inform the customer why they are being placed on hold and provide an estimated wait time.' },
      { type: 'improve', note: 'Agent did not offer to send a confirmation email after applying the credit — a missed opportunity to reinforce trust.' },
      { type: 'neutral', note: 'Transfer to billing queue was appropriate given the charge type, though the agent could have resolved this independently with Level 2 access.' },
    ],
    eventLog: [...eventLog],
  };
}

function bucketEvent(event) {
  const key = event.toLowerCase();
  if (key.includes('contact_center.engagement_transfer_reserved')) {
    eventCounts.transfer++;
  } else if (key.includes('conference_participant_invited')) {
    eventCounts.conference++;
  } else if (key.includes('barge') || key.includes('monitor') || key.includes('whisper')) {
    eventCounts.bmw++;
  }
}
// Add a status message
function addStatusMessage(message, type = 'info') {
  const statusMessage = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    message: message,
    type: type // 'info', 'success', 'warning', 'error'
  };
  statusMessages.unshift(statusMessage);
  if (statusMessages.length > MAX_STATUS_MESSAGES) {
    statusMessages.pop();
  }
}

// API endpoint to get status messages
app.get('/api/webhooks/events', (req, res) => {
  res.json({ events: statusMessages });
});

// API endpoint for RTMS server to post status updates
app.post('/api/rtms/status', (req, res) => {
  const { message, type } = req.body;
  if (message) {
    addStatusMessage(message, type || 'info');
  }
  res.status(200).json({ received: true });
});

app.post('/api/rtms/transcript', (req, res) => {
  const { text } = req.body;
  if (text) {
    transcriptLines.push({ text, timestamp: new Date().toISOString() });
  }
  res.status(200).json({ received: true });
});

app.get('/api/engagement/transcript', (_req, res) => {
  res.json(transcriptLines);
});

// SSE clients waiting for live audio
const audioSseClients = new Set();

// RTMS server posts raw base64 audio chunks here
app.post('/api/rtms/audio', (req, res) => {
  const { data } = req.body;
  if (data && audioSseClients.size > 0) {
    const payload = `data: ${JSON.stringify({ data })}\n\n`;
    for (const client of audioSseClients) {
      client.write(payload);
    }
  }
  res.status(200).json({ received: true });
});

// Browser subscribes to this SSE stream to receive live audio
app.get('/api/rtms/audio/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  audioSseClients.add(res);
  console.log(`[Audio SSE] Client connected (${audioSseClients.size} total)`);

  req.on('close', () => {
    audioSseClients.delete(res);
    console.log(`[Audio SSE] Client disconnected (${audioSseClients.size} remaining)`);
  });
});

// API endpoint to get event bucket counts
app.get('/api/engagement/counts', (req, res) => {
  res.json(eventCounts);
});

// API endpoint to get hold data
app.get('/api/engagement/hold', (_req, res) => {
  res.json(holdData);
});

// API endpoint to get engagement summary (available after engagement ends)
app.get('/api/engagement/summary', (_req, res) => {
  res.json(engagementSummary || null);
});

// Demo: force-generate a test summary
app.post('/api/engagement/summary/test', (_req, res) => {
  // Seed a sample event log for the demo
  eventLog.length = 0;
  eventLog.push(
    { message: 'Agent placed consumer on hold.',     reason: 'Likely searching for account information or a support article.',  timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), elapsedMs: 2 * 60 * 1000 + 14 * 1000 },
    { message: 'Agent initiated a transfer.',         reason: "Customer's issue requires a specialised team.",                    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(), elapsedMs: 3 * 60 * 1000 + 12 * 1000 },
    { message: 'Agent placed consumer on hold.',     reason: 'Likely searching for account information or a support article.',  timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), elapsedMs: 5 * 60 * 1000 + 30 * 1000 },
  );
  generateEngagementSummary('demo-engagement', {
    durationMs: 7 * 60 * 1000 + 43 * 1000,
    holdMs: 94 * 1000,
    holdCount: 2,
    transfers: [{ elapsedMs: 3 * 60 * 1000 + 12 * 1000, payload: { transfer_to_queue_name: 'Billing Support' } }],
    conferences: [],
  });
  res.json({ ok: true });
});

// API endpoint to get active engagement
app.get('/api/engagement/active', (req, res) => {
  // Get the most recent active engagement
  const activeEngagement = Array.from(activeEngagements.values())
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

  if (activeEngagement) {
    res.json({
      isActive: true,
      engagementId: activeEngagement.engagementId,
      startedAt: activeEngagement.startedAt
    });
  } else {
    res.json({
      isActive: false,
      engagementId: null
    });
  }
});

// Webhook endpoint for Zoom events
app.post('/api/webhooks/zoom', async (req, res) => {
  const { event, payload } = req.body;

  console.log('Webhook received:', event);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  // Track engagement lifecycle
  if (event === 'contact_center.engagement_started') {
    const engagementId = payload?.object?.engagement_id || payload?.engagement_id;
    if (engagementId) {
      activeEngagements.set(engagementId, {
        engagementId: engagementId,
        startedAt: new Date().toISOString(),
        payload: payload
      });
      engagementTracker.startTime = Date.now();
      engagementTracker.engagementId = engagementId;
      engagementTracker.transfers = [];
      engagementTracker.conferences = [];
      engagementSummary = null;
      eventLog.length = 0;
      transcriptLines.length = 0;
      console.log(`[${engagementId}] Engagement started - now active`);
      addStatusMessage(`Engagement ${engagementId} started`, 'info');
    } else {
      console.error('[Engagement Started] Could not find engagement_id in payload!');
    }
  } else if (event === 'contact_center.engagement_user_hold') {
    holdData.count++;
    holdData.isOnHold = true;
    holdData.holdStartedAt = Date.now();
    const holdElapsedMs = engagementTracker.startTime ? Date.now() - engagementTracker.startTime : 0;
    generateHoldReason(engagementTracker.engagementId, holdElapsedMs);
  } else if (event === 'contact_center.engagement_user_unhold') {
    if (holdData.isOnHold && holdData.holdStartedAt) {
      holdData.totalHoldMs += Date.now() - holdData.holdStartedAt;
    }
    holdData.isOnHold = false;
    holdData.holdStartedAt = null;
  } else if (event === 'contact_center.engagement_ended') {
    const engagementId = payload?.object?.engagement_id || payload?.engagement_id;
    if (engagementId) {
      // Snapshot everything before reset for summary generation
      const snapshot = {
        durationMs: engagementTracker.startTime ? Date.now() - engagementTracker.startTime : 0,
        holdMs: holdData.isOnHold && holdData.holdStartedAt
          ? holdData.totalHoldMs + (Date.now() - holdData.holdStartedAt)
          : holdData.totalHoldMs,
        holdCount: holdData.count,
        transfers: [...engagementTracker.transfers],
        conferences: [...engagementTracker.conferences],
      };

      activeEngagements.delete(engagementId);
      statusMessages.length = 0;
      eventCounts.transfer = 0;
      eventCounts.conference = 0;
      eventCounts.bmw = 0;
      holdData.count = 0;
      holdData.isOnHold = false;
      holdData.totalHoldMs = 0;
      holdData.holdStartedAt = null;
      engagementTracker.startTime = null;
      engagementTracker.engagementId = null;
      engagementTracker.transfers = [];
      engagementTracker.conferences = [];

      console.log(`[${engagementId}] Engagement ended - generating summary`);
      generateEngagementSummary(engagementId, snapshot);
    }
  }

  // Track transfer and conference events with timestamps
  if (engagementTracker.startTime) {
    const elapsed = Date.now() - engagementTracker.startTime;
    if (event === 'contact_center.engagement_transfer_initiated') {
      engagementTracker.transfers.push({ elapsedMs: elapsed, payload });
    } else if (event.includes('conference')) {
      engagementTracker.conferences.push({ elapsedMs: elapsed, payload });
    }
  }

  // Bucket every incoming event by keyword
  bucketEvent(event);

  // Create simplified status messages for RTMS events
  if (event === 'contact_center.voice_rtms_started') {
    const engagementId = payload?.engagement_id || 'unknown';
    addStatusMessage(`Starting RTMS connection for engagement ${engagementId}`, 'info');
  } else if (event === 'contact_center.voice_rtms_stopped') {
    const engagementId = payload?.engagement_id || 'unknown';
    addStatusMessage(`RTMS stopped for engagement ${engagementId}`, 'success');
  }

  // Handle URL validation
  if (event === 'endpoint.url_validation') {
    if (!payload?.plainToken) {
      return res.status(400).json({ error: 'Missing plainToken' });
    }

    const encryptedToken = crypto
      .createHmac('sha256', process.env.ZOOM_SECRET_TOKEN || 'your-secret-token')
      .update(payload.plainToken)
      .digest('hex');

    return res.json({
      plainToken: payload.plainToken,
      encryptedToken
    });
  }

  // Forward RTMS events to RTMS server
  // The @zoom/rtms SDK creates its own webhook endpoint at the root path
  const rtmsEvents = [
    'contact_center.voice_rtms_started',
    'contact_center.voice_rtms_stopped',
  ];

  if (rtmsEvents.includes(event)) {
    // Create unique signature for this webhook to detect duplicates
    const webhookSignature = `${event}:${payload.engagement_id || payload.rtms_stream_id}:${req.body.event_ts}`;

    // Check if we've recently processed this exact webhook
    if (recentWebhooks.has(webhookSignature)) {
      console.log(`Duplicate webhook detected (${webhookSignature}), skipping forward`);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Mark this webhook as processed
    recentWebhooks.set(webhookSignature, Date.now());

    // Clean up old entries after dedup window
    setTimeout(() => {
      recentWebhooks.delete(webhookSignature);
    }, WEBHOOK_DEDUP_WINDOW_MS);

    // Respond immediately — Zoom requires 200 within 3 seconds
    res.status(200).json({ received: true });

    // Forward to RTMS server asynchronously with retry (fire-and-forget)
    const rtmsServerUrl = process.env.RTMS_SERVER_URL || 'http://localhost:8080'; // Dev default
    forwardWithRetry(rtmsServerUrl, req.body)
      .then(() => console.log(`Forwarded ${event} to RTMS server`))
      .catch((error) => console.error(`Failed to forward ${event} after retries:`, error.message));

    return; // Prevent double-send below
  }

  res.status(200).json({ received: true });
});

// RTMS Control endpoint
app.post('/api/zoom/rtms/control', handleRtmsControl);

// Proxy endpoint for Zoom API calls with automatic token refresh
app.all('/api/zoom/*', async (req, res) => {
  const tokens = await getTokens();

  if (!tokens.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const zoomPath = req.path.replace('/api/zoom/', '');
  const zoomUrl = `https://api.zoom.us/v2/${zoomPath}`;

  try {
    const data = await zoomApiRequest({
      method: req.method,
      url: zoomUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      data: req.body,
      params: req.query
    }, tokens);

    res.json(data);
  } catch (error) {
    console.error('Zoom API proxy error:', error.response?.data || error.message);

    // If authentication failed after refresh attempt, return 401
    if (error.message === 'Authentication failed - please re-authenticate') {
      return res.status(401).json({
        error: 'Authentication expired',
        message: 'Please re-authenticate with Zoom',
        needsAuth: true
      });
    }

    res.status(error.response?.status || 500).json({
      error: 'Zoom API request failed',
      code: error.response?.data?.code
    });
  }
});

// Proxy all other requests to frontend React dev server (Docker mode)
// This allows the backend to serve as single entry point
app.use('/', createProxyMiddleware({
  target: FRONTEND_INTERNAL_URL,
  changeOrigin: true,
  ws: true, // Proxy websockets for React hot reload
  logLevel: 'silent',
  onError: (err, req, res) => {
    console.log('Proxy error:', err.message);
    res.writeHead(500, {
      'Content-Type': 'text/plain',
    });
    res.end('Frontend proxy error. Is the frontend container running?');
  }
}));

// Start server
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL (OAuth redirects): ${FRONTEND_URL}`);
  console.log(`Frontend Internal URL (proxy): ${FRONTEND_INTERNAL_URL}`);
  console.log(`Public URL: ${process.env.PUBLIC_URL || 'http://localhost:3001'}`);
  console.log(`All requests to http://localhost:${PORT} are proxied to frontend at ${FRONTEND_INTERNAL_URL}`);
  console.log(`OAuth redirects go to: ${FRONTEND_URL}`);
  console.log(`API requests to /api/* are handled by this backend`);
});
