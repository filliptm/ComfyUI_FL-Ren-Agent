# WebSocket Event Handler Fix - Implementation Plan

## Solution
Add event emitter pattern to WSClient to support multiple listeners.

## Why Event Emitter?
- Multiple components need to listen to same events (extension.js + chat_ui.js)
- Standard JavaScript pattern
- Avoids callback property overwriting
- More flexible and maintainable

## Implementation

### File: `web/js/ws_client.js`

**Add EventEmitter class at top of file:**
```javascript
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }
    
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(listener => listener(...args));
        }
    }
    
    off(event, listenerToRemove) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
    }
}
```

**Modify WSClient constructor:**
```javascript
class WSClient extends EventEmitter {
    constructor(sessionId, config = {}) {
        super();  // Initialize EventEmitter
        // ... rest of constructor
    }
}
```

**Update all callback invocations to emit events:**

| Location | Current Code | New Code |
|----------|-------------|----------|
| Line ~100 (onopen) | `if (this.onConnect) this.onConnect();` | `this.emit('connected');` |
| Line ~195 (handshake) | `this._sendHandshake();` | Add: `this.emit('connecting');` |
| Line ~150 (handshake_ack) | `if (this.onHandshakeAck) this.onHandshakeAck(data);` | `this.emit('handshake_ack', data);` |
| Line ~160 (agent_response) | `if (this.onAgentResponse) this.onAgentResponse(data);` | `this.emit('agent_response', data);` |
| Line ~170 (tool_request) | `if (this.onToolRequest) this.onToolRequest(data);` | `this.emit('tool_request', data);` |
| Line ~180 (typing_indicator) | `if (this.onTypingIndicator) this.onTypingIndicator(data);` | `this.emit('typing_indicator', data);` |
| Line ~120 (onclose) | `if (this.onDisconnect) this.onDisconnect(event);` | `this.emit('disconnected', event);` |
| Line ~130 (onerror) | `if (this.onError) this.onError(event);` | `this.emit('error', event);` |

**Keep backward compatibility** by also calling callback properties if they exist.

### File: `web/js/extension.js`

**Update event handler registration (lines 52+):**
```javascript
// Old:
wsClient.onConnect = () => { ... };

// New:
wsClient.on('connected', () => { ... });
wsClient.on('disconnected', (event) => { ... });
wsClient.on('handshake_ack', (data) => { ... });
wsClient.on('agent_response', (data) => { ... });
wsClient.on('tool_request', (data) => { ... });
wsClient.on('typing_indicator', (data) => { ... });
wsClient.on('error', (error) => { ... });
```

### File: `web/js/chat_ui.js`

**Already uses correct pattern** (lines 549-552), no changes needed!

## Testing Checklist
- [ ] Frontend shows "Connected" status after handshake
- [ ] Send button becomes enabled
- [ ] Messages can be sent
- [ ] Both extension.js and chat_ui.js receive events
- [ ] No console errors
