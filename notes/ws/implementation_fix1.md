# Implementation Plan: Fix #1 - Circular Dependency

**Date**: 2025-10-14  
**Priority**: CRITICAL  
**Estimated Impact**: Fixes handshake, enables all WebSocket communication

---

## Problem Statement

The `send()` method in `web/js/ws_client.js` requires `handshakeComplete = true` for ALL messages, including the handshake message itself. This creates a circular dependency where:

- Handshake message can't be sent because `handshakeComplete` is false
- `handshakeComplete` can't become true without receiving `handshake_ack`
- Server can't send `handshake_ack` without receiving handshake message

**Result**: Handshake gets queued forever, backend waits forever, no communication happens.

---

## Code Changes

### File: `web/js/ws_client.js`

#### Location: Line 279-296 (the `send()` method)

#### Current Code (BROKEN):

```javascript
send(message) {
    // Ensure session_id is set
    if (!message.session_id) {
        message.session_id = this.sessionId;
    }
    
    // Add timestamp if not present
    if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
    }
    
    // Check if ready to send
    // ❌ BUG: This requires handshakeComplete for ALL messages!
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.handshakeComplete) {
        try {
            this.ws.send(JSON.stringify(message));
            console.log('[WSClient] Sent message:', message.type);
        } catch (error) {
            console.error('[WSClient] Error sending message:', error);
            this.messageQueue.push(message);
        }
    } else {
        // Queue message for later
        console.log('[WSClient] Queueing message (not ready):', message.type);
        this.messageQueue.push(message);
    }
}
```

#### Fixed Code:

```javascript
send(message) {
    // Ensure session_id is set
    if (!message.session_id) {
        message.session_id = this.sessionId;
    }
    
    // Add timestamp if not present
    if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
    }
    
    // ✅ FIX: Allow handshake messages to bypass handshakeComplete check
    const isHandshake = message.type === 'handshake';
    const canSend = this.ws && 
                    this.ws.readyState === WebSocket.OPEN && 
                    (this.handshakeComplete || isHandshake);
    
    if (canSend) {
        try {
            this.ws.send(JSON.stringify(message));
            console.log('[WSClient] Sent message:', message.type);
        } catch (error) {
            console.error('[WSClient] Error sending message:', error);
            this.messageQueue.push(message);
        }
    } else {
        // Queue message for later
        console.log('[WSClient] Queueing message (not ready):', message.type);
        this.messageQueue.push(message);
    }
}
```

---

## Key Changes

### Before:
```javascript
if (this.ws && this.ws.readyState === WebSocket.OPEN && this.handshakeComplete)
```

### After:
```javascript
const isHandshake = message.type === 'handshake';
const canSend = this.ws && 
                this.ws.readyState === WebSocket.OPEN && 
                (this.handshakeComplete || isHandshake);

if (canSend)
```

### Explanation:

1. **Check if message is handshake**: `const isHandshake = message.type === 'handshake'`
2. **Allow handshake through**: `(this.handshakeComplete || isHandshake)`
3. **All other messages still require handshakeComplete**: Regular messages still queued until handshake completes

---

## Expected Behavior After Fix

### New Event Flow:

```
1. Extension loads
2. WSClient created
3. connect() called
4. WebSocket opens
5. handleOpen() fires
   ├─ Log: "WebSocket connected"
   ├─ sendHandshake() called
   │  └─ send({ type: 'handshake', ... })
   │     └─ ✅ isHandshake = true
   │        └─ ✅ canSend = true (even though handshakeComplete = false)
   │           └─ ✅ Handshake SENT to server!
   └─ startHeartbeat() (will be removed in Fix #3)
6. Backend receives handshake
7. Backend validates and sends handshake_ack
8. handleMessage() receives handshake_ack
9. handleHandshakeAck() fires
   ├─ handshakeComplete = true ✅
   ├─ Log: "Handshake acknowledged"
   └─ flushMessageQueue() - sends all queued messages
10. ✅ System ready! Communication works!
```

---

## Testing Plan

### 1. Verify Handshake Sent

**Expected logs**:
```
[WSClient] Connecting to: ws://localhost:8000/ws
[WSClient] WebSocket connected
[WSClient] Sending handshake
[WSClient] Sent message: handshake  ← NEW! Should appear now!
```

### 2. Verify Backend Receives Handshake

**Expected backend logs**:
```
INFO: WebSocket connection accepted, waiting for handshake
INFO: Received handshake from session: b115cf0e-...
INFO: Sending handshake_ack
```

### 3. Verify Handshake Acknowledged

**Expected frontend logs**:
```
[WSClient] Received message: handshake_ack
[WSClient] Handshake acknowledged: success
[WSClient] Flushing N queued messages  ← If any were queued
```

### 4. Verify User Messages Work

**Test**: Send a user message in chat

**Expected**:
- Message appears in chat UI
- Message sent to backend (not queued)
- Backend processes and responds
- Response appears in chat UI

---

## Risks & Considerations

### Low Risk

This is a minimal, surgical change that:
- Only affects the condition check in `send()`
- Doesn't change any other logic
- Doesn't add new dependencies
- Maintains backward compatibility

### Edge Cases Handled

1. **WebSocket not open yet**: Still queues (correct behavior)
2. **Non-handshake messages before handshake complete**: Still queued (correct behavior)
3. **Handshake message**: Now sent immediately (FIXED behavior)
4. **Messages after handshake complete**: Sent immediately (unchanged behavior)

---

## Files Modified

- `web/js/ws_client.js` - Line 279-296 (send method)

---

## Dependencies

This fix is **independent** and can be applied without Fix #2 or Fix #3.

However, for full functionality:
- Fix #2 (ChatUI race condition) should also be applied
- Fix #3 (Remove heartbeat) is optional but recommended

---

## Rollback Plan

If this fix causes issues, simply revert the `send()` method to:

```javascript
if (this.ws && this.ws.readyState === WebSocket.OPEN && this.handshakeComplete) {
```

No other changes needed.

---

## Success Criteria

✅ Handshake message is sent to backend  
✅ Backend receives and acknowledges handshake  
✅ `handshakeComplete` becomes true  
✅ Queued messages are flushed  
✅ User messages are sent and received  
✅ Chat UI shows agent responses  

---

## Next Steps After This Fix

1. Apply this fix
2. Test handshake completion
3. If successful, proceed to Fix #2 (ChatUI race condition)
4. Then apply Fix #3 (Remove heartbeat)

---

## Questions?

Ready to implement this fix?
