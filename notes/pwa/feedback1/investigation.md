# PWA Feedback 1 - Investigation

**Date:** 2025-10-21  
**Focus:** Image access, screenshot tool, and focus/fit-view functionality  
**Status:** 🔍 Research complete

---

## 📚 Research Findings

### 1. Image Markdown Syntax (from `agents/agent.md`)

**Found in:** `agents/agent.md` - "Showing Images in your Reply" section

```markdown
![ComfyUI_0023_.png](api/view?filename=ComfyUI_00023_.png&subfolder=&type=output&rand=0.38018754053851234)
```

**Format:**
```
api/view?filename={filename}&subfolder={subfolder_if_any}&type={type}&rand={a_random_float}
```

**Parameters:**
- `filename` - The image filename
- `subfolder` - Subfolder path (empty string if none)
- `type` - Either "output" or "input"
- `rand` - Random float for cache busting

**Example usage:**
```javascript
const imageUrl = `api/view?filename=image.png&subfolder=&type=output&rand=${Math.random()}`;
```

> This is how it works currently because Ren is embedded into the ComfyUI interface. when the user clicks that it opens the image served up by the comfyui API... so we're going to need our own sort of backend endpoint to serve these up properly, BASED on which type of client the user is accessing the websocket session from... right? like because the agent sees this logic in the backend, it means 

---

### 2. LiteGraph Canvas API - Fit View Functions

