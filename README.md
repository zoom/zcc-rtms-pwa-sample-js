# Zoom Contact Center RTMS App — PWA

## Overview

This application captures live audio and transcripts from Zoom Contact Center voice engagements via RTMS (Real-Time Media Streams). Agents manually start and stop capture from a browser-based PWA. When a call ends, the app generates an engagement snapshot with AI-powered coaching notes, hold reason analysis, and a full event timeline.

The app runs as three coordinated Node.js processes:

- **Frontend** (`port 3000`): React PWA — real-time dashboard with RTMS controls, live audio playback, live transcript, and a post-call engagement snapshot
- **Backend** (`port 3001`): Express API server — handles OAuth 2.0, Zoom webhooks, event tracking, AI hold reason generation via OpenRouter, and live audio/transcript relay
- **RTMS Server** (`port 8080`): Real-time media stream processor — maintains WebSocket connections to Zoom media servers, captures audio per channel, generates WAV files, and forwards live audio and transcript data to the backend

---

## Features

- **Manual RTMS control** — agent-initiated Start/Stop from the browser PWA per active engagement
- **Real-time audio playback** — live audio streamed from RTMS server to browser via Server-Sent Events and played back through the Web Audio API (~200ms delay)
- **Live audio visualizer** — animated equalizer bars and waveform that activate when audio is streaming
- **Real-time transcript** — live scrolling transcript display, updated every 2 seconds from the backend
- **AI hold reason generation** — when an agent places a consumer on hold, the app captures the last 10 seconds of transcript and sends it to OpenRouter (Claude 3 Haiku) to generate a one-sentence explanation of why the agent held
- **Engagement Snapshot page** — a post-call summary page with call statistics, AI-generated narrative summary, coaching notes, and a timestamped event timeline; always accessible with mock data as a placeholder
- **Event tracking** — transfer, conference, and BMW (Barge/Monitor/Whisper) counters tracked in real time
- **Hold tracking** — live hold time display (ticks every second while on hold) and hold count
- **Per-channel WAV output** — audio saved as 16kHz 16-bit mono WAV per participant channel
- **Interleaved stereo WAV** — per-channel files merged into a single stereo `mixed.wav` on call end
- **Transcript files** — raw transcript JSON saved per engagement in `rtms/data/transcripts/`
- **OAuth 2.0** — authorization code flow with automatic token refresh; no re-auth needed mid-session
- **Webhook deduplication** — prevents double-processing of RTMS events delivered multiple times
- **Graceful cleanup** — WebSocket connections closed, audio streams flushed, and WAV files finalized on engagement end

---

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- ffmpeg (required for raw PCM → WAV conversion on the RTMS server)
- ngrok account (for exposing your local backend to Zoom webhooks)
- Zoom Contact Center account with admin access
- RTMS license provisioned to your Contact Center account
- OpenRouter API key (for AI hold reason generation — the app falls back gracefully if not set)

---

## Installation

### 1. Clone and Install Dependencies

```bash
git clone <repo-url>
cd rtms-zcc-pwa

# Install all dependencies across all three services
npm run install:all
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials. At minimum, set the required Zoom credentials and the ngrok URL once you have it. See the [Application Variables](#application-variables) section for the full reference.

### 3. Start All Services

```bash
npm start
```

This starts the backend, RTMS server, and frontend concurrently. All three must be running for the app to function.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| RTMS Server | http://localhost:8080 |

### 4. Expose the Backend with ngrok

In a separate terminal:

```bash
npm run ngrok
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) and update your `.env`:

```env
PUBLIC_URL=https://abc123.ngrok-free.app
FRONTEND_URL=https://abc123.ngrok-free.app
ZOOM_REDIRECT_URL=https://abc123.ngrok-free.app/api/auth/callback
```

Then restart the app to apply the new URLs:

```bash
# Stop (Ctrl+C), then:
npm start
```

---

## Zoom Marketplace Setup

### 1. Create a New App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Click **Develop → Build App** and select **General App**
3. Set the app as **admin-managed** — this is required to receive Contact Center engagement lifecycle events
4. Under **Basic Information**, set your app name and redirect URL:
   - Redirect URL: `https://your-ngrok-url.ngrok-free.app/api/auth/callback`

### 2. Configure Event Subscriptions

Under **Access → Event Subscriptions**:

1. Enable Event Subscriptions and select **Webhook** as the method
2. Set the notification URL: `https://your-ngrok-url.ngrok-free.app/api/webhooks/zoom`
3. Subscribe to the following events:

