# Zoom Contact Center RTMS App — PWA

## Overview

This application captures live audio and transcripts from Zoom Contact Center voice engagements via RTMS. Agents manually start and stop capture from a standalone PWA accessible in the browser. The app runs as four Docker containers managed by Docker Compose:

- **Frontend**: React PWA with Start/Stop RTMS controls, proxied through the backend
- **Backend**: Express API server handling OAuth, webhooks, and frontend proxying
- **RTMS Server**: Real-time media stream processor for audio and transcript capture
- **Redis**: Token and session persistence

## Features

- Manual audio capture — agent-initiated Start/Stop from the browser PWA
- Real-time WebSocket connection to Zoom media servers
- WAV file output per channel (16kHz, 16-bit) + interleaved stereo output
- Real-time transcript capture saved per engagement
- Audio chunk count tracked and reported in real-time via status feed
- Call transfer detection with automatic reconnection
- OAuth 2.0 authentication with automatic token refresh via Redis
- Webhook signature verification for security
- Docker containerization for easy deployment
- Duplicate webhook prevention
- Graceful engagement cleanup

## Prerequisites

Before setting up the application, ensure you have:

- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker and Docker Compose (for containerized deployment)
- ffmpeg (for raw PCM to WAV conversion)
- Zoom Contact Center account with admin access
- RTMS license provisioned to your Contact Center account
- ngrok account (for exposing local server to Zoom webhooks)

## Installation

### 1. Clone and Install Dependencies

```bash
# Install all dependencies
cd frontend && npm install
cd ../backend && npm install
cd ../rtms && npm install
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env
```

### 3. Start with Docker

```bash
# Start all services
docker-compose up
```

The backend is available at http://localhost:3001 and also proxies the frontend. The frontend and RTMS containers have no external ports — they are internal only.

### 4. Setup ngrok for Webhook Testing

In a new terminal:

```bash
# Start ngrok tunnel
npm run ngrok

# Or run ngrok directly
ngrok http 3001
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`) for use in your `.env` file and Marketplace setup:

```bash
PUBLIC_URL=https://abc123.ngrok-free.app
FRONTEND_URL=https://abc123.ngrok-free.app
ZOOM_REDIRECT_URL=https://abc123.ngrok-free.app/api/auth/callback
```

**Restart the application** to pick up new environment variables:

```bash
docker-compose restart
```

## Zoom Marketplace Setup

### 1. Create a New App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Click "Develop" > "Build App"
3. Select "General App" as the app type — set it as **admin-managed** (required to receive Contact Center webhook events)
4. Fill in basic information:
   - App name: Your app name
   - Redirect URL for OAuth: `https://your-ngrok-url.ngrok-free.app/api/auth/callback`
5. Create an event subscription under "Access":
   - Toggle "Event Subscription" on
   - Select "Webhook" for your method
   - Add a name
   - Set notification URL: `https://your-ngrok-url.ngrok-free.app/api/webhooks/zoom`
   - Subscribe to these events:
     - `contact_center.engagement_started` — **Required** — enables Start/Stop buttons in the PWA
     - `contact_center.engagement_ended` — **Required** — disables buttons when engagement ends
     - `contact_center.voice_rtms_started` — triggers RTMS connection
     - `contact_center.voice_rtms_stopped` — triggers cleanup and WAV conversion
6. Add app permissions under "Scopes":
   - `contact_center:read:zcc_voice_audio`
   - `contact_center:update:engagement_rtms_app_status`
   - `contact_center:read:zcc_voice_transcript`
7. Enable RTMS under the "RTMS" tab

### 2. Configure App Credentials

In the "App Credentials" tab:

1. Note your **Client ID** and **Client Secret**
2. Add these to your `.env` file as:
   - `ZOOM_APP_CLIENT_ID`
   - `ZOOM_APP_CLIENT_SECRET`
3. Access and copy your **Secret Token** for event notifications in the "Access" menu. Add to `.env` as:
   - `ZOOM_SECRET_TOKEN`

### 3. Add Your App for Use

Ensure your app is ready for use by adding it within the "Add your App → Local Test" menu. Clicking "Add App" will run through the OAuth process. Make sure your application is up and running first.

