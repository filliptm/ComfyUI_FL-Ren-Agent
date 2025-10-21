# PWA Notifications Implementation Guide

## Overview

This document details how to add **minimal, smart notifications** to the PWA. The approach:

1. **Broadcast execution events** from backend to PWA clients
2. **Show browser notifications** when workflow completes/fails (only when PWA is backgrounded)
3. **Add system messages to chat** with Ren links for quick actions
4. **Keep it simple** - No extra UI elements, everything flows through chat

## Philosophy

> "The chat is the interface. Notifications are just gentle reminders that bring you back to the conversation."

Notifications should:
- ✅ Be **informative** without being intrusive
- ✅ Include **actionable Ren links** in chat messages
- ✅ Only show **browser notifications when backgrounded**
- ✅ Keep the **chat as the single source of truth**
- ❌ NOT add extra UI panels, buttons, or complexity
- ❌ NOT duplicate information already in chat

## Implementation Steps

---

### Phase 1: Backend Event Broadcasting

#### 1.1 Update `backend/server.py` - Broadcast Execution Events

**Location**: In `websocket_endpoint` function, around line 276-290

**Current code**:
```python
elif msg_type == "execution_event":
    event = data.get("event")
    logger.debug(f"**execution_event**: {data}")
    event_data = data.get("data", {})
    await manager.handle_execution_event(event, event_data)
```

**New code**:
```python
elif msg_type == "execution_event":
    event = data.get("event")
    logger.debug(f"**execution_event**: {data}")
    event_data = data.get("data", {})
    await manager.handle_execution_event(event, event_data)
    
    # NEW: Broadcast execution events to PWA clients
    if manager.has_connection(session_id, 'pwa'):
        await manager.send_message(session_id, {
            "type": "execution_progress",
            "session_id": session_id,
            "event": event,
            "data": event_data,
            "timestamp": datetime.now().isoformat()
        }, target='pwa')
```

#### 1.2 Update `backend/server.py` - Broadcast Errors

**Location**: Around line 276

**Current code**:
```python
elif msg_type == "comfy_error":
    await manager.handle_comfy_error(data.get("data", {}))
```

**New code**:
```python
elif msg_type == "comfy_error":
    error_data = data.get("data", {})
    await manager.handle_comfy_error(error_data)
    
    # NEW: Broadcast errors to PWA clients
    if manager.has_connection(session_id, 'pwa'):
        await manager.send_message(session_id, {
            "type": "workflow_error",
            "session_id": session_id,
            "error_type": error_data.get("error_type", "execution_error"),
            "node_id": error_data.get("node_id"),
            "node_type": error_data.get("node_type"),
            "message": error_data.get("exception_message"),
            "timestamp": datetime.now().isoformat()
        }, target='pwa')
```

#### 1.3 Add Import for `datetime`

**Location**: Top of `backend/server.py` (if not already imported)

```python
from datetime import datetime
```

---

### Phase 2: PWA Notification Handling

#### 2.1 Update `web/pwa/app.js` - Add Notification Support

**Add after `setupWebSocketHandlers()` method**:

```javascript
/**
 * Request notification permission from user
 */
async requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('[RenPWA] Notifications not supported');
        return false;
    }
    
    if (Notification.permission === 'granted') {
        return true;
    }
    
    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }
    
    return false;
}

/**
 * Show a browser notification (only when PWA is backgrounded)
 */
showNotification(title, options = {}) {
    // Only show notification if PWA is not visible
    if (!document.hidden) {
        console.log('[RenPWA] Skipping notification - PWA is visible');
        return;
    }
    
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
            icon: '/pwa/static/icons/icon-192.png',
            badge: '/pwa/static/icons/icon-192.png',
            vibrate: [200, 100, 200],
            ...options
        });
        
        // Focus PWA when notification clicked
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
}
```

#### 2.2 Update `web/pwa/app.js` - Handle Execution Events

**Add to `setupWebSocketHandlers()` method**:

```javascript
// Track execution state
let currentExecution = null;

// Execution progress events
this.wsClient.on('execution_progress', (data) => {
    const { event, data: eventData } = data;
    
    if (event === 'start') {
        // Workflow started
        currentExecution = {
            prompt_id: eventData.prompt_id,
            start_time: Date.now()
        };
        
        console.log('[RenPWA] Workflow execution started:', eventData.prompt_id);
        
        // Add system message to chat
        this.chatUI.addMessage('system', 
            '🔄 **Workflow execution started**\n\nYour ComfyUI workflow is now running.',
            'system'
        );
        
    } else if (event === 'executing') {
        // Node executing (progress update)
        console.log('[RenPWA] Executing node:', eventData.node || eventData);
        
    } else if (event === 'success') {
        // Workflow completed successfully
        if (currentExecution) {
            const duration = ((Date.now() - currentExecution.start_time) / 1000).toFixed(1);
            
            // Show notification
            this.showNotification('✨ Workflow Complete!', {
                body: `Finished in ${duration}s`,
                tag: 'workflow-complete',
                requireInteraction: false
            });
            
            // Add system message with Ren link
            this.chatUI.addMessage('system',
                `✅ **Workflow completed successfully** in ${duration}s\n\n` +
                `[Show me the output](ren://message)`,
                'system'
            );
            
            currentExecution = null;
        }
    }
});