| Event | Purpose |
|-------|---------|
| `contact_center.engagement_started` | **Required** — activates the Start/Stop buttons in the PWA |
| `contact_center.engagement_ended` | **Required** — triggers engagement snapshot generation |
| `contact_center.engagement_user_hold` | Triggers AI hold reason generation |
| `contact_center.engagement_user_unhold` | Updates live hold timer |
| `contact_center.voice_rtms_started` | Triggers RTMS WebSocket connection |
| `contact_center.voice_rtms_stopped` | Triggers WAV conversion and cleanup |
| `contact_center.engagement_transfer_initiated` | Tracked in event counts and snapshot |

### 3. Add Scopes

Under **Scopes**, add:

- `contact_center:read:zcc_voice_audio`
- `contact_center:update:engagement_rtms_app_status`
- `contact_center:read:zcc_voice_transcript`

### 4. Enable RTMS

Under the **RTMS** tab, enable RTMS for your app.

### 5. Configure App Credentials

Under **App Credentials**:

1. Copy your **Client ID** and **Client Secret** → add to `.env` as `ZOOM_APP_CLIENT_ID` and `ZOOM_APP_CLIENT_SECRET`
2. Under **Access**, copy your **Secret Token** → add to `.env` as `ZOOM_SECRET_TOKEN`

### 6. Install the App

Under **Add your App → Local Test**, click **Add App** to run through the OAuth flow. Your backend must be running and reachable via ngrok when you do this.

### Token Storage

OAuth tokens are stored in memory on the backend. They persist for the lifetime of the process but are cleared on restart. If you restart the backend, click **Add App** in the Zoom Marketplace Local Test menu to re-authorize.

```
OAuth Callback → Backend memory (token-store.js)
                       ↓
PWA → API Request → Retrieve token → Zoom API call
```

> If the access token expires mid-session, it is refreshed automatically using the refresh token. No agent interaction is required unless the refresh token itself expires, in which case re-authorize from Zoom Marketplace.

---

## Admin Setup

Once your app is installed, configure it in your Contact Center:

1. Go to zoom.us/myhome → **Admin → Contact Center Management → Integrations**
2. Select **Zoom Apps**, then the **RTMS** tab
3. Find your app and open its settings
4. Ensure **auto-start is disabled** — capture is agent-initiated via the PWA
5. Assign the app to the appropriate queue — agents must be in a queue that has app access for RTMS events to be delivered

> **Important:** The app must be **admin-managed** in Zoom Marketplace for `contact_center.engagement_started` and `contact_center.engagement_ended` events to fire. User-managed apps do not receive these events, so the Start/Stop buttons will remain greyed out.

---

## Application Variables

### Required

| Variable | Description |
|----------|-------------|
| `ZOOM_APP_CLIENT_ID` | Client ID from Zoom Marketplace |
| `ZOOM_APP_CLIENT_SECRET` | Client Secret from Zoom Marketplace |
| `ZOOM_SECRET_TOKEN` | Webhook secret token for event validation |

### URL Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_URL` | Public backend URL (used for webhooks) | `http://localhost:3001` |
| `ZOOM_REDIRECT_URL` | OAuth callback URL | `http://localhost:3001/api/auth/callback` |
| `FRONTEND_URL` | Frontend URL for CORS and OAuth redirects | `http://localhost:3000` |
| `RTMS_SERVER_URL` | Internal URL the backend uses to reach the RTMS server | `http://localhost:8080` |
| `BACKEND_URL` | Internal URL the RTMS server uses to reach the backend | `http://localhost:3001` |

### AI Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key for hold reason generation | *(optional — falls back to a static reason)* |
| `AI_MODEL` | OpenRouter model ID | `anthropic/claude-3-haiku` |

### Port Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_PORT` | Backend API port | `3001` |
| `PORT` | RTMS server port | `8080` |

### Other

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `SESSION_SECRET` | Express session secret | `your-secret-key-change-in-production` |

---

## Application Flow

### 1. Engagement Starts

```
Agent receives a voice call in Zoom Contact Center
         ↓
Zoom fires: contact_center.engagement_started
         ↓
Backend receives it at POST /api/webhooks/zoom
         ↓
Backend stores engagement ID and resets all counters
         ↓
Frontend polls /api/engagement/active every 2s → Start/Stop buttons become active
```

### 2. Agent Starts RTMS

```
Agent opens the PWA and clicks "Start RTMS"
         ↓
Frontend → POST /api/zoom/rtms/control { action: "start" }
         ↓
Backend calls Zoom API to initiate RTMS for the engagement
         ↓
Zoom fires: contact_center.voice_rtms_started
         ↓
Backend deduplicates, then forwards to RTMS server → POST http://localhost:8080
         ↓
Frontend opens EventSource at /api/rtms/audio/stream (live audio begins)
         ↓
Equalizer bars animate, "Audio streaming to this device" label appears
```

### 3. RTMS Connection

