# Tool Execution Implementation Investigation

**Date:** 2025-10-15  
**Project:** fl_js  
**Goal:** Enable MCP server subprocess to execute tools via WebSocket callbacks to frontend

---

## Problem Statement

The MCP server runs as a subprocess (via `MCPServerStdio`) and needs to:
1. Know which session it's serving
2. Establish WebSocket connection to backend
3. Send tool execution requests to frontend
4. Receive tool results back
5. Return results to the agent

**Key Constraint:** MCP server is a separate process with no shared memory.

---

## Solution Design

### Approach: Environment-Based Session Passing + Subprocess WebSocket Client

#### Overview

Pass the session ID to the MCP subprocess via environment variables, then have the MCP server establish its own WebSocket connection back to the backend server to send/receive tool execution messages.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Backend Server Process                                      │
│                                                             │
│  ┌──────────────┐         ┌─────────────────┐            │
│  │ FastAPI      │◄────────┤ ConnectionManager│            │
│  │ /ws endpoint │         │ (manager)        │            │
│  └──────────────┘         └─────────────────┘            │
│         ▲                                                  │
│         │ WebSocket                                        │
│         │                                                  │
└─────────┼──────────────────────────────────────────────────┘
          │
          │
          ├─────────────────────────────────────┐
          │                                     │
          │                                     │
  ┌───────▼───────┐                   ┌────────▼────────┐
  │ Frontend      │                   │ MCP Subprocess  │
  │ (ComfyUI)     │                   │                 │
  │               │                   │ ┌─────────────┐ │
  │ ┌───────────┐ │                   │ │ WS Client   │ │
  │ │ WSClient  │ │                   │ │ (to backend)│ │
  │ └───────────┘ │                   │ └─────────────┘ │
  │ ┌───────────┐ │                   │ ┌─────────────┐ │
  │ │ToolExecutor│ │                   │ │ MCP Tools   │ │
  │ └───────────┘ │                   │ └─────────────┘ │
  └───────────────┘                   └─────────────────┘
       session_A                           session_A
```

#### Key Changes Required

### 1. Modify Agent Initialization (`backend/agent.py`)

**Current:**
```python
mcp_servers = [MCPServerStdio('python', ['backend/mcp_server.py'])]
```

**Modified:**
```python
def create_agent(session_id: str) -> Agent:
    # ...
    
    # Prepare environment for MCP subprocess
    mcp_env = {
        'FL_SESSION_ID': session_id,
        'FL_WS_URL': f'ws://{settings.ws_host}:{settings.ws_port}/ws',
        'FL_MCP_MODE': 'subprocess',  # Flag to indicate subprocess mode
    }
    
    # Launch MCP server with environment
    mcp_servers = [
        MCPServerStdio(
            'python',
            ['backend/mcp_server.py'],
            env=mcp_env  # Pass environment to subprocess
        )
    ]
    
    agent = Agent(
        model=model,
        system_prompt=system_prompt,
        retries=settings.max_tool_retries,
        mcp_servers=mcp_servers,
    )
    # ...