// Workflow error events
this.wsClient.on('workflow_error', (data) => {
    const { error_type, node_id, node_type, message } = data;
    
    // Show notification
    this.showNotification('❌ Workflow Error', {
        body: `${node_type || 'Node'} failed: ${message || 'Unknown error'}`,
        tag: 'workflow-error',
        requireInteraction: true  // Stays until dismissed
    });
    
    // Add system message with Ren link
    const errorMessage = node_id 
        ? `⚠️ **Workflow error in node ${node_id}**\n\n` +
          `**Type:** ${node_type || 'Unknown'}\n` +
          `**Error:** ${message || 'Unknown error'}\n\n` +
          `[Help me debug this](ren://message)`
        : `⚠️ **Workflow error**\n\n` +
          `**Error:** ${message || 'Unknown error'}\n\n` +
          `[Help me debug this](ren://message)`;
    
    this.chatUI.addMessage('system', errorMessage, 'system');
    
    // Clear execution state
    currentExecution = null;
});
```

#### 2.3 Update `web/pwa/app.js` - Request Permission on Connect

**In `connectToSession()` method, after initializing ChatUI**:

```javascript
// Initialize Chat UI
this.chatUI = new ChatUI(chatContainer, this.wsClient);

// Setup WebSocket event handlers
this.setupWebSocketHandlers();

// NEW: Request notification permission
await this.requestNotificationPermission();

// Connect
this.wsClient.connect();
```

---

### Phase 3: Update Service Worker for Notifications

#### 3.1 Update `web/pwa/service-worker.js` - Add Notification Event Handlers

**Add at the end of the file**:

```javascript
// Handle notification clicks
self.addEventListener('notificationclick', event => {
    console.log('[ServiceWorker] Notification clicked:', event.notification.tag);
    
    event.notification.close();
    
    // Focus or open PWA
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // If PWA is already open, focus it
                for (let client of clientList) {
                    if (client.url.includes('/pwa') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Otherwise open PWA
                if (clients.openWindow) {
                    return clients.openWindow('/pwa');
                }
            })
    );
});

// Handle notification close
self.addEventListener('notificationclose', event => {
    console.log('[ServiceWorker] Notification closed:', event.notification.tag);
});
```

---

### Phase 4: Styling for System Messages

#### 4.1 Update `web/pwa/styles.css` - Add System Message Styles

**Add after existing styles**:

```css
/* System message styling (reuse from main chat) */
.fl-message.system {
    background: rgba(100, 181, 246, 0.1);
    border-left: 3px solid rgba(100, 181, 246, 0.5);
    padding: 12px 16px;
    margin: 8px 0;
    border-radius: 8px;
    font-size: 14px;
}

.fl-message.system .fl-message-content {
    color: rgba(230, 213, 230, 0.9);
}

/* Ren links in system messages */
.fl-message.system .ren-link {
    display: inline-block;
    margin-top: 8px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #C8A2C8 0%, #B794F4 100%);
    color: #2d1f3d;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    transition: all 0.2s;
}

.fl-message.system .ren-link:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(200, 162, 200, 0.3);
}

.fl-message.system .ren-link:active {
    transform: scale(0.98);
}
```

---

### Phase 5: Update PWA Manifest for Notifications

#### 5.1 Update `web/pwa/manifest.json` - Add Notification Badge

**Add to existing manifest**:

```json
{
  "name": "Ren - ComfyUI Assistant",
  "short_name": "Ren",
  "description": "AI-powered ComfyUI workflow assistant",
  "start_url": "/pwa",
  "display": "standalone",
  "background_color": "#1a1420",
  "theme_color": "#2d1f3d",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/pwa/static/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/pwa/static/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/pwa/static/icons/icon-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "categories": ["productivity", "utilities"],
  "screenshots": [],
  "shortcuts": [
    {
      "name": "Open Chat",
      "short_name": "Chat",
      "description": "Open chat with Ren",
      "url": "/pwa",
      "icons": [
        {
          "src": "/pwa/static/icons/icon-192.png",
          "sizes": "192x192"
        }
      ]
    }
  ]
}
```

---

## Testing Guide

### 1. Test Backend Broadcasting

```bash
# Start backend
cd backend
python server.py

