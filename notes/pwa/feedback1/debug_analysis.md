# Debug Analysis - Missing Tool Activity Display

**Date:** 2025-10-21  
**Issue:** Tool activity cards not showing in PWA  
**Status:** 🔍 Investigating message routing

---

## 🐛 Problem Statement

Tool activity visualization is not displaying in the PWA despite:
- `ToolActivity` class being initialized in `web/js/chat_ui.js`
- Tool activity event listeners registered in `web/js/extension.js`
- `tool_request` and `tool_report` message types being sent from backend

**Expected Behavior:**
- When agent uses a tool, floating card should appear in PWA
- Card should show tool icon, name, and activity animation

**Actual Behavior:**
- No tool activity cards visible
- No tool calls being displayed

---

## 🔍 Investigation Trail

### 1. Frontend Event Listeners (web/js/extension.js)

**File:** `web/js/extension.js`

#### tool_request Event Handler (Line 94-124)
```javascript
wsClient.on('tool_request', async (message) => {
    console.log("[FL_JS] ⚡ TOOL REQUEST EVENT FIRED:", message.tool_name, 'request_id:', message.request_id);

    const toolConfig = getToolConfig(message.tool_name);

    // Add tool to breadcrumb chain in chat
    try {
        window.FL_JS?.chatUI?.startToolInChain(
            message.tool_name,
            toolConfig.icon,
            toolConfig.label
        );
    } catch (error) {
        console.warn('[FL_JS] Could not start tool in breadcrumb chain:', error);
    }

    // Execute tool via toolExecutor
    try {
        await toolExecutor.executeToolRequest(message);
        // ...
    }
});
```

**✅ This handler exists and should show breadcrumb**  
**❌ Does NOT call `toolActivity.showTool()`** - Only breadcrumb chain!

#### tool_report Event Handler (Line 127-156)
```javascript
wsClient.on('tool_report', (message) => {
    console.log("[FL_JS] 📊 TOOL REPORT EVENT FIRED:", message.tool_name);

    const toolConfig = getToolConfig(message.tool_name);

    // Show tool activity in floating card
    try {
        const reportId = `report-${Date.now()}-${Math.random()}`;
        window.FL_JS?.chatUI?.toolActivity?.showTool(
            message.tool_name,
            reportId
        );

        // Auto-hide after 3 seconds for Python-only tools
        setTimeout(() => {
            window.FL_JS?.chatUI?.toolActivity?.hideTool(reportId);
        }, 3000);
    } catch (error) {
        console.warn('[FL_JS] Could not show tool report:', error);
    }
    // ...
});
```

**✅ This handler DOES call `toolActivity.showTool()`**  
**❓ But only for `tool_report` messages, not `tool_request`**

---

### 2. Backend Message Routing (backend/server.py)

#### WebSocket Message Handler (Line 316-322)
```python
elif msg_type == "tool_request":
    # Tool request from MCP subprocess - route to frontend
    await route_tool_request_to_frontend(session_id, data)
                
elif msg_type == "tool_report":
    # Tool activity report from MCP subprocess - route to frontend
    await route_tool_report_to_frontend(session_id, data)
```

**✅ Both message types are handled**

#### route_tool_request_to_frontend (Line 792-829)
```python
async def route_tool_request_to_frontend(session_id: str, data: dict) -> None:
    """Route tool request from MCP subprocess to frontend."""
    try:
        logger.info(
            f"Routing tool request to frontend: session={session_id}, "
            f"tool={data.get('tool_name')}, request_id={data.get('request_id')}"
        )
        
        # Check if frontend is connected
        if not manager.has_connection(session_id, 'frontend'):
            error_msg = f"No frontend connection for session {session_id}"
            logger.error(error_msg)
            # ...
            return
        
        # Forward the message to frontend and check result
        result = await manager.send_message(session_id, data, target='frontend')
        # ...
```

**🔴 PROBLEM IDENTIFIED: `target='frontend'`**

#### route_tool_report_to_frontend (Line 847-873)
```python
async def route_tool_report_to_frontend(session_id: str, data: dict) -> None:
    """Route tool activity report from MCP subprocess to frontend."""
    try:
        # ...
        # Forward the message to frontend
        result = await manager.send_message(session_id, data, target='frontend')
```

**🔴 PROBLEM IDENTIFIED: `target='frontend'`**

---

### 3. Connection Manager Routing (backend/manager.py)

#### send_message Method (Line 243-283)
```python
async def send_message(
    self, session_id: str, message: Dict, target: str = 'frontend'
) -> bool:
    """Send a message to a specific session connection.

    Args:
        session_id: Target session ID
        message: Message dict to send
        target: Target connection type ('frontend', 'pwa', 'mcp', or 'all')

    Returns:
        True if message was sent to at least one connection, False otherwise
    """
    if session_id not in self.active_connections:
        logger.warning(f"Cannot send message: session {session_id} not connected")
        return False

    connections = self.active_connections[session_id]
    
    # Log what connections are available and what we're targeting
    logger.debug(f"[SEND] {message.get('type', 'unknown')} -> {target} | available: {list(connections.keys())} | session: {session_id[:8]}...")
    
    # Determine which connections to send to
    if target == 'all':
        targets = list(connections.values())
    else:
        targets = [connections.get(target)] if target in connections else []
    
    if not targets:
        logger.warning(f"Cannot send message: no {target} connection for session {session_id}")
        return False
```

