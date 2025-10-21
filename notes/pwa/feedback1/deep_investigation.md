# PWA Feedback 1 - Deep Investigation

**Date:** 2025-10-21  
**Focus:** Image access, screenshot tool, focus/fit-view functionality, and image serving architecture  
**Status:** 🔍 Deep technical analysis complete

---

## 📝 Executive Summary

This investigation addresses three interconnected features for the PWA:

1. **Image Access** - Serving ComfyUI images to PWA clients
2. **Screenshot Tool** - Capturing canvas state for agent analysis
3. **Focus/Fit View Tool** - Zooming to specific workflow sections

**Key Findings:**
- ComfyUI uses its own `/api/view` endpoint for serving images
- FL_JS backend needs its own image serving endpoint that works for both embedded and PWA clients
- LiteGraph provides `app.canvas.fitNodes()` for viewport control
- Canvas screenshot requires `app.canvas.canvas` element access
- Tool flow: Backend MCP tool → WebSocket → Frontend tool_executor → FL_API method

---

## 🎯 Problem 1: Image Serving Architecture

### Current State (Embedded ComfyUI Frontend)

**From `agents/agent.md`:**
```markdown
![ComfyUI_0023_.png](api/view?filename=ComfyUI_00023_.png&subfolder=&type=output&rand=0.38018754053851234)
```

**How it works currently:**
- Agent generates markdown with `api/view?filename=...` links
- User clicks image in chat
- Browser requests from ComfyUI's API server (port 8188)
- ComfyUI serves image from `output/` or `input/` folder
- **This only works because the frontend is embedded in ComfyUI**

**ComfyUI API endpoint:**
- Endpoint: `GET /view`
- Query params: `filename`, `subfolder`, `type`, `rand`
- Types: `output`, `input`, `temp`
- Serves from ComfyUI installation directories

### Problem with PWA

**PWA connects to FL_JS backend (port 8000), NOT ComfyUI (port 8188):**

```
📱 PWA Client
  ↓
  Connected to: ws://localhost:8000/ws (FL_JS backend)
  ↓
  Receives agent message: "![image.png](api/view?filename=image.png&type=output)"
  ↓
  Browser tries to load: http://localhost:8000/api/view?filename=... ❌ FAILS!
  ↓
  FL_JS backend has no /api/view endpoint
```

**The agent doesn't know which client is viewing the response:**
- Agent generates ONE response
- Response is broadcast to ALL connections (frontend, PWA)
- Image URLs must work for BOTH clients
- But they're on different servers!

### Solution: Context-Aware Image URLs

**Option 1: Backend Image Proxy (RECOMMENDED)**

FL_JS backend serves images through its own endpoint:

```python
# backend/server.py

@app.get("/api/view")
async def view_image(
    filename: str,
    subfolder: str = "",
    type: str = "output",
    rand: float = 0.0  # Cache busting
):
    """Serve ComfyUI images to all clients (frontend and PWA).
    
    This endpoint proxies ComfyUI's image serving, making it accessible
    to both embedded frontend and standalone PWA clients.
    """
    try:
        # Get ComfyUI tools instance
        comfy_tools = get_comfy_tools()
        
        # Validate type
        if type not in ["output", "input", "temp"]:
            raise HTTPException(status_code=400, detail="Invalid type")
        
        # Build path based on type
        if type == "output":
            base_path = comfy_tools.comfyui_root / "output"
        elif type == "input":
            base_path = comfy_tools.comfyui_root / "input"
        elif type == "temp":
            base_path = comfy_tools.comfyui_root / "temp"
        
        # Handle subfolder
        if subfolder:
            file_path = base_path / subfolder / filename
        else:
            file_path = base_path / filename
        
        # Validate path is within allowed directory (security)
        file_path = file_path.resolve()
        if not str(file_path).startswith(str(base_path.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Check file exists
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        
        # Determine media type
        media_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
        }
        media_type = media_types.get(file_path.suffix.lower(), "application/octet-stream")
        
        # Return file
        return FileResponse(
            path=str(file_path),
            media_type=media_type,
            headers={
                "Cache-Control": "no-cache",  # Respect rand parameter
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
```

**Benefits:**
- Agent doesn't need to know client type
- Same markdown works for both frontend and PWA
- Centralized security validation
- Works with existing agent instructions

