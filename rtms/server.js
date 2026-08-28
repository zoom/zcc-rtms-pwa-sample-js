import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, appendFileSync } from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import WebSocket from 'ws';
import axios from 'axios';
import { saveRawAudio, convertRawToWav, closeRawStream, closeAllAudioStreams, makeSessionTimestamp, getChannelRawPath, getChannelWavPath, finalizeInterleavedWav } from './audioHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.ZOOM_APP_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_APP_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';

const dataDir = join(__dirname, 'data');
const audioDir = join(dataDir, 'audio');
const transcriptsDir = join(dataDir, 'transcripts');

[dataDir, audioDir, transcriptsDir].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

function saveTranscript(engagementId, data) {
  const timestamp = new Date().toISOString();
  const filePath = join(transcriptsDir, `${engagementId}.txt`);
  appendFileSync(filePath, `[${timestamp}] ${JSON.stringify(data)}\n`);
}

// Send status update to backend for UI display
async function sendStatusUpdate(message, type = 'info') {
  try {
    await axios.post(`${BACKEND_URL}/api/rtms/status`, { message, type });
  } catch (error) {
    // Silently fail if backend is not available
  }
}

// Push a transcript line to the backend
async function sendTranscriptLine(engagementId, text) {
  try {
    await axios.post(`${BACKEND_URL}/api/rtms/transcript`, { engagementId, text });
  } catch (error) {
    // Silently fail
  }
}

// Forward a raw audio chunk (base64) to the backend for SSE broadcast
function sendAudioChunk(b64data) {
  axios.post(`${BACKEND_URL}/api/rtms/audio`, { data: b64data }, { timeout: 1000 })
    .catch(() => {});
}

// Store active engagements
const activeEngagements = new Map();

// Rolling 30-second transcript buffer per engagement
const transcriptBuffer = new Map(); // engagementId -> [{text, ts}]

// Generate signature: HMAC-SHA256(client_id + "," + engagement_id + "," + rtms_stream_id, secret)
function generateSignature(engagementId, rtmsStreamId) {
  const message = `${CLIENT_ID},${engagementId},${rtmsStreamId}`;
  return crypto
    .createHmac('sha256', CLIENT_SECRET)
    .update(message)
    .digest('hex');
}

// Connect to signaling WebSocket
function connectToSignalingWebSocket(engagementId, rtmsStreamId, serverUrl, engagementData) {
  const ws = new WebSocket(serverUrl);
  engagementData.signalingWs = ws;

  ws.on('open', () => {
    console.log(`[${engagementId}] Signaling WebSocket connected`);

    const handshake = {
      msg_type: 1,
      protocol_version: 1,
      engagement_id: engagementId,
      rtms_stream_id: rtmsStreamId,
      sequence: 0,
      signature: generateSignature(engagementId, rtmsStreamId)
    };

    ws.send(JSON.stringify(handshake));
    console.log(handshake.signature)
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());

    if (message.msg_type === 2) {
      // Signaling handshake response
      if (message.status_code === 0) {
        console.log(`[${engagementId}] Signaling handshake successful`);
        const mediaUrl = message.media_server?.server_urls?.audio || message.media_server?.server_urls?.all;
        if (mediaUrl) {
          connectToMediaWebSocket(mediaUrl, engagementId, rtmsStreamId, ws, engagementData);
        }
      } else {
        console.error(`[${engagementId}] Signaling handshake failed:`, message.reason);
      }
    } else if (message.msg_type === 6) {
      console.log(message)
      // Event notification — pre-register channel with participantMode
      const eventType = message.event?.event_type;

      if (eventType === 10) {
        console.log(`[${engagementId}] Agent — channel ${message.event.participant_info.channel_id} `);
      } else if (eventType === 8) {
        console.log(`[${engagementId}] Consumer — channel`);
      }
      // if (channelId !== undefined && participantMode !== undefined) {
      //   if (!engagementData.channelPaths.has(channelId)) {
      //     const rawPath = getChannelRawPath(engagementData.sessionDir, channelId);
      //     const wavPath = getChannelWavPath(engagementData.sessionDir, channelId);
      //     engagementData.channelPaths.set(channelId, { rawPath, wavPath, chunkCount: 0, participantMode });
      //     console.log(`[${engagementId}] Channel ${channelId} registered as ${participantMode}`);
      //   }
      // }
      console.log(message);
    } else if (message.msg_type === 12) {
      // Keep-alive request
      ws.send(JSON.stringify({ msg_type: 13, timestamp: message.timestamp }));
    }
  });

  ws.on('error', (error) => {
    console.error(`[${engagementId}] Signaling WebSocket error:`, error.message);
  });

  ws.on('close', (code) => {
    console.log(`[${engagementId}] Signaling WebSocket closed (code: ${code})`);
  });
}