**🔴 ROOT CAUSE IDENTIFIED:**

1. **tool_request** and **tool_report** messages are sent with `target='frontend'`
2. PWA connects with `connection_type='pwa'`
3. `send_message` only sends to the specified target
4. **PWA never receives these messages!**

---

## 💊 Root Cause

### Message Flow Problem:

```
MCP Server (agent running)
  ↓
  tool_request message
  ↓
backend/server.py: route_tool_request_to_frontend()
  ↓
  manager.send_message(session_id, data, target='frontend')  ← PROBLEM!
  ↓
backend/manager.py: send_message()
  ↓
  Only sends to 'frontend' connection
  ↓
  PWA connection is 'pwa', not 'frontend'
  ↓
  ❌ PWA never receives message
  ↓
  ❌ No tool activity displayed
```

### Connection Type Detection:

**File:** `backend/server.py` (Line 229-239)
```python
# Detect connection type from client_version
if handshake.client_version:
    version_lower = handshake.client_version.lower()
    if 'mcp' in version_lower:
        connection_type = 'mcp'
    elif 'pwa' in version_lower:
        connection_type = 'pwa'
    else:
        connection_type = 'frontend'
else:
    connection_type = 'frontend'
```

**PWA identifies itself with `client_version` containing 'pwa'**  
**So PWA connection is registered as `connection_type='pwa'`**

---

## ✅ Solution

### Option 1: Broadcast to Both Frontend and PWA (RECOMMENDED)

Modify `route_tool_request_to_frontend` and `route_tool_report_to_frontend` to send to both:

```python
async def route_tool_request_to_frontend(session_id: str, data: dict) -> None:
    """Route tool request from MCP subprocess to frontend and PWA."""
    try:
        logger.info(
            f"Routing tool request: session={session_id}, "
            f"tool={data.get('tool_name')}, request_id={data.get('request_id')}"
        )
        
        # Send to all relevant connections (frontend and pwa)
        sent_to_any = False
        
        # Try frontend first (required for tool execution)
        if manager.has_connection(session_id, 'frontend'):
            result = await manager.send_message(session_id, data, target='frontend')
            if result:
                logger.info(f"✅ Tool request sent to frontend")
                sent_to_any = True
        else:
            error_msg = f"No frontend connection for session {session_id}"
            logger.error(error_msg)
            # Send error to MCP
            await manager.send_message(session_id, {
                'type': 'tool_result',
                'session_id': session_id,
                'request_id': data.get('request_id'),
                'success': False,
                'error': error_msg,
                'execution_time_ms': 0,
            }, target='mcp')
            return
        
        # Also send to PWA for visualization
        if manager.has_connection(session_id, 'pwa'):
            result = await manager.send_message(session_id, data, target='pwa')
            if result:
                logger.info(f"✅ Tool request sent to PWA for visualization")
        
        if not sent_to_any:
            logger.error(f"❌ Failed to send tool request to any connection")
        
    except Exception as e:
        logger.error(f"Error routing tool request: {e}", exc_info=True)
        # ... error handling
```

**Same pattern for `route_tool_report_to_frontend`**

---

### Option 2: Use Broadcast Helper Method

Add helper method to manager:

```python
async def broadcast_to_session(self, session_id: str, message: Dict, targets: List[str] = None) -> bool:
    """Broadcast message to multiple connection types in a session.
    
    Args:
        session_id: Session ID
        message: Message to send
        targets: List of connection types (defaults to ['frontend', 'pwa'])
        
    Returns:
        True if sent to at least one connection
    """
    if targets is None:
        targets = ['frontend', 'pwa']
    
    sent_to_any = False
    for target in targets:
        if self.has_connection(session_id, target):
            result = await self.send_message(session_id, message, target=target)
            if result:
                sent_to_any = True
    
    return sent_to_any
```

Then use in routing functions:

```python
async def route_tool_request_to_frontend(session_id: str, data: dict) -> None:
    """Route tool request to frontend and PWA."""
    # Ensure frontend connection exists (required for execution)
    if not manager.has_connection(session_id, 'frontend'):
        # ... error handling
        return
    
    # Broadcast to both frontend and PWA
    await manager.broadcast_to_session(session_id, data, targets=['frontend', 'pwa'])
```

---

### Option 3: Default to Broadcast in Session (SIMPLEST)

Change the default behavior of tool messages to broadcast within a session:

**In `route_tool_request_to_frontend`:**
```python
# Instead of:
result = await manager.send_message(session_id, data, target='frontend')

# Use:
result = await manager.send_message(session_id, data, target='all')
```