**Source:** [LGraphCanvas Documentation](https://tamats.com/projects/litegraph/doc/classes/LGraphCanvas.html)

#### Key Methods Found:

##### ✅ `fitNodes([nodes])` - **PERFECT FOR OUR USE CASE**
- **Parameters:**
  - `nodes` (Array[LGraphNode], optional) - The nodes to fit in the view. If not provided, fits all nodes.
- **Description:** Adjusts the canvas view to fit the specified nodes or all nodes if none are specified. This ensures all nodes are visible in the viewport.
- **Usage:**
  ```javascript
  // Fit all nodes
  app.canvas.fitNodes();
  
  // Fit selected nodes
  const selectedNodes = Object.values(app.canvas.selected_nodes || {});
  app.canvas.fitNodes(selectedNodes);
  ```

##### `centerOnNode(node)`
- **Parameters:**
  - `node` (LGraphNode) - The node to center the view on
- **Description:** Centers the canvas view on the specified node.
- **Usage:**
  ```javascript
  const node = app.graph._nodes.find(n => n.id === nodeId);
  app.canvas.centerOnNode(node);
  ```

##### `zoom(value, [center])`
- **Parameters:**
  - `value` (number) - The zoom factor to apply
  - `center` (Array [x, y], optional) - The point to center the zoom on
- **Description:** Zooms the canvas in or out by the specified factor.

##### `selectNodes(nodes, [e])`
- **Parameters:**
  - `nodes` (Array[LGraphNode]) - The nodes to select
  - `e` (Event, optional) - The event that triggered the selection
- **Description:** Selects the specified nodes.

**Integration with existing tools:**
- We already have `selectNodes` tool in FL_API
- We can add `fitView` tool that calls `app.canvas.fitNodes(selectedNodes)`
- Combined workflow: `select_nodes` → `fit_view` → `take_screenshot`

> I think with this, we can yeah, expose this all the way through the web/js/tool_executor.js and the whole thing through back to the backend/mcp_server.py as a tool; `focus_on_nodes` the function name is semantic at that level... so we call _execute_tool() for this and then that goes through the websocket layer, to the frontend tool executor which uses that fitView on fl_api.

---

### 3. HTML Canvas Screenshot API

**Sources:**
- [MDN - toDataURL](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL)
- [MDN - toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [WebGL Fundamentals - Taking Screenshots](https://webglfundamentals.org/webgl/lessons/webgl-tips.html)

#### Method 1: `toDataURL()` - Simple but synchronous

```javascript
const canvas = document.getElementById('canvas-id');
const dataURL = canvas.toDataURL('image/jpeg', 0.9); // 90% quality
// Returns: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
```

**Pros:**
- Simple, synchronous API
- Returns base64 string directly
- Good browser support

**Cons:**
- Blocks main thread
- Returns data URL (includes "data:image/jpeg;base64," prefix)

#### Method 2: `toBlob()` - Modern, asynchronous (RECOMMENDED)

```javascript
const canvas = document.getElementById('canvas-id');
canvas.toBlob(function(blob) {
    // blob is a Blob object
    // Can convert to base64 or send directly
}, 'image/jpeg', 0.9); // 90% quality
```

**Pros:**
- Asynchronous (non-blocking)
- More efficient for large images
- Modern, preferred method

**Cons:**
- Callback-based (but can be promisified)

#### Converting Blob to Base64 for WebSocket

```javascript
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Usage:
canvas.toBlob(async function(blob) {
    const base64 = await blobToBase64(blob);
    // base64 includes "data:image/jpeg;base64," prefix
    // Send via WebSocket
}, 'image/jpeg', 0.9);
```

#### Finding the Canvas Element

**ComfyUI uses LiteGraph which renders to a canvas element:**

```javascript
// Access via app.canvas
const canvasElement = app.canvas.canvas; // The actual HTML canvas element

// Or find it in DOM
const canvasElement = document.querySelector('.graph-canvas');
// or
const canvasElement = document.querySelector('canvas');
```

**Need to verify:** The exact selector/property to access ComfyUI's canvas element.

---

## 🛠️ Implementation Strategy

### Phase 1: Mount Output/Input Folders

**File:** `backend/server.py`

```python
# Add after existing static mounts
OUTPUT_DIR = PROJECT_ROOT / "output"
INPUT_DIR = PROJECT_ROOT / "input"

app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/input", StaticFiles(directory=str(INPUT_DIR)), name="input")
```

**Note:** Need to ensure `output/` and `input/` directories exist in ComfyUI structure.

---

### Phase 2: Focus/Fit View Tool

**File:** `web/js/fl_api.js`

**Add new method:**

```javascript
/**
 * Fit view to selected nodes or all nodes
 * @param {Array<number>|null} nodeIds - Optional array of node IDs to fit (null for selected)
 * @returns {object} Result
 */
fitView(nodeIds = null) {
    try {
        let nodes;
        
        if (nodeIds === null) {
            // Use currently selected nodes
            nodes = Object.values(app.canvas.selected_nodes || {});
        } else if (Array.isArray(nodeIds)) {
            // Find specified nodes
            nodes = nodeIds.map(id => this._findNode(id)).filter(n => n !== null);
        } else {
            // Fit all nodes
            nodes = null;
        }
        
        // Call LiteGraph fitNodes
        app.canvas.fitNodes(nodes);
        
        const count = nodes ? nodes.length : app.graph._nodes.length;
        console.log(`[FL_API] Fit view to ${count} node(s)`);
        return { fitted: count };
    } catch (error) {
        console.error("[FL_API] fitView error:", error);
        throw error;
    }
}
```

**Backend tool registration:**
- Add `fit_view` tool to `backend/tools/comfy_tools.py`
- Maps to `fitView()` method in FL_API

---

### Phase 3: Screenshot Tool

#### Step 1: Add screenshot method to FL_API

**File:** `web/js/fl_api.js`

```javascript
/**
 * Take a screenshot of the canvas
 * @param {string} format - Image format ('jpeg' or 'png')
 * @param {number} quality - Image quality (0.0 - 1.0, for jpeg)
 * @returns {Promise<object>} Screenshot data
 */
async takeScreenshot(format = 'jpeg', quality = 0.9) {
    try {
        // Get the canvas element
        const canvasElement = app.canvas.canvas;
        if (!canvasElement) {
            throw new Error('Canvas element not found');
        }
        
        // Generate screenshot ID
        const timestamp = Date.now();
        const sessionId = this.sessionId || 'unknown'; // Need to pass session ID
        const screenshotId = `screenshot_${timestamp}_${sessionId.substring(0, 8)}`;
        
        // Convert to blob then base64
        const blob = await new Promise((resolve, reject) => {
            canvasElement.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Failed to create blob'));
                },
                `image/${format}`,
                quality
            );
        });
        
        // Convert blob to base64
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        
        console.log(`[FL_API] Screenshot captured: ${screenshotId}`);
        return {
            screenshot_id: screenshotId,
            format: format,
            size_bytes: blob.size,
            base64_data: base64
        };
    } catch (error) {
        console.error("[FL_API] takeScreenshot error:", error);
        throw error;
    }
}
```

#### Step 2: Add WebSocket message type

**File:** `backend/models.py`

```python
class ScreenshotMessage(BaseModel):
    """Screenshot message from frontend."""
    type: Literal["screenshot"] = "screenshot"
    session_id: str
    screenshot_id: str
    format: str  # 'jpeg' or 'png'
    size_bytes: int
    base64_data: str  # Full data URL with prefix
```

#### Step 3: Backend handler to save screenshot

**File:** `backend/server.py`

```python
import base64
from pathlib import Path

async def handle_screenshot(session_id: str, data: dict) -> None:
    """Handle screenshot from frontend.
    
    Args:
        session_id: Session ID
        data: Screenshot data
    """
    try:
        screenshot = ScreenshotMessage(**data)
        logger.info(f"Received screenshot: {screenshot.screenshot_id}")
        
        # Create screenshots directory if it doesn't exist
        screenshots_dir = PROJECT_ROOT / "output" / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)
        
        # Extract base64 data (remove data URL prefix)
        # Format: "data:image/jpeg;base64,/9j/4AAQ..."
        base64_str = screenshot.base64_data.split(',', 1)[1]
        
        # Decode base64
        image_data = base64.b64decode(base64_str)
        
        # Save to file
        filename = f"{screenshot.screenshot_id}.{screenshot.format}"
        filepath = screenshots_dir / filename
        
        with open(filepath, 'wb') as f:
            f.write(image_data)
        
        logger.info(f"Screenshot saved: {filepath}")
        
        # Send success response back to frontend
        # (This will be the tool_result for the screenshot tool)
        await manager.send_message(session_id, {
            'type': 'screenshot_saved',
            'session_id': session_id,
            'screenshot_id': screenshot.screenshot_id,
            'filename': filename,
            'path': f'output/screenshots/{filename}',
            'url': f'/output/screenshots/{filename}',
            'size_bytes': len(image_data)
        }, target='frontend')
        
    except Exception as e:
        logger.error(f"Error handling screenshot: {e}", exc_info=True)
        await manager.send_error(
            session_id,
            "SCREENSHOT_ERROR",
            "Failed to save screenshot",
            {"error": str(e)},
        )
```

#### Step 4: Add to WebSocket message router

**File:** `backend/server.py` - in `websocket_endpoint` function

```python
elif msg_type == "screenshot":
    await handle_screenshot(session_id, data)
```

#### Step 5: Mount screenshots folder

**File:** `backend/server.py`

```python
# After output mount
SCREENSHOTS_DIR = PROJECT_ROOT / "output" / "screenshots"
app.mount("/screenshots", StaticFiles(directory=str(SCREENSHOTS_DIR)), name="screenshots")
```

#### Step 6: Create agent tool

**File:** `backend/tools/comfy_tools.py`

```python
@tool
async def take_screenshot(
    ctx: RunContext[ComfyDeps],
    format: Literal['jpeg', 'png'] = 'jpeg',
    quality: float = 0.9
) -> str:
    """Take a screenshot of the ComfyUI canvas.
    
    This captures the current view of the workflow canvas and saves it to output/screenshots/.
    The screenshot will be accessible via URL for display in chat.
    
    Args:
        format: Image format ('jpeg' or 'png')
        quality: Image quality for JPEG (0.0 - 1.0, default 0.9)
    
    Returns:
        Screenshot URL that can be embedded in markdown
    """
    # Request screenshot from frontend
    result = await ctx.deps.callback_router.request_tool(
        tool_name='take_screenshot',
        parameters={'format': format, 'quality': quality},
        timeout=10.0
    )
    
    if not result['success']:
        raise RuntimeError(f"Screenshot failed: {result.get('error')}")
    
    # Extract screenshot info from result
    screenshot_id = result['data']['screenshot_id']
    filename = result['data']['filename']
    url = result['data']['url']
    
    # Return markdown-ready URL
    return f"Screenshot saved: ![{screenshot_id}]({url}?rand={random.random()})"
```

---

### Phase 4: Combined Focus + Screenshot Workflow

**Agent workflow:**

1. User: "Show me the upscaling section"
2. Agent uses `query_workflow` to find upscaling nodes
3. Agent uses `select_nodes` to select those nodes
4. Agent uses `fit_view` to zoom to selection
5. Agent uses `take_screenshot` to capture the view
6. Agent responds with screenshot embedded in markdown

**Example agent response:**
```markdown
Here's the upscaling section of your workflow:

![screenshot](screenshots/screenshot_1729532400000_a1b2c3d4.jpg?rand=0.12345)

The upscaler is connected to the VAE decoder and feeds into the final save node.
```

---

## 📝 Technical Notes

### Canvas Element Access

**Need to verify in ComfyUI codebase:**
- Exact property to access canvas: `app.canvas.canvas`
- Alternative: `document.querySelector('.graph-canvas')`
- Check `web/extensions/core/` for canvas initialization

### Screenshot Quality Considerations

**JPEG vs PNG:**
- JPEG: Smaller file size, lossy compression, good for workflow screenshots
- PNG: Larger file size, lossless, better for diagrams with text

**Recommended defaults:**
- Format: JPEG
- Quality: 0.9 (90%)
- This balances quality and file size

### Base64 Encoding Size

Base64 encoding increases size by ~33%:
- 1MB canvas → ~1.33MB base64
- WebSocket should handle this fine for occasional screenshots
- Consider adding max size check (e.g., 5MB limit)

### Directory Structure

```
output/
  screenshots/
    screenshot_1729532400000_a1b2c3d4.jpg
    screenshot_1729532401234_a1b2c3d4.jpg
    ...
```

**Cleanup strategy:**
- Could add periodic cleanup of old screenshots
- Or implement max count (e.g., keep last 100)
- For now: manual cleanup by user

---

## ✅ Next Steps

1. **Verify canvas access** - Check ComfyUI source for exact canvas element reference
2. **Test fit view** - Implement and test `fitNodes()` functionality
3. **Implement screenshot** - Add full screenshot pipeline
4. **Mount directories** - Add output/input/screenshots mounts
5. **Create agent tools** - Register `fit_view` and `take_screenshot` tools
6. **Test end-to-end** - Verify full workflow from agent command to PWA display

---

## 🔗 References

- [LGraphCanvas Documentation](https://tamats.com/projects/litegraph/doc/classes/LGraphCanvas.html)
- [MDN - HTMLCanvasElement.toBlob()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [MDN - HTMLCanvasElement.toDataURL()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL)
- [WebGL Fundamentals - Taking Screenshots](https://webglfundamentals.org/webgl/lessons/webgl-tips.html)
- Agent instructions: `agents/agent.md`
- FL_API implementation: `web/js/fl_api.js`

---

**Investigation Complete:** 2025-10-21  
**Ready for Implementation:** ✅ Yes