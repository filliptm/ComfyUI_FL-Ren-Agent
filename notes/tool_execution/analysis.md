# Tool Execution Architecture Analysis

**Date:** 2025-10-15  
**Project:** fl_js  
**Focus:** WebSocket-based bidirectional tool execution between MCP server and frontend

---

## Current Architecture Overview

The FL_JS system currently implements a sophisticated WebSocket-based architecture for communication between the backend (Python) and frontend (JavaScript). However, the MCP server's tool execution flow is **incomplete** and needs to be connected to this WebSocket infrastructure.

### Key Components

#### 1. Backend Components

##### `backend/server.py` - FastAPI WebSocket Server
- **Purpose:** Main WebSocket endpoint and message router
- **WebSocket Endpoint:** `/ws`
- **Protocol Flow:**
  1. Client connects
  2. Client sends `handshake` with `session_id`
  3. Server registers session and sends `handshake_ack`
  4. Bidirectional message exchange begins
  5. Client disconnects (session kept alive for reconnection)

- **Message Handlers:**
  - `handle_user_message()` - Processes user chat messages, runs agent
  - `handle_tool_result()` - Receives tool execution results from frontend

- **Key Mechanism:**
  - Uses `current_session_id` ContextVar to track which session is making requests
  - Sets context before running agent: `current_session_id.set(session_id)`
  - Clears context after: `current_session_id.set(None)`

##### `backend/manager.py` - ConnectionManager
- **Purpose:** Manages WebSocket connections with session-based routing
- **Key Data Structures:**
  - `active_connections: Dict[str, WebSocket]` - Maps session_id → WebSocket
  - `session_contexts: Dict[str, SessionContext]` - Maps session_id → SessionContext
  - `session_agents: Dict[str, Any]` - Maps session_id → Agent instance

- **Key Methods:**
  - `connect(websocket, session_id)` - Register new connection
  - `disconnect(session_id)` - Disconnect session
  - `send_message(session_id, message)` - Send message to specific session

##### `backend/callback_router.py` - CallbackRouter
- **Purpose:** Routes tool execution requests between MCP server and WebSocket clients
- **Key Mechanism:**
  - Maintains `pending_callbacks: Dict[str, asyncio.Future]`
  - Each tool request gets a unique `request_id` with a Future
  - Sends tool request via WebSocket to frontend
  - Waits for response with timeout
  - Resolves/rejects Future when response arrives

- **Key Methods:**
  - `execute_tool_callback(tool_name, parameters, timeout_ms)` - Execute tool via callback
  - `handle_tool_result(request_id, success, data, error, execution_time_ms)` - Handle result from frontend

- **Critical Detail:**
  - Uses `current_session_id` ContextVar to determine which session to send requests to
  - **Problem:** This ContextVar is set in `server.py` during user message handling, but NOT available inside MCP server subprocess!

##### `backend/agent.py` - Agent Management
- **Purpose:** Creates and manages PydanticAI agents per session
- **Agent Creation:**
  ```python
  mcp_servers = [MCPServerStdio('python', ['backend/mcp_server.py'])]
  agent = Agent(
      model=model,
      system_prompt=system_prompt,
      retries=settings.max_tool_retries,
      mcp_servers=mcp_servers,
  )
  ```

- **Key Issue:**
  - MCP server is launched as subprocess via `MCPServerStdio`
  - Subprocess has NO access to parent process's ContextVars
  - Subprocess has NO access to WebSocket connections
  - **This is the core problem to solve**

##### `backend/mcp_server.py` - MCP Server
- **Purpose:** Defines all tools available to AI agent
- **Tool Execution Flow:**
  ```python
  async def _execute_tool(tool_name, parameters, timeout_ms):
      if _callback_router is None:
          raise RuntimeError("Callback router not initialized")
      return await _callback_router.execute_tool_callback(
          tool_name=tool_name,
          parameters=parameters,
          timeout_ms=timeout_ms
      )
  ```

- **Initialization:**
  - `set_callback_router(router)` - Called during server startup
  - Sets global `_callback_router` variable

- **Current Problem:**
  - `_callback_router` is set in parent process
  - But MCP server runs in subprocess
  - **The callback router is NOT available in subprocess!**

#### 2. Frontend Components

##### `web/js/ws_client.js` - WebSocket Client
- **Purpose:** WebSocket client with session management
- **Features:**
  - Session-based connection with handshake protocol
  - Automatic reconnection with exponential backoff
  - Message queueing during disconnection
  - Event-driven architecture (EventEmitter)