**This sends to ALL connections in the session (frontend, pwa, mcp)**

**Pros:**
- Simplest change
- Ensures all clients see tool activity
- No need for new methods

**Cons:**
- Might send unnecessary messages (e.g., to MCP)
- Less granular control

---

## 📝 Recommended Fix

### Step 1: Update route_tool_request_to_frontend

**File:** `backend/server.py` (Line 792)

```python
async def route_tool_request_to_frontend(session_id: str, data: dict) -> None:
    """Route tool request from MCP subprocess to frontend and PWA.
    
    Args:
        session_id: Session ID
        data: Tool request data
    """
    try:
        logger.info(
            f"Routing tool request: session={session_id}, "
            f"tool={data.get('tool_name')}, request_id={data.get('request_id')}"
        )
        
        # Check if frontend is connected (required for execution)
        if not manager.has_connection(session_id, 'frontend'):
            error_msg = f"No frontend connection for session {session_id}"
            logger.error(error_msg)
            
            # Send error back to MCP subprocess
            await manager.send_message(session_id, {
                'type': 'tool_result',
                'session_id': session_id,
                'request_id': data.get('request_id'),
                'success': False,
                'error': error_msg,
                'execution_time_ms': 0,
            }, target='mcp')
            return
        
        # Broadcast to both frontend (for execution) and PWA (for visualization)
        # Using target='all' sends to all connections in the session
        result = await manager.send_message(session_id, data, target='all')
        
        if result:
            logger.info(f"✅ Tool request broadcasted to session {session_id}")
        else:
            logger.error(f"❌ Failed to broadcast tool request to session {session_id}")
        
    except Exception as e:
        logger.error(f"Error routing tool request: {e}", exc_info=True)
        
        # Send error back to MCP subprocess
        try:
            await manager.send_message(session_id, {
                'type': 'tool_result',
                'session_id': session_id,
                'request_id': data.get('request_id'),
                'success': False,
                'error': str(e),
                'execution_time_ms': 0,
            }, target='mcp')
        except Exception as send_error:
            logger.error(f"Failed to send error response: {send_error}")
```

### Step 2: Update route_tool_report_to_frontend

**File:** `backend/server.py` (Line 847)

```python
async def route_tool_report_to_frontend(session_id: str, data: dict) -> None:
    """Route tool activity report from MCP subprocess to frontend and PWA.
    
    Tool reports are lightweight notifications that a Python-executed tool
    is running. They don't require a response like tool_request does.
    
    Args:
        session_id: Session ID
        data: Tool report data containing tool_name and timestamp
    """
    try:
        logger.debug(
            f"Routing tool report: session={session_id}, "
            f"tool={data.get('tool_name')}"
        )
        
        # Broadcast to all connections in session (frontend and PWA)
        result = await manager.send_message(session_id, data, target='all')
        
        if result:
            logger.debug(f"✅ Tool report broadcasted to session {session_id}")
        else:
            logger.warning(f"❌ Failed to broadcast tool report to session {session_id}")
        
    except Exception as e:
        logger.error(f"Error routing tool report: {e}", exc_info=True)
```

---

## 🧪 Testing Plan

### 1. Verify Connection Types

**Check logs when PWA connects:**
```
[INFO] Detected connection type: pwa
[INFO] Session abc123 - pwa connected
```

### 2. Verify Message Routing

**Check logs when agent uses a tool:**
```
[INFO] Routing tool request: session=abc123, tool=query_workflow, request_id=xyz789
[SEND] tool_request -> all | available: ['frontend', 'pwa'] | session: abc123...
[SEND] ✅ Sent tool_request to frontend
[SEND] ✅ Sent tool_request to pwa
[INFO] ✅ Tool request broadcasted to session abc123
```

### 3. Verify Frontend Reception

**Check browser console in PWA:**
```
[FL_JS] ⚡ TOOL REQUEST EVENT FIRED: query_workflow request_id: xyz789
[ToolActivity] Showing tool: query_workflow (xyz789)
```

### 4. Visual Verification

- Open PWA in browser
- Connect to session with ComfyUI frontend
- Send message to agent that triggers tool use
- **Expected:** Floating tool activity card appears in PWA
- **Expected:** Breadcrumb chain shows tool execution

---

## 📊 Impact Analysis

### Files to Modify:
1. `backend/server.py` - Update routing functions (2 functions)

### Breaking Changes:
None - this is a bug fix

### Performance Impact:
Minimal - just sends additional message copies to PWA connections

### Backward Compatibility:
✅ Fully compatible - only adds message delivery, doesn't change protocol

---

## 🔗 Related Issues

- PWA not receiving `agent_response` messages? (Check if similar issue)
- Breadcrumb chain working? (Uses same event listeners)
- MCP connection receiving unnecessary messages? (Consider filtering)

---

**Analysis Complete:** 2025-10-21  
**Ready to Implement:** ✅ Yes  
**Estimated Fix Time:** 5 minutes