**Agent instructions remain unchanged:**
```markdown
![image.png](api/view?filename=image.png&type=output&rand=0.123)
```

**How URLs resolve:**

**Embedded Frontend (in ComfyUI):**
```
Base URL: http://localhost:8188/
Image URL: api/view?filename=...
Resolved: http://localhost:8188/api/view?filename=...
✅ Works! (ComfyUI's endpoint)
```

**PWA:**
```
Base URL: http://localhost:8000/
Image URL: api/view?filename=...
Resolved: http://localhost:8000/api/view?filename=...
✅ Works! (FL_JS backend endpoint)
```

**Option 2: Client-Specific URLs (NOT RECOMMENDED)**

Agent generates different URLs based on client type:
- Requires agent to track which clients are connected
- Requires different markdown for different clients
- Breaks broadcast model
- More complex, error-prone

### Implementation: Backend Image Endpoint

**Files to modify:**
1. `backend/server.py` - Add `/api/view` endpoint
2. No agent changes needed (uses existing markdown format)
3. No frontend changes needed (existing behavior preserved)

---

## 🎯 Problem 2: Screenshot Tool Architecture

### Tool Flow Analysis

**Complete tool execution flow:**

```
1. Agent (backend/mcp_server.py)
   ↓
   Calls: await take_screenshot(format="jpeg", quality=0.9)
   ↓
2. MCP Tool Function (backend/mcp_server.py)
   ↓
   Calls: await ctx.deps.callback_router.execute_tool_callback(
            tool_name="take_screenshot",
            parameters={"format": "jpeg", "quality": 0.9}
          )
   ↓
3. Callback Router (backend/callback_router.py)
   ↓
   Sends WebSocket message:
   {
     "type": "tool_request",
     "session_id": "abc123",
     "request_id": "xyz789",
     "tool_name": "take_screenshot",
     "parameters": {"format": "jpeg", "quality": 0.9}
   }
   ↓
4. WebSocket (backend/server.py)
   ↓
   Routes to frontend via manager.send_message()
   ↓
5. Frontend WebSocket (web/js/extension.js)
   ↓
   Event: wsClient.on('tool_request', ...)
   ↓
6. Tool Executor (web/js/tool_executor.js)
   ↓
   Calls: await this._handleTakeScreenshot(parameters)
   ↓
7. FL_API Method (web/js/fl_api.js)
   ↓
   Calls: this.takeScreenshot(format, quality)
   ↓
   Accesses: app.canvas.canvas (HTML canvas element)
   ↓
   Converts: canvas.toBlob() → base64
   ↓
8. Returns to Tool Executor
   ↓
   Sends WebSocket message:
   {
     "type": "tool_result",
     "request_id": "xyz789",
     "success": true,
     "data": {
       "screenshot_id": "screenshot_1729532400000_abc123",
       "format": "jpeg",
       "size_bytes": 245680,
       "base64_data": "data:image/jpeg;base64,/9j/4AAQ..."
     }
   }
   ↓
9. Backend WebSocket Handler (backend/server.py)
   ↓
   Routes to: handle_screenshot(session_id, data)
   ↓
10. Screenshot Handler (backend/server.py)
    ↓
    Decodes base64 → saves to output/screenshots/{screenshot_id}.jpeg
    ↓
    Sends confirmation back to frontend (optional)
    ↓
11. Callback Router receives tool_result
    ↓
    Returns to MCP tool function
    ↓
12. Agent receives result:
    {
      "screenshot_id": "screenshot_1729532400000_abc123",
      "url": "/api/view?filename=screenshot_1729532400000_abc123.jpeg&type=output&subfolder=screenshots",
      "size_bytes": 245680
    }
    ↓
13. Agent generates markdown:
    "Here's the workflow section:\n\n![screenshot](api/view?filename=screenshot_1729532400000_abc123.jpeg&type=output&subfolder=screenshots&rand=0.123)"
```

### Canvas Element Access

**Finding the canvas element:**

```javascript
// Method 1: Via app.canvas (RECOMMENDED)
const canvasElement = app.canvas.canvas;

// Method 2: Direct DOM query (fallback)
const canvasElement = document.querySelector('.graph-canvas');
// or
const canvasElement = document.querySelector('canvas');
```

**Verification needed:**
- Check ComfyUI source for exact canvas element reference
- Test both methods in browser console
- Confirm `app.canvas.canvas` is the correct property