```

**Key Points:**
- Pass `session_id` via `FL_SESSION_ID` environment variable
- Pass WebSocket URL via `FL_WS_URL` environment variable
- Use `FL_MCP_MODE` to distinguish subprocess from direct execution

### 2. Add WebSocket Client to MCP Server (`backend/mcp_server.py`)

**New Imports:**
```python
import os
import asyncio
import websockets
import json
import uuid
from contextlib import asynccontextmanager
```

**Add MCPWebSocketClient Class:**
```python
class MCPWebSocketClient:
    """WebSocket client for MCP subprocess to communicate with backend."""
    
    def __init__(self, session_id: str, ws_url: str):
        self.session_id = session_id
        self.ws_url = ws_url
        self.ws = None
        self.pending_requests = {}  # request_id -> asyncio.Future
        self.connected = False
        self._receive_task = None
        
    async def connect(self):
        """Connect to backend WebSocket server."""
        logger.info(f"[MCP-WS] Connecting to {self.ws_url} with session {self.session_id}")
        
        try:
            self.ws = await websockets.connect(self.ws_url)
            
            # Send handshake
            await self.ws.send(json.dumps({
                'type': 'handshake',
                'session_id': self.session_id,
                'client_version': '1.0.0-mcp',
            }))
            
            # Wait for handshake ack
            response = await self.ws.recv()
            data = json.loads(response)
            
            if data.get('type') == 'handshake_ack':
                self.connected = True
                logger.info(f"[MCP-WS] Connected and handshake complete")
                
                # Start receive loop
                self._receive_task = asyncio.create_task(self._receive_loop())
            else:
                raise RuntimeError(f"Unexpected handshake response: {data}")
                
        except Exception as e:
            logger.error(f"[MCP-WS] Connection failed: {e}")
            raise
    
    async def _receive_loop(self):
        """Receive and process messages from backend."""
        try:
            async for message in self.ws:
                data = json.loads(message)
                await self._handle_message(data)
        except Exception as e:
            logger.error(f"[MCP-WS] Receive loop error: {e}")
            self.connected = False
    
    async def _handle_message(self, data: dict):
        """Handle incoming message from backend."""
        msg_type = data.get('type')
        
        if msg_type == 'tool_result':
            # Tool execution result from frontend
            request_id = data.get('request_id')
            future = self.pending_requests.get(request_id)
            
            if future and not future.done():
                if data.get('success'):
                    future.set_result(data.get('data'))
                else:
                    future.set_exception(
                        RuntimeError(data.get('error', 'Tool execution failed'))
                    )
                # Clean up
                self.pending_requests.pop(request_id, None)
        else:
            logger.warning(f"[MCP-WS] Unexpected message type: {msg_type}")
    
    async def execute_tool(self, tool_name: str, parameters: dict, timeout_ms: int = 30000) -> dict:
        """Execute a tool via WebSocket callback."""
        if not self.connected:
            raise RuntimeError("WebSocket not connected")
        
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        
        # Create future for this request
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[request_id] = future
        
        logger.info(f"[MCP-WS] Executing tool: {tool_name} (request_id: {request_id})")
        
        try:
            # Send tool request
            await self.ws.send(json.dumps({
                'type': 'tool_request',
                'session_id': self.session_id,
                'request_id': request_id,
                'tool_name': tool_name,
                'parameters': parameters,
                'timeout_ms': timeout_ms,
            }))
            
            # Wait for result with timeout
            timeout_seconds = timeout_ms / 1000.0
            result = await asyncio.wait_for(future, timeout=timeout_seconds)
            
            logger.info(f"[MCP-WS] Tool execution complete: {request_id}")
            return result
            
        except asyncio.TimeoutError:
            logger.error(f"[MCP-WS] Tool execution timeout: {request_id}")
            self.pending_requests.pop(request_id, None)
            raise RuntimeError(f"Tool execution timeout after {timeout_seconds}s")
        except Exception as e:
            logger.error(f"[MCP-WS] Tool execution error: {e}")
            self.pending_requests.pop(request_id, None)
            raise
    
    async def disconnect(self):
        """Disconnect from WebSocket server."""
        if self._receive_task:
            self._receive_task.cancel()
        if self.ws:
            await self.ws.close()
        self.connected = False
        logger.info("[MCP-WS] Disconnected")
```

**Add Lifespan Management:**
```python
# Global WebSocket client for this MCP subprocess
_ws_client: Optional[MCPWebSocketClient] = None

@asynccontextmanager
async def mcp_lifespan():
    """Manage MCP server lifespan and WebSocket connection."""
    global _ws_client
    
    # Check if running in subprocess mode
    if os.getenv('FL_MCP_MODE') == 'subprocess':
        session_id = os.getenv('FL_SESSION_ID')
        ws_url = os.getenv('FL_WS_URL')
        
        if not session_id or not ws_url:
            logger.error("Missing FL_SESSION_ID or FL_WS_URL environment variables")
            raise RuntimeError("MCP subprocess not properly configured")
        
        logger.info(f"[MCP] Starting in subprocess mode for session: {session_id}")
        
        # Create and connect WebSocket client
        _ws_client = MCPWebSocketClient(session_id, ws_url)
        await _ws_client.connect()
        
        logger.info("[MCP] WebSocket client connected")
    else:
        logger.info("[MCP] Running in standalone mode (no WebSocket)")
    
    yield
    
    # Cleanup
    if _ws_client:
        await _ws_client.disconnect()
        logger.info("[MCP] WebSocket client disconnected")
```

**Update FastMCP Initialization:**
```python
# Initialize FastMCP server with lifespan
mcp = FastMCP("FL_Agent Workflow Tools", lifespan=mcp_lifespan)
```

**Update _execute_tool Function:**
```python
async def _execute_tool(tool_name: str, parameters: Dict[str, Any], timeout_ms: Optional[int] = None) -> Dict[str, Any]:
    """Execute a tool via WebSocket callback.
    
    Args:
        tool_name: Name of the tool to execute
        parameters: Tool parameters
        timeout_ms: Optional timeout in milliseconds
        
    Returns:
        Tool execution result
        
    Raises:
        RuntimeError: If WebSocket client not initialized
    """
    if _ws_client is None:
        raise RuntimeError("WebSocket client not initialized. MCP server not running in subprocess mode.")
    
    return await _ws_client.execute_tool(
        tool_name=tool_name,
        parameters=parameters,
        timeout_ms=timeout_ms or 30000
    )