```
RTMS server connects to Zoom signaling WebSocket
         ↓
Sends handshake: HMAC-SHA256 signature (client_id + engagement_id + stream_id)
         ↓
Receives media server URL from Zoom
         ↓
Connects to media WebSocket, sends media handshake:
  - Audio: 16kHz mono L16, 20ms intervals, mixed stream
  - Transcript: English with language detection
         ↓
Sends CLIENT_READY_ACK → media stream begins
```

### 4. Live Audio & Transcript

```
RTMS server receives audio frames (msg_type 14/15) every 20ms
         ↓
Locks onto first channel seen → saves .raw file per channel
         ↓
Forwards base64 audio chunk → POST /api/rtms/audio on backend
         ↓
Backend broadcasts to all SSE clients
         ↓
Browser decodes base64 → Int16Array → Float32Array → Web Audio API playback

RTMS server receives transcript (msg_type 17)
         ↓
Appends to rolling 30s buffer + saves to transcripts/{engagement_id}.txt
         ↓
Forwards text → POST /api/rtms/transcript on backend
         ↓
Frontend polls /api/engagement/transcript every 2s → scrolling transcript display
```

### 5. Hold Event

```
Agent places consumer on hold
         ↓
Zoom fires: contact_center.engagement_user_hold
         ↓
Backend increments hold count, starts hold timer
         ↓
Backend fetches last 10s of transcript from RTMS server
         ↓
If transcript available → sends to OpenRouter (Claude 3 Haiku):
  "In one concise sentence, why did the agent likely put the customer on hold?"
         ↓
AI response (or static fallback) stored in eventLog with elapsed time
         ↓
Event appears in the Engagement Snapshot timeline after the call ends
```

### 6. Engagement Ends

```
Call ends in Zoom Contact Center
         ↓
Zoom fires: contact_center.engagement_ended
         ↓
Backend snapshots all engagement data (duration, hold time, transfers, event log)
         ↓
Generates Engagement Snapshot: stats, AI narrative summary, coaching notes
         ↓
Frontend polls /api/engagement/summary → detects new summary → navigates to /snapshot
         ↓
Zoom fires: contact_center.voice_rtms_stopped
         ↓
RTMS server closes WebSocket connections
         ↓
Converts each channel .raw → channel_N.wav via ffmpeg
         ↓
Merges all channels into mixed.wav (stereo interleaved)
         ↓
Session directory finalized at rtms/data/audio/{YYYY-MM-DD_HH-MM-SS}/
```

---

## Data Storage

### Audio Files

Each engagement creates a timestamped session directory:

- **Location**: `rtms/data/audio/{YYYY-MM-DD_HH-MM-SS}/`
- `channel_N.raw` — raw 16-bit PCM appended in real time during the call
- `channel_N.wav` — mono WAV (16kHz, 16-bit) converted from raw on call end
- `mixed.wav` — stereo interleaved WAV (L = channel 0, R = channel 1); mono if only one channel

Only the first channel seen is forwarded to the browser for live playback. All channels are still saved to disk.

### Transcript Files

- **Location**: `rtms/data/transcripts/`
- **Naming**: `{engagement_id}.txt`
- **Format**: One JSON object per line, prefixed with an ISO timestamp

### File Management

```bash
# View all session directories
ls -lh rtms/data/audio/

# Play a recording (requires ffplay)
ffplay rtms/data/audio/2024-01-15_10-30-45/mixed.wav

# View transcript for an engagement
cat rtms/data/transcripts/{engagement_id}.txt

# Delete all captured audio files
npm run clean:audio
```

---

## Development

### Start All Services

```bash
npm start       # Starts backend + RTMS server + frontend concurrently
npm run ngrok   # In a separate terminal — exposes backend on port 3001
```

### Stop All Services

```bash
npm stop        # Kills processes on ports 3000, 3001, and 8080
# or just Ctrl+C in the terminal running npm start
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start all three services concurrently with nodemon hot-reload |
| `npm stop` | Kill all processes on ports 3000, 3001, 8080 |
| `npm run install:all` | Install dependencies for all three services |
| `npm run health` | Check backend health endpoint |
| `npm run ngrok` | Start ngrok tunnel on port 3001 |
| `npm run clean:audio` | Delete all captured audio files in `rtms/data/audio/` |

### Frontend Source Structure

```
frontend/src/
  App.js              — router + summary state (≈20 lines)
  pages/
    DashboardPage.js  — live dashboard: controls, audio, transcript
    SnapshotPage.js   — post-call snapshot display
  hooks/
    useEngagement.js  — active engagement polling + Zoom SDK init
    useEventCounts.js — transfer/conference/BMW counters
    useHoldData.js    — hold polling + live tick
    useRtms.js        — RTMS start/stop + audio SSE + Web Audio API
    useTranscript.js  — transcript polling + auto-scroll
    useWebhookEvents.js — status message polling
    useSummary.js     — summary polling + navigate to /snapshot
    useAuthRedirect.js — OAuth redirect URL param handling
  utils/
    format.js         — formatHoldTime utility
  data/
    mockData.js       — MOCK_SUMMARY placeholder for /snapshot