// Connect to media WebSocket
function connectToMediaWebSocket(mediaUrl, engagementId, rtmsStreamId, signalingWs, engagementData) {
  const ws = new WebSocket(mediaUrl);
  engagementData.mediaWs = ws;

  ws.on('open', () => {
    console.log(`[${engagementId}] Media WebSocket connected`);

    const handshake = {
      msg_type: 3,
      protocol_version: 1,
      engagement_id: engagementId,
      rtms_stream_id: rtmsStreamId,
      signature: generateSignature(engagementId, rtmsStreamId),
      media_type: 32, // Audio + transcript
      payload_encryption: false,
      media_params: {
        audio: {
          content_type: 2, // RAW_AUDIO
          sample_rate: 1,  // 16kHz
          channel: 1,      // Mono
          codec: 1,        // L16
          data_opt: 1,     // Mixed stream
          send_rate: 20    // 20ms intervals
        },
        transcript: {
          content_type: 5,
          src_language: 9,
          enable_lid: true
        }
      }
    };

    ws.send(JSON.stringify(handshake));
    console.log(`[${engagementId}] Sent media handshake`);
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());

    if (message.msg_type === 4) {
      // Media handshake response
      if (message.status_code === 0) {
        console.log(`[${engagementId}] Media handshake successful`);

        // Send CLIENT_READY_ACK to signaling connection
        signalingWs.send(JSON.stringify({
          msg_type: 7,
          rtms_stream_id: rtmsStreamId
        }));
        signalingWs.send(JSON.stringify({
          msg_type: 5,
          rtms_stream_id: rtmsStreamId
        }));

        console.log(`[${engagementId}] Ready to receive audio`);
      } else {
        console.error(`[${engagementId}] Media handshake failed:`, message.reason);
      }
    } else if (message.msg_type === 12) {
      // Keep-alive request
      ws.send(JSON.stringify({ msg_type: 13, timestamp: message.timestamp }));
    } else if (message.msg_type === 17) {
      console.log(`[${engagementId}] Transcript:`, message);
      saveTranscript(engagementId, message.content.data);

      // Push to rolling buffer, keep last 30 seconds, and forward to backend
      const text = typeof message.content.data === 'string'
        ? message.content.data
        : message.content.data?.text || '';
      if (text) {
        if (!transcriptBuffer.has(engagementId)) transcriptBuffer.set(engagementId, []);
        const buf = transcriptBuffer.get(engagementId);
        const now = Date.now();
        buf.push({ text, ts: now });
        const cutoff = now - 30000;
        while (buf.length > 0 && buf[0].ts < cutoff) buf.shift();
        sendTranscriptLine(engagementId, text);
      }
    } else if (message.msg_type === 14 || message.msg_type === 15) {
      // Audio data — save per channel
      const audioBuffer = Buffer.from(message.content.data, 'base64');
      const channelId = message.content.channel_id;

      if (!engagementData.channelPaths.has(channelId)) {
        const rawPath = getChannelRawPath(engagementData.sessionDir, channelId);
        const wavPath = getChannelWavPath(engagementData.sessionDir, channelId);
        engagementData.channelPaths.set(channelId, { rawPath, wavPath, chunkCount: 0, participantMode: 'unknown' });
        console.log(`[${engagementId}] New channel ${channelId} → ${rawPath}`);
      }

      const channel = engagementData.channelPaths.get(channelId);
      saveRawAudio(audioBuffer, channel.rawPath);

      // Lock onto the first channel seen and stream only that one
      if (engagementData.streamChannelId === null) {
        engagementData.streamChannelId = channelId;
        console.log(`[${engagementId}] Streaming channel ${channelId} (${channel.participantMode}) to browser`);
      }
      if (channelId === engagementData.streamChannelId) {
        sendAudioChunk(message.content.data);
      }
      channel.chunkCount++;
      engagementData.audioChunkCount++;

      if (channel.chunkCount % 100 === 0) {
        console.log(`[${engagementId}] Audio chunks: ${channel.chunkCount} for channel ${channelId} (${channel.participantMode})`);
        sendStatusUpdate(`Received ${engagementData.audioChunkCount} audio chunks`, 'success');
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[${engagementId}] Media WebSocket error:`, error.message);
  });

  ws.on('close', (code) => {
    console.log(`[${engagementId}] Media WebSocket closed (code: ${code})`);
  });
}

// Handle RTMS started webhook
function handleRTMSStarted(payload) {
  const { engagement_id, rtms_stream_id, server_urls } = payload;

  if (!engagement_id || !rtms_stream_id || !server_urls) {
    console.error('Invalid payload - missing required fields');
    return;
  }

  // Check for duplicate
  if (activeEngagements.has(engagement_id)) {
    console.warn(`[${engagement_id}] Connection already exists, skipping`);
    return;
  }

  // Reserve this engagement_id immediately to prevent race condition
  activeEngagements.set(engagement_id, { reservedAt: new Date() });

  console.log(`[${engagement_id}] Starting RTMS connection`);
  sendStatusUpdate(`Starting RTMS connection`, 'info');

  // Store engagement data
  const sessionDir = join(audioDir, makeSessionTimestamp());

  const engagementData = {
    engagementId: engagement_id,
    rtmsStreamId: rtms_stream_id,
    serverUrl: server_urls,
    sessionDir,
    channelPaths: new Map(), // channelId -> { rawPath, wavPath }
    audioChunkCount: 0,
    streamChannelId: null, // first channel seen — streamed to browser
    startedAt: new Date(),
    signalingWs: null,
    mediaWs: null
  };

  activeEngagements.set(engagement_id, engagementData);

  // Connect to signaling WebSocket
  try {
    connectToSignalingWebSocket(engagement_id, rtms_stream_id, server_urls, engagementData);
  } catch (error) {
    console.error(`Failed to connect:`, error.message);
    cleanupEngagement(engagement_id);
  }
}

// Handle RTMS stopped webhook
async function handleRTMSStopped(payload) {
  const { engagement_id } = payload;

  if (!engagement_id) {
    console.error('Invalid payload - missing engagement_id');
    return;
  }

  console.log(`[${engagement_id}] Stopping RTMS`);
  sendStatusUpdate(`RTMS stopped`, 'success');
  await cleanupEngagement(engagement_id);
}

// Cleanup engagement resources
async function cleanupEngagement(engagementId) {
  const data = activeEngagements.get(engagementId);

  if (!data) {
    console.warn(`[${engagementId}] No active connection found`);
    return;
  }

  try {
    // Close WebSockets
    if (data.signalingWs) {
      data.signalingWs.close();
    }
    if (data.mediaWs) {
      data.mediaWs.close();
    }

    // Close each channel's raw stream and convert to WAV
    for (const [channelId, { rawPath, wavPath }] of data.channelPaths) {
      await closeRawStream(rawPath);
      await convertRawToWav(rawPath, wavPath);
      console.log(`[${engagementId}] Channel ${channelId}: ${wavPath}`);
    }

    // Write interleaved stereo WAV from per-channel raw files
    await finalizeInterleavedWav(data.sessionDir, data.channelPaths);

    console.log('='.repeat(60));
    console.log(`[${engagementId}] Recording saved`);
    console.log('='.repeat(60));
    console.log(`Session: ${data.sessionDir}`);
    console.log(`Channels: ${data.channelPaths.size}`);
    console.log(`Total chunks: ${data.audioChunkCount}`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error(`[${engagementId}] Cleanup error:`, error.message);
  } finally {
    activeEngagements.delete(engagementId);
    transcriptBuffer.delete(engagementId);
    console.log(`[${engagementId}] Cleaned up`);
  }
}

// Create Express app
const app = express();
app.use(express.json());

// Webhook endpoint
app.post('/', (req, res) => {
  const { event, payload } = req.body;

  console.log(`\n[Webhook] Event: ${event}`);

  if (event === 'contact_center.voice_rtms_started') {
    handleRTMSStarted(payload);
    res.status(200).json({ received: true });
  } else if (event === 'contact_center.voice_rtms_stopped') {
    handleRTMSStopped(payload);
    res.status(200).json({ received: true });
  } else {
    console.log(`[Webhook] Unknown event: ${event}`);
    res.status(200).json({ received: true });
  }
});

// Return transcript from the last 10 seconds for a given engagement
app.get('/transcript/recent/:engagementId', (req, res) => {
  const buf = transcriptBuffer.get(req.params.engagementId) || [];
  const cutoff = Date.now() - 10000;
  const recent = buf.filter(e => e.ts >= cutoff).map(e => e.text).join(' ');
  res.json({ transcript: recent });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeEngagements: activeEngagements.size,
    engagements: Array.from(activeEngagements.keys())
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down...');
  for (const [engagementId] of activeEngagements.entries()) {
    await cleanupEngagement(engagementId);
  }
  await closeAllAudioStreams();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log('ZCC RTMS Server');
  console.log('='.repeat(50));
  console.log(`Port: ${PORT}`);
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log('='.repeat(50));
  console.log('\nServer ready - waiting for webhooks...\n');
});