**LiteGraph structure:**
```javascript
app.canvas           // LGraphCanvas instance
app.canvas.canvas    // HTMLCanvasElement (the actual canvas)
app.canvas.ctx       // CanvasRenderingContext2D
app.graph            // LGraph instance
app.graph._nodes     // Array of LGraphNode instances
```

### Screenshot Implementation Details

**Canvas to Base64 conversion:**

```javascript
// Using toBlob (async, recommended)
const blob = await new Promise((resolve, reject) => {
    canvasElement.toBlob(
        (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
        },
        'image/jpeg',
        0.9  // quality
    );
});

// Convert blob to base64
const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

// Result format: "data:image/jpeg;base64,/9j/4AAQ..."
```

**File size considerations:**
- Typical ComfyUI canvas: ~1920x1080 pixels
- JPEG at 90% quality: ~200-500 KB
- Base64 encoding adds ~33%: ~260-650 KB
- WebSocket can handle this size (typical limit: 1-16 MB)

**Screenshot directory structure:**
```
output/
  screenshots/
    screenshot_1729532400000_abc12345.jpeg
    screenshot_1729532401234_abc12345.jpeg
    ...
```

---

## 🎯 Problem 3: Focus/Fit View Tool

### LiteGraph fitNodes() Method

**From LiteGraph documentation:**

```javascript
LGraphCanvas.fitNodes(nodes)
```

**Parameters:**
- `nodes` (Array[LGraphNode], optional) - Nodes to fit in view
- If `null` or `undefined`: Fits ALL nodes in graph
- If empty array `[]`: No effect

**Behavior:**
- Adjusts canvas offset (`ds.offset`) and scale (`ds.scale`)
- Centers the bounding box of specified nodes in viewport
- Applies padding around nodes
- Animates smoothly (if animation enabled)

**Usage patterns:**

```javascript
// Fit all nodes
app.canvas.fitNodes();

// Fit selected nodes
const selectedNodes = Object.values(app.canvas.selected_nodes || {});
app.canvas.fitNodes(selectedNodes);

// Fit specific nodes by ID
const nodes = [1, 2, 3].map(id => app.graph._nodes.find(n => n.id === id));
app.canvas.fitNodes(nodes.filter(n => n !== null));
```

### Tool Implementation Strategy

**Tool name:** `focus_on_nodes` (semantic at MCP level)

**Tool flow:**
```
Agent calls: focus_on_nodes(node_ids=[1, 2, 3])
  ↓
backend/mcp_server.py: @tool async def focus_on_nodes()
  ↓
Calls: callback_router.execute_tool_callback("focus_on_nodes", {"node_ids": [1,2,3]})
  ↓
WebSocket: tool_request message
  ↓
web/js/tool_executor.js: _handleFocusOnNodes()
  ↓
web/js/fl_api.js: fitView(nodeIds)
  ↓
LiteGraph: app.canvas.fitNodes(nodes)
```

**FL_API method signature:**

```javascript
/**
 * Fit view to selected nodes or all nodes
 * @param {Array<number>|null} nodeIds - Optional array of node IDs to fit (null for selected)
 * @returns {object} Result with count of fitted nodes
 */
fitView(nodeIds = null) {
    try {
        let nodes;
        
        if (nodeIds === null) {
            // Use currently selected nodes
            nodes = Object.values(app.canvas.selected_nodes || {});
        } else if (Array.isArray(nodeIds) && nodeIds.length > 0) {
            // Find specified nodes
            nodes = nodeIds
                .map(id => this._findNode(id))
                .filter(n => n !== null);
        } else {
            // Fit all nodes (pass undefined to fitNodes)
            nodes = undefined;
        }
        
        // Call LiteGraph fitNodes
        app.canvas.fitNodes(nodes);
        
        const count = nodes ? nodes.length : app.graph._nodes.length;
        console.log(`[FL_API] Fit view to ${count} node(s)`);
        return { fitted_count: count };
    } catch (error) {
        console.error("[FL_API] fitView error:", error);
        throw error;
    }
}
```

### Combined Workflow: Focus + Screenshot

**User request:** "Show me the upscaling section"

**Agent workflow:**