```

### 3. Update Backend Server Message Routing (`backend/server.py`)

**Modify WebSocket Handler:**

The current implementation already handles `tool_request` messages, but we need to ensure they're routed correctly when coming from the MCP subprocess.

**Add to message routing:**
```python
# In websocket_endpoint function, add to message routing:

elif msg_type == "tool_request":
    # Tool request from MCP subprocess - route to frontend
    await route_tool_request_to_frontend(session_id, data)
```

**Add routing function:**
```python
async def route_tool_request_to_frontend(session_id: str, data: dict) -> None:
    """Route tool request from MCP subprocess to frontend.
    
    Args:
        session_id: Session ID
        data: Tool request data
    """
    try:
        # The frontend is connected to the same session
        # Just forward the message
        await manager.send_message(session_id, data)
        logger.info(f"[Server] Routed tool request to frontend: {data.get('tool_name')}")
    except Exception as e:
        logger.error(f"[Server] Error routing tool request: {e}")
        # Send error back to MCP subprocess
        await manager.send_message(session_id, {
            'type': 'tool_result',
            'session_id': session_id,
            'request_id': data.get('request_id'),
            'success': False,
            'error': str(e),
            'execution_time_ms': 0,
        })
```

### 4. Update Connection Manager (`backend/manager.py`)

**Current Issue:** The ConnectionManager assumes one WebSocket per session, but now we'll have TWO:
1. Frontend WebSocket (ComfyUI)
2. MCP subprocess WebSocket

**Solution:** Track connection types.

**Modify ConnectionManager:**
```python
class ConnectionManager:
    """Manages WebSocket connections with session-based routing."""

    def __init__(self, session_timeout_seconds: int = 300):
        # Map session_id -> dict of connection types
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # session_id -> {'frontend': WebSocket, 'mcp': WebSocket}
        
        # Map session_id -> SessionContext
        self.session_contexts: Dict[str, SessionContext] = {}
        # Session timeout
        self.session_timeout = timedelta(seconds=session_timeout_seconds)

    async def connect(
        self, websocket: WebSocket, session_id: str, connection_type: str = 'frontend'
    ) -> SessionContext:
        """Register a new WebSocket connection.

        Args:
            websocket: WebSocket connection
            session_id: Session ID from client
            connection_type: Type of connection ('frontend' or 'mcp')

        Returns:
            SessionContext for this session
        """
        # Initialize session connections dict if needed
        if session_id not in self.active_connections:
            self.active_connections[session_id] = {}
        
        # Store connection by type
        self.active_connections[session_id][connection_type] = websocket

        # Get or create session context
        if session_id in self.session_contexts:
            context = self.session_contexts[session_id]
            context.last_activity = datetime.now()
            logger.info(f"Session {session_id} - {connection_type} connected")
        else:
            context = SessionContext(session_id=session_id)
            self.session_contexts[session_id] = context
            logger.info(f"New session {session_id} created with {connection_type} connection")

        return context

    def disconnect(self, session_id: str, connection_type: str = 'frontend') -> None:
        """Disconnect a WebSocket connection.

        Args:
            session_id: Session ID to disconnect
            connection_type: Type of connection to disconnect
        """
        if session_id in self.active_connections:
            if connection_type in self.active_connections[session_id]:
                del self.active_connections[session_id][connection_type]
                logger.info(f"Session {session_id} - {connection_type} disconnected")
            
            # Clean up session entry if no more connections
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def send_message(
        self, session_id: str, message: Dict, target: str = 'frontend'
    ) -> bool:
        """Send a message to a specific session connection.

        Args:
            session_id: Target session ID
            message: Message dict to send
            target: Target connection type ('frontend', 'mcp', or 'all')

        Returns:
            True if message was sent, False if session not connected
        """
        if session_id not in self.active_connections:
            logger.warning(f"Cannot send message: session {session_id} not connected")
            return False

        connections = self.active_connections[session_id]
        
        # Determine which connections to send to
        if target == 'all':
            targets = connections.values()
        else:
            targets = [connections.get(target)] if target in connections else []
        
        sent = False
        for websocket in targets:
            if websocket:
                try:
                    await websocket.send_json(message)
                    sent = True
                except Exception as e:
                    logger.error(f"Error sending message to {session_id}: {e}")
        
        if sent and session_id in self.session_contexts:
            self.session_contexts[session_id].last_activity = datetime.now()
        
        return sent