### 4. OAuth Token Storage

The app uses OAuth 2.0 with automatic token refresh. Tokens are stored server-side in Redis for persistence across restarts.

```
OAuth Callback → Redis (key: "oauth:tokens")
                       ↓
PWA → API Request → Retrieve tokens from Redis → Call Zoom API
```

- Tokens persist across server and Docker restarts
- Access tokens are refreshed automatically on 401; no user interaction needed
- If the refresh token expires, re-install/re-authorize from Zoom Marketplace
- For multi-user production: update Redis key to include user ID (e.g., `oauth:tokens:{userId}`)
- Token store module: `backend/helpers/token-store.js`

## Admin Setup

Once your app is installed for use, configure it with your Contact Center settings at zoom.us/myhome:

1. Navigate to "Admin → Contact Center Management → Integrations"
2. Select "Zoom Apps", then the "RTMS" tab
3. Locate and select your newly created RTMS app
4. Ensure **auto-start is disabled** — capture is initiated manually via the PWA
5. Add the app to the appropriate queue (note: voice engagements cannot access RTMS unless the agent is assigned to a queue with app access)

> **Note:** The app must be **admin-managed** in Zoom Marketplace for `contact_center.engagement_started` and `contact_center.engagement_ended` events to be delivered. User-managed apps do not receive these events.

## Application Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ZOOM_APP_CLIENT_ID` | Client ID from Zoom Marketplace | `abc123xyz` |
| `ZOOM_APP_CLIENT_SECRET` | Client Secret from Zoom Marketplace | `secret123` |
| `ZOOM_SECRET_TOKEN` | Webhook secret token from Marketplace | `token123` |

### URL Configuration

| Variable | Description | Default | When to Update |
|----------|-------------|---------|----------------|
| `PUBLIC_URL` | Public backend URL for webhooks | `http://localhost:3001` | Update with ngrok URL |
| `ZOOM_REDIRECT_URL` | OAuth callback URL | `http://localhost:3001/api/auth/callback` | Update with ngrok URL |
| `FRONTEND_URL` | Frontend URL for CORS and redirects | `http://localhost:3000` | Update with ngrok URL |
| `FRONTEND_INTERNAL_URL` | Docker internal frontend URL | `http://frontend:3000` | Keep as Docker service name |
| `RTMS_SERVER_URL` | RTMS server URL | `http://rtms:8080` | Keep as Docker service name |

### Port Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Frontend port | `3000` |
| `BACKEND_PORT` | Backend API port | `3001` |
| `RTMS_PORT` | RTMS server port | `8080` |

### Other Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `SESSION_SECRET` | Express session secret | Generate random string |

## Application Flow

### 1. Agent Initiates Capture

```
Agent receives call in Zoom Contact Center
         ↓
Zoom triggers webhook: contact_center.engagement_started
         ↓
Backend receives webhook at /api/webhooks/zoom
         ↓
PWA polls /api/engagement/active every 2s — enables Start/Stop buttons
         ↓
Agent opens PWA and clicks "Start RTMS"
         ↓
Frontend calls Backend: POST /api/zoom/rtms/control
         ↓
Backend calls Zoom API to start RTMS
         ↓
Zoom triggers webhook: contact_center.voice_rtms_started
         ↓
Backend forwards to RTMS server at http://rtms:8080
```

### 2. RTMS Connection

```
RTMS server connects to Zoom signaling WebSocket
         ↓
Sends handshake with signature (HMAC-SHA256)
         ↓
Receives media server URL
         ↓
Connects to media WebSocket
         ↓
Sends media handshake (requests audio: 16kHz, mono, L16 + transcripts)
         ↓
Sends CLIENT_READY_ACK
```

### 3. Audio & Transcript Capture

```
RTMS server receives audio data messages (msg_type: 14/15)
         ↓
Extracts base64-encoded audio chunks by channel_id
         ↓
Decodes to PCM and appends to per-channel .raw file
         ↓
Files saved at: rtms/data/audio/{session_timestamp}/channel_N.raw

RTMS server receives transcript messages (msg_type: 17)
         ↓
Appends JSON transcript entry with ISO timestamp prefix
         ↓
Saved at: rtms/data/transcripts/{engagement_id}.txt
```