```python
# 1. Find nodes
result = await query_workflow(
    ctx,
    query="Find all nodes related to upscaling"
)
upscale_nodes = [node['id'] for node in result['nodes']]

# 2. Select nodes (visual feedback)
await select_nodes(ctx, node_ids=upscale_nodes)

# 3. Focus on nodes (zoom to selection)
await focus_on_nodes(ctx, node_ids=upscale_nodes)

# 4. Take screenshot
screenshot = await take_screenshot(ctx, format="jpeg", quality=0.9)

# 5. Return with embedded image
return f"""Here's the upscaling section of your workflow:

![Upscaling Section]({screenshot['url']})

This section includes {len(upscale_nodes)} nodes:
- {', '.join([node['type'] for node in result['nodes']])}
"""
```

---

## 🔧 Implementation Checklist

### Phase 1: Image Serving Endpoint

- [ ] Add `/api/view` endpoint to `backend/server.py`
- [ ] Implement path validation and security checks
- [ ] Support `output`, `input`, `temp` types
- [ ] Support `subfolder` parameter
- [ ] Test with existing agent markdown
- [ ] Verify works in both frontend and PWA

### Phase 2: Focus/Fit View Tool

**Backend (MCP tool):**
- [ ] Add `focus_on_nodes` tool to `backend/mcp_server.py`
- [ ] Tool parameters: `node_ids: Optional[List[int]]`
- [ ] Use callback_router for WebSocket communication

**Frontend (FL_API):**
- [ ] Add `fitView(nodeIds)` method to `web/js/fl_api.js`
- [ ] Handle null (selected), array (specific), undefined (all) cases
- [ ] Call `app.canvas.fitNodes(nodes)`

**Frontend (Tool Executor):**
- [ ] Add `_handleFocusOnNodes` to `web/js/tool_executor.js`
- [ ] Register handler in `_registerHandlers()`

**Testing:**
- [ ] Test focus on all nodes
- [ ] Test focus on selected nodes
- [ ] Test focus on specific node IDs
- [ ] Test with empty selection
- [ ] Test with invalid node IDs

### Phase 3: Screenshot Tool

**Backend (MCP tool):**
- [ ] Add `take_screenshot` tool to `backend/mcp_server.py`
- [ ] Tool parameters: `format: Literal['jpeg', 'png']`, `quality: float`
- [ ] Use callback_router for WebSocket communication
- [ ] Return screenshot URL for agent markdown

**Backend (WebSocket handler):**
- [ ] Add `handle_screenshot` to `backend/server.py`
- [ ] Create `output/screenshots/` directory if not exists
- [ ] Decode base64 image data
- [ ] Save to file with unique ID
- [ ] Return confirmation with file path

**Backend (Models):**
- [ ] Add `ScreenshotMessage` to `backend/models.py`
- [ ] Fields: `screenshot_id`, `format`, `size_bytes`, `base64_data`

**Frontend (FL_API):**
- [ ] Add `takeScreenshot(format, quality)` method to `web/js/fl_api.js`
- [ ] Access canvas: `app.canvas.canvas`
- [ ] Convert to blob: `canvas.toBlob()`
- [ ] Convert to base64: `FileReader.readAsDataURL()`
- [ ] Generate screenshot ID
- [ ] Return screenshot data

**Frontend (Tool Executor):**
- [ ] Add `_handleTakeScreenshot` to `web/js/tool_executor.js`
- [ ] Register handler in `_registerHandlers()`
- [ ] Send screenshot data via WebSocket

**Testing:**
- [ ] Test JPEG screenshot (90% quality)
- [ ] Test PNG screenshot
- [ ] Verify file saved to output/screenshots/
- [ ] Verify URL works in agent response
- [ ] Test in both frontend and PWA
- [ ] Test file size limits
- [ ] Test with large canvas

### Phase 4: Integration Testing

**Combined workflow test:**
- [ ] Agent: query_workflow (find nodes)
- [ ] Agent: select_nodes (select found nodes)
- [ ] Agent: focus_on_nodes (zoom to selection)
- [ ] Agent: take_screenshot (capture view)
- [ ] Agent: Return response with embedded image
- [ ] Verify image displays in frontend
- [ ] Verify image displays in PWA

**Edge cases:**
- [ ] Screenshot with no nodes
- [ ] Screenshot with very large canvas
- [ ] Focus on non-existent nodes
- [ ] Screenshot while workflow is executing
- [ ] Multiple screenshots in quick succession

---

## 📊 Technical Specifications