```

### Hot Reload

All three services run with `nodemon` (backend and RTMS server) and the Create React App dev server (frontend). File saves trigger automatic restarts — no manual restart needed during development.

> **Note:** The backend stores OAuth tokens in memory. Saving a backend file causes nodemon to restart the process, which clears the token. If buttons become unresponsive after a file save, re-authorize via Zoom Marketplace → Local Test → Add App.

---

## API Endpoints

### Backend (Port 3001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/auth/callback` | GET | OAuth 2.0 callback — stores tokens |
| `/api/auth/status` | GET | Whether the app is currently authenticated |
| `/api/auth/logout` | DELETE | Clear stored tokens |
| `/api/webhooks/zoom` | POST | Zoom webhook handler (all events) |
| `/api/webhooks/events` | GET | Recent status messages for the RTMS status panel |
| `/api/engagement/active` | GET | Current active engagement ID and state |
| `/api/engagement/counts` | GET | Transfer, conference, and BMW event counts |
| `/api/engagement/hold` | GET | Hold count, total hold time, and current hold state |
| `/api/engagement/transcript` | GET | All transcript lines for the current engagement |
| `/api/engagement/summary` | GET | Post-call engagement snapshot (null if none yet) |
| `/api/engagement/summary/test` | POST | Seed a demo summary (for testing the snapshot page) |
| `/api/rtms/status` | POST | RTMS server posts status messages here |
| `/api/rtms/transcript` | POST | RTMS server posts transcript lines here |
| `/api/rtms/audio` | POST | RTMS server posts base64 audio chunks here |
| `/api/rtms/audio/stream` | GET | SSE endpoint — browser subscribes to receive live audio |
| `/api/zoom/rtms/control` | POST | Start or stop RTMS for an engagement |
| `/api/zoom/*` | ALL | Authenticated proxy to Zoom API |
| `/*` | ALL | Proxy to frontend dev server |

### RTMS Server (Port 8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | POST | RTMS webhook handler (`voice_rtms_started` / `voice_rtms_stopped`) |
| `/health` | GET | Health check with active engagement IDs |
| `/transcript/recent/:engagementId` | GET | Last 10 seconds of transcript for an engagement (used by backend for AI hold reason) |

---

## Troubleshooting

**Webhooks not arriving?**
- Confirm ngrok is running and the URL in `.env` matches what's in Zoom Marketplace
- The webhook URL must be: `https://your-ngrok-url.ngrok-free.app/api/webhooks/zoom`
- ngrok URLs change each session — update `.env` and Zoom Marketplace each time you restart ngrok

**Start/Stop buttons are greyed out?**
- The buttons only activate when the backend has received `contact_center.engagement_started` for an active engagement
- Start a voice call in Zoom Contact Center, then check: `curl http://localhost:3001/api/engagement/active`
- If the response shows `isActive: false`, the webhook isn't reaching the backend — check ngrok and the Marketplace subscription

**"Start RTMS" returns an auth error?**
- The OAuth token was lost (backend restarted or token expired)
- Re-authorize: Zoom Marketplace → Your App → Local Test → Add App
- After OAuth completes, try again

**No audio in the browser?**
- Confirm RTMS started successfully — look for `[engagement_id] Media handshake successful` in RTMS server logs
- The browser requires a user gesture before AudioContext can play — clicking "Start RTMS" is that gesture; don't navigate away before audio connects
- Check the browser console for `[Live Audio] WebSocket closed` or SSE errors
- Verify the backend is receiving audio chunks: `curl http://localhost:3001/api/engagement/counts`

**No transcript appearing?**
- Check RTMS server logs for `[engagement_id] Transcript:` — if not present, Zoom is not sending transcript data
- Confirm your Zoom account has transcription enabled for Contact Center
- Hit `http://localhost:3001/api/engagement/transcript` directly to check if lines are arriving

**AI hold reasons are showing the fallback text?**
- Confirm `OPENROUTER_API_KEY` is set in `.env`
- Check backend logs for `[Hold reason] Failed:` when a hold event fires
- If no transcript was captured in the 10 seconds before the hold, the AI prompt will be empty and the fallback is used intentionally

**Snapshot page shows mock data after a real call?**
- The snapshot generates when `contact_center.engagement_ended` fires — confirm this event is subscribed in Zoom Marketplace
- After a call ends, poll `curl http://localhost:3001/api/engagement/summary` to see if data was generated
- The frontend navigates to `/snapshot` automatically within 3 seconds of detecting a new summary