### 4. Agent Stops Capture

```
Agent clicks "Stop RTMS"
         ↓
Zoom triggers webhook: contact_center.voice_rtms_stopped
         ↓
RTMS server closes WebSocket connections
         ↓
Each channel .raw file converted to channel_N.wav via ffmpeg
         ↓
Per-channel files interleaved into mixed.wav (stereo if 2 channels)
         ↓
Cleans up engagement resources
         ↓
Session directory ready: rtms/data/audio/{session_timestamp}/
```

## Data Storage

### Audio Files

Each engagement creates a timestamped session directory containing:

- **Location**: `rtms/data/audio/{YYYY-MM-DD_HH-MM-SS}/`
- **Per-channel raw**: `channel_N.raw` — raw 16-bit PCM captured during the call
- **Per-channel WAV**: `channel_N.wav` — individual mono WAV (16kHz, 16-bit) per channel
- **Mixed output**: `mixed.wav` — stereo interleaved WAV (L=channel 0, R=channel 1) when 2 channels; mono when 1 channel

### Transcript Files

- **Location**: `rtms/data/transcripts/`
- **Naming**: `{engagement_id}.txt` — one file per engagement
- **Format**: Plain text, one JSON entry per line with ISO timestamp prefix

### File Management

```bash
# Clean all audio files
npm run clean:audio

# View session directories
ls -lh rtms/data/audio/

# Play mixed output (requires ffplay)
ffplay rtms/data/audio/2024-01-15_10-30-45/mixed.wav

# View transcript for an engagement
cat rtms/data/transcripts/{engagement_id}.txt
```

## Development

### Local Development (without Docker)

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start RTMS server
cd rtms
npm run dev

# Terminal 3: Start frontend
cd frontend
npm start

# Terminal 4: Start ngrok
npm run ngrok
```

### Docker Development

```bash
# Start all services
docker-compose up

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f frontend
docker-compose logs -f backend
docker-compose logs -f rtms

# Rebuild containers
npm run rebuild

# Stop all services
npm stop
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start all services with Docker Compose |
| `npm stop` | Stop all Docker containers |
| `npm run build` | Build Docker images |
| `npm run logs` | View all Docker logs |
| `npm run rebuild` | Tear down, rebuild, and restart |
| `npm run clean` | Remove containers and volumes |
| `npm run clean:audio` | Delete all captured audio files |
| `npm run health` | Check backend health endpoint |
| `npm run ngrok` | Start ngrok tunnel on port 3001 |

## API Endpoints

### Backend (Port 3001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/home` | GET | App home (redirects to frontend) |
| `/api/auth/authorize` | GET | OAuth authorization |
| `/api/auth/callback` | GET | OAuth callback |
| `/api/webhooks/zoom` | POST | Zoom webhook handler |
| `/api/engagement/active` | GET | Current active engagement |
| `/api/zoom/*` | ALL | Proxy to Zoom API |
| `/*` | ALL | Proxy to frontend |

### RTMS Server (Port 8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | POST | RTMS webhook handler |
| `/health` | GET | Health check with active engagements |

## Troubleshooting

**Webhooks not working?**
- Ensure ngrok is running and the URL is set in both `.env` and Zoom Marketplace
- Webhook URL must match: `https://your-ngrok-url.ngrok-free.app/api/webhooks/zoom`

**Buttons are greyed out / Can't start RTMS?**
- Confirm you've subscribed to `contact_center.engagement_started` and `contact_center.engagement_ended`
- Start an engagement in Zoom Contact Center and check backend logs: `docker-compose logs -f backend`
- Look for `[Engagement Started]` in logs
- Check active engagement state: `curl http://localhost:3001/api/engagement/active`
- If webhook is received but buttons are still greyed, check the browser console for errors

**Can't start RTMS after buttons are enabled?**
- Ensure you're authenticated — look for a "Connect to Zoom" prompt in the PWA
- Check for `Authentication expired` errors in backend logs — if present, re-authenticate via Zoom Marketplace

**Status messages not appearing?**
- Check RTMS server logs: `docker-compose logs -f rtms`
- Verify all services are running: `docker-compose ps`