### Image Serving Endpoint

**Endpoint:** `GET /api/view`

**Query Parameters:**
- `filename` (required): Image filename
- `type` (required): `"output"`, `"input"`, or `"temp"`
- `subfolder` (optional): Subfolder path (default: "")
- `rand` (optional): Cache busting float (default: 0.0)

**Response:**
- Success: `FileResponse` with appropriate media type
- Not Found: `404` with error message
- Security Error: `403` with error message
- Server Error: `500` with error message

**Security:**
- All paths validated against base directory
- Path traversal attacks prevented
- Only serves from `output/`, `input/`, `temp/` directories

### Focus Tool

**MCP Tool Name:** `focus_on_nodes`

**Parameters:**
```python
node_ids: Optional[List[int]] = None  # None = selected, [] = all, [1,2,3] = specific
```

**Returns:**
```python
{
    "fitted_count": int  # Number of nodes fitted in view
}
```

**Frontend Tool Name:** `focus_on_nodes`

**FL_API Method:** `fitView(nodeIds)`

### Screenshot Tool

**MCP Tool Name:** `take_screenshot`

**Parameters:**
```python
format: Literal['jpeg', 'png'] = 'jpeg'
quality: float = 0.9  # 0.0-1.0, JPEG only
```

**Returns:**
```python
{
    "screenshot_id": str,  # Unique ID
    "url": str,  # URL for markdown embedding
    "size_bytes": int,  # File size
    "format": str  # 'jpeg' or 'png'
}
```

**Frontend Tool Name:** `take_screenshot`

**FL_API Method:** `takeScreenshot(format, quality)`

**Screenshot ID Format:**
```
screenshot_{timestamp}_{session_id_prefix}

Example: screenshot_1729532400000_abc12345
```

**File Path:**
```
output/screenshots/screenshot_1729532400000_abc12345.jpeg
```

**URL Format:**
```
api/view?filename=screenshot_1729532400000_abc12345.jpeg&type=output&subfolder=screenshots&rand=0.123
```

---

## 📝 Agent Instructions Update

No changes needed to `agents/agent.md` - existing instructions work:

**Current (still valid):**
```markdown
### Showing Images in your Reply

**When showing a generated image in markdown** If you already know which folder 
the input is in and the image filename, you may include the image in your reply 
using markdown like this:

![ComfyUI_0023_.png](api/view?filename=ComfyUI_00023_.png&subfolder=&type=output&rand=0.38018754053851234)

The link format is:
`api/view?filename={filename}&subfolder={subfolder_if_any}&type={type}&rand={a_random_float}`
```

**New capability (add to agent instructions):**
```markdown
### Taking Screenshots

You can capture the current workflow canvas view using the `take_screenshot` tool:

```python
screenshot = await take_screenshot(format="jpeg", quality=0.9)
```

This returns a URL you can embed in your response:

```markdown
Here's the current workflow:

![Workflow Screenshot]({screenshot['url']})
```

Combine with `focus_on_nodes` to capture specific sections:

```python
# Focus on specific nodes
await focus_on_nodes(node_ids=[1, 2, 3])

# Capture the focused view
screenshot = await take_screenshot()

return f"Here's the section you asked about:\n\n![Section]({screenshot['url']})"
```
```

---

## 🔗 File Modification Summary

### Backend Files

1. **backend/server.py** - Add image serving endpoint
   - New endpoint: `GET /api/view`
   - New handler: `async def handle_screenshot()`
   - WebSocket routing: Add `"screenshot"` message type

2. **backend/mcp_server.py** - Add MCP tools
   - New tool: `@tool async def focus_on_nodes()`
   - New tool: `@tool async def take_screenshot()`

3. **backend/models.py** - Add message model
   - New model: `class ScreenshotMessage(BaseModel)`

### Frontend Files

4. **web/js/fl_api.js** - Add FL_API methods
   - New method: `fitView(nodeIds)`
   - New method: `async takeScreenshot(format, quality)`

5. **web/js/tool_executor.js** - Add tool handlers
   - New handler: `async _handleFocusOnNodes(params)`
   - New handler: `async _handleTakeScreenshot(params)`
   - Register handlers in `_registerHandlers()`

### Documentation Files

6. **agents/agent.md** - Update agent instructions (optional)
   - Add screenshot tool usage examples
   - Add focus tool usage examples

---