- **Key Events:**
  - `'connected'` - WebSocket connected
  - `'agent_response'` - Received agent response
  - `'tool_request'` - Received tool execution request
  - `'typing_indicator'` - Agent typing status
  - `'error'` - Error message

- **Key Methods:**
  - `send(message)` - Send message to server
  - `sendUserMessage(content)` - Send user message
  - `sendToolResult(requestId, success, data, error, executionTimeMs)` - Send tool result

##### `web/js/tool_executor.js` - ToolExecutor
- **Purpose:** Executes tool requests from backend
- **Mechanism:**
  - Receives `tool_request` message via WebSocket
  - Routes to appropriate handler based on `tool_name`
  - Executes tool via `FL_API` or `QueryExecutor`
  - Sends result back via `wsClient.send({ type: 'tool_result', ... })`

- **Handler Registration:**
  ```javascript
  this.toolHandlers = {
      "query_workflow": this._handleQueryWorkflow.bind(this),
      "create_node": this._handleCreateNode.bind(this),
      // ... 40+ tools
  }
  ```

- **Execution Flow:**
  ```javascript
  async executeToolRequest(message) {
      const { request_id, tool_name, parameters } = message;
      const handler = this.toolHandlers[tool_name];
      const result = await handler(parameters);
      
      await this.wsClient.send({
          type: "tool_result",
          request_id: request_id,
          success: true,
          data: result,
          execution_time_ms: executionTime
      });
  }
  ```

##### `web/js/extension.js` - ComfyUI Extension Entry Point
- **Purpose:** Initializes all components
- **Initialization Flow:**
  1. Generate/retrieve session ID
  2. Create WebSocket client
  3. Create ToolExecutor
  4. Set up event handlers
  5. Connect to backend

- **Tool Request Handling:**
  ```javascript
  wsClient.on('tool_request', (message) => {
      toolExecutor.executeToolRequest(message);
  });
  ```

### Current Message Flow

#### User Message Flow (Working)
```
1. User types message in frontend
   ↓
2. frontend/chat_ui.js → wsClient.sendUserMessage(content)
   ↓
3. WebSocket → backend/server.py websocket_endpoint
   ↓
4. server.py → handle_user_message()
   - Sets current_session_id.set(session_id)
   - Gets/creates agent for session
   - Calls agent.run(message)
   ↓
5. agent runs with MCP tools available
   ↓
6. Response sent back to frontend
```

#### Tool Execution Flow (BROKEN)
```
1. Agent (in parent process) wants to call a tool
   ↓
2. PydanticAI calls MCP server (subprocess)
   ↓
3. MCP server receives tool call
   ↓
4. mcp_server.py → @mcp.tool() → _execute_tool()
   ↓
5. _execute_tool() → _callback_router.execute_tool_callback()
   ↓
6. ❌ PROBLEM: _callback_router is None in subprocess!
   ↓
7. ❌ PROBLEM: Even if router existed, current_session_id is not set!
   ↓
8. ❌ PROBLEM: Subprocess has no access to WebSocket connections!
```

### The Core Problem

The MCP server is launched as a **subprocess** by PydanticAI's `MCPServerStdio`. This means:

1. **Separate Process Space:**
   - MCP server runs in its own Python process
   - Cannot access parent process's memory, variables, or objects
   - Cannot access `current_session_id` ContextVar
   - Cannot access `manager` ConnectionManager instance
   - Cannot access WebSocket connections

2. **Communication Barrier:**
   - MCP protocol uses stdio (stdin/stdout) for communication
   - Only JSON-RPC messages can pass between processes
   - Cannot pass Python objects like WebSocket connections

3. **Current Initialization:**
   - `set_callback_router(router)` is called in parent process
   - MCP subprocess starts fresh with no callback router
   - Tools have no way to communicate with frontend

### What Works vs What Doesn't

#### ✅ Working:
- WebSocket connection between frontend and backend
- Session management and routing
- User message handling
- Agent creation and management
- Frontend tool execution (when triggered by WebSocket)
- Tool result handling (frontend → backend)

#### ❌ Not Working:
- MCP server → Frontend tool execution
- Tool callback routing from subprocess
- Session context in MCP subprocess
- Bidirectional tool communication

---

## Summary

The current architecture has all the pieces for bidirectional WebSocket communication, but the MCP server subprocess is **isolated** from this infrastructure. The `_execute_tool()` function in `backend/mcp_server.py` attempts to use a callback router that doesn't exist in the subprocess context.

**The solution requires:**
1. Passing session information to the MCP subprocess
2. Establishing WebSocket communication FROM the subprocess
3. Managing tool execution callbacks across process boundaries

See `notes/tool_execution/investigation.md` for detailed solution design.