# In browser console, check for execution_progress messages
# Open ComfyUI, queue a workflow
# Check backend logs for "Broadcast execution events to PWA"
```

### 2. Test PWA Notifications

1. Open PWA on phone (via ngrok)
2. Grant notification permission when prompted
3. Background the PWA (go to home screen or switch apps)
4. Queue a workflow in ComfyUI
5. Wait for completion
6. Should receive notification: "✨ Workflow Complete!"
7. Tap notification to return to PWA
8. Should see system message in chat with "Show me the output" Ren link

### 3. Test Error Notifications

1. Create a workflow with intentional error (disconnect required node)
2. Queue workflow
3. Background PWA
4. Should receive error notification
5. Tap to return to PWA
6. Should see system message with "Help me debug this" Ren link

### 4. Test Ren Links

1. Tap "Show me the output" link in system message
2. Should send that message to Ren
3. Ren should respond with workflow outputs/images

---

## User Experience Flow

### Scenario 1: Successful Workflow

```
1. User queues workflow in ComfyUI
2. PWA shows system message: "🔄 Workflow execution started"
3. User backgrounds PWA and does other things
4. Workflow completes after 30 seconds
5. Phone buzzes with notification: "✨ Workflow Complete! Finished in 30.0s"
6. User taps notification, PWA opens
7. Chat shows: "✅ Workflow completed successfully in 30.0s"
   with Ren link: [Show me the output](ren://message)
8. User taps link
9. Ren responds with images/results
```

### Scenario 2: Workflow Error

```
1. User queues workflow with missing connection
2. PWA shows system message: "🔄 Workflow execution started"
3. Workflow fails immediately
4. Phone buzzes with notification: "❌ Workflow Error - KSampler failed: missing input"
5. User taps notification, PWA opens
6. Chat shows: "⚠️ Workflow error in node 7"
   Type: KSampler
   Error: Required input 'model' not connected
   with Ren link: [Help me debug this](ren://message)
7. User taps link
8. Ren analyzes workflow and suggests fix
```

---

## Implementation Checklist

### Backend Changes
- [ ] Add `datetime` import to `backend/server.py`
- [ ] Broadcast `execution_progress` events to PWA
- [ ] Broadcast `workflow_error` events to PWA
- [ ] Test event broadcasting with console logs

### PWA Frontend
- [ ] Add `requestNotificationPermission()` method
- [ ] Add `showNotification()` method
- [ ] Add execution progress event handler
- [ ] Add workflow error event handler
- [ ] Request permission on session connect
- [ ] Test notification permission flow

### Service Worker
- [ ] Add notification click handler
- [ ] Add notification close handler
- [ ] Test notification focusing PWA

### Styling
- [ ] Add system message styles
- [ ] Add Ren link styles for system messages
- [ ] Test on mobile (actual device)

### Manifest
- [ ] Update with notification badge icon
- [ ] Add shortcuts (optional)
- [ ] Test PWA installation

### Testing
- [ ] Test successful workflow notification
- [ ] Test error workflow notification
- [ ] Test Ren link "Show me the output"
- [ ] Test Ren link "Help me debug this"
- [ ] Test notification only shows when backgrounded
- [ ] Test notification opens PWA when tapped
- [ ] Test on iOS Safari (if available)
- [ ] Test on Android Chrome

---

## Notes on Ren Links

From `agents/agent.md`, Ren links are:
- Markdown links with `ren://message` as href
- Link text becomes the message sent to agent
- Already supported in `MessageBubble.js` and `ChatUI.js`
- Perfect for mobile - one tap to send common queries

**Example Ren links in system messages**:
```markdown
[Show me the output](ren://message)
[Help me debug this](ren://message)
[Queue it again](ren://message)
[What went wrong?](ren://message)
[Show me the workflow](ren://message)
```

The link text is written in the **user's voice** and should be:
- Specific and unambiguous
- Action-oriented
- Natural language
- Contextually relevant

---

## Future Enhancements (Optional)

### 1. Progress Indicator (Minimal)
If you want to show progress without extra UI:

```javascript
// Update page title with progress
if (event === 'executing' && currentExecution) {
    const nodeCount = eventData.node_count || '?';
    const currentNode = eventData.node_index || '?';
    document.title = `🔄 Ren (${currentNode}/${nodeCount})`;
}

// Reset title on completion
if (event === 'success') {
    document.title = 'Ren - ComfyUI Assistant';
}
```

### 2. Vibration Patterns

Different vibration for success vs error:

```javascript
// Success: Short double buzz
navigator.vibrate([100, 50, 100]);

// Error: Long buzz
navigator.vibrate([400]);
```

### 3. Rich Notifications (Future)

If you want to show images in notifications:

```javascript
this.showNotification('✨ Workflow Complete!', {
    body: `Finished in ${duration}s`,
    image: '/api/images/latest_output.png',  // Requires image proxy endpoint
    actions: [
        { action: 'view', title: 'View Output' },
        { action: 'queue', title: 'Queue Again' }
    ]
});
```

---

## Summary

**What we're adding**:
1. Backend broadcasts execution events to PWA
2. PWA shows browser notifications when backgrounded
3. System messages appear in chat with Ren links
4. Minimal, chat-focused approach

**What we're NOT adding**:
- Extra UI panels
- Progress bars
- Image galleries
- Queue management UI
- Any complexity beyond chat

**Why this works**:
- Ren can already show images in chat
- Ren can already explain errors
- Ren can already show workflow diagrams
- Ren links make mobile interaction natural
- Chat is the single interface

**Estimated implementation time**: 2-3 hours

**Result**: A clean, minimal PWA that keeps you informed without overwhelming you. The chat remains the center of the experience, notifications are just gentle nudges to return when something happens.