```

**Update Handshake Detection:**

In `backend/server.py`, detect connection type from handshake:

```python
# In websocket_endpoint, after parsing handshake:
connection_type = 'mcp' if handshake.client_version and 'mcp' in handshake.client_version else 'frontend'

# Register connection with type
context = await manager.connect(websocket, session_id, connection_type)
```

---

## Implementation Checklist

### Phase 1: Basic Infrastructure
- [ ] Modify `backend/agent.py` to pass environment variables to MCP subprocess
- [ ] Add `MCPWebSocketClient` class to `backend/mcp_server.py`
- [ ] Add lifespan management to `backend/mcp_server.py`
- [ ] Update `_execute_tool()` to use WebSocket client

### Phase 2: Connection Management
- [ ] Modify `backend/manager.py` to support multiple connection types per session
- [ ] Update `connect()` method to accept connection_type
- [ ] Update `disconnect()` method to handle connection_type
- [ ] Update `send_message()` to support targeted sending

### Phase 3: Message Routing
- [ ] Add connection type detection in `backend/server.py` handshake
- [ ] Add `route_tool_request_to_frontend()` function
- [ ] Update message routing to handle tool_request from MCP subprocess
- [ ] Ensure tool_result messages route to correct connection

### Phase 4: Testing
- [ ] Test MCP subprocess startup with environment variables
- [ ] Test WebSocket connection from MCP subprocess
- [ ] Test tool execution flow: MCP → Backend → Frontend → Backend → MCP
- [ ] Test error handling and timeouts
- [ ] Test reconnection scenarios
- [ ] Test multiple concurrent sessions

---

## Alternative Approaches Considered

### 1. Shared Memory / IPC
**Rejected:** Too complex, platform-dependent, doesn't solve the fundamental isolation issue.

### 2. HTTP Callbacks
**Rejected:** Adds unnecessary HTTP server complexity, WebSocket already available.

### 3. Direct stdio Communication
**Rejected:** MCP protocol already uses stdio, mixing protocols would be confusing.

### 4. Parent Process Tool Execution
**Rejected:** Would require rewriting MCP server to run in-process, defeats purpose of MCP isolation.

---

## Benefits of Chosen Approach

1. **Clean Separation:** MCP subprocess remains isolated, communicates via standard WebSocket protocol
2. **Reuses Infrastructure:** Leverages existing WebSocket server and message routing
3. **Scalable:** Can support multiple MCP subprocesses per session if needed
4. **Debuggable:** WebSocket messages can be logged and inspected
5. **Flexible:** Easy to add new message types or modify protocol
6. **Testable:** Can test MCP subprocess independently by simulating WebSocket messages

---

## Potential Issues & Mitigations

### Issue 1: WebSocket Connection Overhead
**Mitigation:** Connection is persistent, minimal overhead after initial setup.

### Issue 2: Message Routing Complexity
**Mitigation:** Clear message type discrimination ('frontend' vs 'mcp' client_version).

### Issue 3: Race Conditions
**Mitigation:** Use asyncio.Future for request/response pairing, timeout handling.

### Issue 4: Connection Failures
**Mitigation:** Implement retry logic in MCPWebSocketClient, graceful degradation.

### Issue 5: Session Cleanup
**Mitigation:** Track both connections, only cleanup session when both disconnect.

---

## Next Steps

1. Review this design with user for approval
2. Implement Phase 1 (Basic Infrastructure)
3. Test basic connectivity
4. Implement Phase 2 (Connection Management)
5. Implement Phase 3 (Message Routing)
6. Comprehensive testing (Phase 4)
7. Documentation and examples

---

## References

- **Related Files:**
  - `backend/agent.py` - Agent initialization
  - `backend/mcp_server.py` - MCP server and tools
  - `backend/server.py` - WebSocket endpoint and routing
  - `backend/manager.py` - Connection management
  - `backend/callback_router.py` - Tool callback routing (may become obsolete)
  - `web/js/ws_client.js` - Frontend WebSocket client
  - `web/js/tool_executor.js` - Frontend tool execution

- **Key Concepts:**
  - MCP (Model Context Protocol)
  - WebSocket bidirectional communication
  - Process isolation and IPC
  - asyncio Future-based callbacks
