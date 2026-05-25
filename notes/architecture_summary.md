## **Project Overview: Ren - ComfyUI AI Assistant** 🌸

### **High-Level Architecture**

Ren is a sophisticated multi-tier AI assistant for ComfyUI that enables natural language control over image generation workflows. The architecture consists of:

1. **Python Backend** (FastAPI + PydanticAI + FastMCP)
2. **JavaScript Frontend** (ComfyUI extension)
3. **Progressive Web App** (Mobile access)
4. **MCP Subprocess** (Tool execution isolation)

### **Key Architectural Components** (21 total)

#### **Backend Layer** (Python)
- **backend_server** - FastAPI WebSocket server orchestrating everything
- **agent_system** - PydanticAI agent with conversation management
- **mcp_server** - FastMCP subprocess providing 45+ workflow tools
- **session_manager** - Multi-client session tracking (frontend/pwa/mcp)
- **callback_router** - Legacy tool execution routing
- **comfy_tools** - Filesystem access (custom nodes, models, outputs)
- **node_library** - Node type discovery via ComfyUI API
- **comfy_manager** - Integration with ComfyUI Manager for pack/model search
- **config_system** - Provider-specific LLM tuning (Gemini/Claude/OpenAI/OpenRouter)
- **server_runner** - Auto-start backend when ComfyUI loads

#### **Frontend Layer** (JavaScript)
- **frontend_extension** - Main ComfyUI extension coordinator
- **websocket_client** - WebSocket with event emitter and reconnection
- **fl_api** - Clean wrapper around workflow manipulation functions
- **tool_executor** - Executes backend tool requests using FL_API
- **chat_ui** - Chat interface with markdown, breadcrumbs, Ren links
- **session_manager_frontend** - localStorage-based session IDs
- **query_executor** - Client-side workflow query DSL
- **diagram_generator** - Mermaid diagram generation

#### **Other Components**
- **pwa_app** - Mobile Progressive Web App
- **comfyui_extension** - Entry point (__init__.py) that triggers auto-start
- **legacy_fl_js** - Original implementation (still used for some tools)

### **Critical Relationships** (12 hyperedges mapped)

The most interesting architectural pattern is the **MCP subprocess isolation**:

```
User Message → Backend → Agent → MCP Subprocess (tools)
                                      ↓
                                  tool_request
                                      ↓
                    Backend routes to Frontend
                                      ↓
                              FL_API executes
                                      ↓
                              tool_result back
```

This allows Python tools to execute in an isolated subprocess while JavaScript tools execute in the browser, all coordinated through WebSocket messaging.

### **Multi-Client Architecture**

The system supports **simultaneous connections**:
- **Frontend** (ComfyUI sidebar) - Primary interface
- **PWA** (mobile) - Can join existing sessions
- **MCP** (subprocess) - Internal tool execution channel

All share the same conversation history per session!

### **Provider-Specific Optimizations**

The config system automatically tunes behavior for each LLM provider:
- **Gemini**: Reduced history (16 msgs), compressed tool results
- **Claude**: Extended context (50 msgs, 4000 chars/result)
- **OpenAI/OpenRouter**: Balanced (36 msgs, 2000 chars/result)