## ⚡ Performance Considerations

### Image Serving

**Caching:**
- Set `Cache-Control: no-cache` to respect `rand` parameter
- Browser will still cache, but revalidate on each request
- Consider adding `ETag` support for efficiency

**File Size:**
- ComfyUI output images: typically 1-10 MB
- No size limits needed (standard HTTP file serving)

### Screenshot Tool

**Canvas Size:**
- Typical: 1920x1080 = 2,073,600 pixels
- JPEG 90% quality: ~200-500 KB
- Base64 encoded: ~260-650 KB
- WebSocket transfer: ~0.5-1.5 seconds on local network

**Optimization:**
- Use JPEG for screenshots (smaller, acceptable quality)
- Use PNG only when transparency needed
- Quality 0.9 is good balance (90%)

**Rate Limiting:**
- Consider adding rate limit (e.g., 1 screenshot per 2 seconds)
- Prevents spam/abuse
- Not critical for agent use case

### Focus Tool

**Performance:**
- `fitNodes()` is very fast (<10ms)
- No performance concerns
- Can be called repeatedly without issues

---

## 🔒 Security Considerations

### Image Serving Endpoint

**Path Traversal:**
```python
# Validate path is within allowed directory
file_path = file_path.resolve()
if not str(file_path).startswith(str(base_path.resolve())):
    raise HTTPException(status_code=403, detail="Access denied")
```

**Type Validation:**
```python
if type not in ["output", "input", "temp"]:
    raise HTTPException(status_code=400, detail="Invalid type")
```

**File Existence:**
```python
if not file_path.exists() or not file_path.is_file():
    raise HTTPException(status_code=404, detail="File not found")
```

### Screenshot Tool

**Size Limits:**
- Base64 data limited by WebSocket message size
- Typical limit: 1-16 MB (plenty for screenshots)
- Consider adding explicit size check

**Storage:**
- Screenshots saved to `output/screenshots/`
- Within ComfyUI directory (safe)
- No cleanup implemented (manual deletion)

**Access Control:**
- No authentication on image endpoint
- Assumes trusted local network
- For public deployment: add authentication

---

## 🧪 Testing Strategy

### Unit Tests

**Image Serving:**
- [ ] Valid image request (output)
- [ ] Valid image request (input)
- [ ] Valid image request with subfolder
- [ ] Invalid type parameter
- [ ] Path traversal attempt
- [ ] Non-existent file
- [ ] Cache-Control header present

**Focus Tool:**
- [ ] Focus on specific nodes
- [ ] Focus on selected nodes
- [ ] Focus on all nodes
- [ ] Invalid node IDs
- [ ] Empty node list

**Screenshot Tool:**
- [ ] JPEG screenshot
- [ ] PNG screenshot
- [ ] Invalid format
- [ ] Invalid quality
- [ ] File saved correctly
- [ ] URL generated correctly

### Integration Tests

**End-to-End Workflow:**
1. Agent queries workflow
2. Agent selects nodes
3. Agent focuses on nodes
4. Agent takes screenshot
5. Agent returns response with image
6. Image displays in frontend
7. Image displays in PWA

**Multi-Client Test:**
1. Connect frontend (embedded)
2. Connect PWA (standalone)
3. Agent takes screenshot
4. Both clients receive response
5. Both clients display image correctly

---

## 📊 Success Metrics

**Image Serving:**
- ✅ Images load in frontend (existing behavior preserved)
- ✅ Images load in PWA (new capability)
- ✅ No security vulnerabilities
- ✅ Response time < 100ms for typical images

**Focus Tool:**
- ✅ Canvas zooms to correct nodes
- ✅ Works with select_nodes for visual feedback
- ✅ Agent can use in workflows
- ✅ Execution time < 50ms

**Screenshot Tool:**
- ✅ Screenshots captured correctly
- ✅ Files saved to correct location
- ✅ URLs work in markdown
- ✅ Images display in both clients
- ✅ File size reasonable (< 1 MB typical)
- ✅ Execution time < 2 seconds

**Combined Workflow:**
- ✅ Agent can query → select → focus → screenshot in one interaction
- ✅ User receives visual response
- ✅ Works in both frontend and PWA

---

**Investigation Complete:** 2025-10-21  
**Ready for Implementation Plan:** ✅ Yes  
**Next Step:** Create `implementation.md` with full code