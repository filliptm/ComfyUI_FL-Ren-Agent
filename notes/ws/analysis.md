# WebSocket Connection Issue - Analysis

## Problem
Frontend shows "Connecting..." indefinitely even though backend confirms WebSocket connection is accepted. Send button remains disabled.

## Root Cause
**Event handler pattern mismatch between `ws_client.js` and `chat_ui.js`**

### Current Implementation

**`web/js/ws_client.js`** uses callback properties:
```javascript
this.onConnect = null;
this.onDisconnect = null;
this.onHandshakeAck = null;
// etc...
```

**`web/js/chat_ui.js` (lines 549-552)** tries to use `.on()` event emitter pattern:
```javascript
this.wsClient.on('connected', () => this._updateConnectionStatus('connected'));
this.wsClient.on('disconnected', () => this._updateConnectionStatus('disconnected'));
this.wsClient.on('connecting', () => this._updateConnectionStatus('connecting'));
```

**`web/js/extension.js` (line 52+)** correctly uses callback properties:
```javascript
wsClient.onConnect = () => { ... };
wsClient.onDisconnect = (event) => { ... };
```

## Impact
- ChatUI status never updates from "Connecting..."
- Send button stays disabled (requires `handshakeComplete = true`)
- User cannot send messages
- Backend connection is actually working, just not reflected in UI

## Evidence
- `notes/backend.log` shows: "WebSocket connection accepted, waiting for handshake"
- WSClient has no `.on()` method defined
- ChatUI event handlers are silently failing (no errors, just no-op)
