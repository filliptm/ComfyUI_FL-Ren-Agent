# PWA Feedback Session 1 - Image Access & Screenshot Tool

**Date:** 2025-10-21  
**Status:** 📝 Feature requests collected  
**Priority:** 🔥 High - Core PWA functionality

---

## ✅ What's Working

- PWA loads successfully
- Module imports work (404s fixed)
- Session picker displays
- WebSocket connection established
- Chat UI functional

---

## 🎯 Feature Requests

### 1. Image Access from PWA

**Problem:**
- PWA can't display ComfyUI output images
- No path mounted to access `/output` and `/input` folders

**Proposed Solution:**
- Mount ComfyUI `output/` and `input/` folders in `backend/server.py`
- Create agent tool to get latest image URIs
- Tool should return server URL (env var based, not hardcoded localhost)
- Agent already shows images in markdown, just need accessible paths

**Use Case:**
- User asks "show me the output"
- Agent lists files, finds latest images
- Returns markdown with image URLs that PWA can access
- Images display in chat

---

### 2. Screenshot Tool

**Purpose:**
- Capture ComfyUI canvas as JPEG
- Save to `output/screenshots/` folder
- Make accessible to PWA and agent

**Technical Approach:**

#### Frontend (ComfyUI side):
1. Use HTML Canvas API to capture canvas element
2. Canvas has built-in `.toDataURL()` or `.toBlob()` methods
3. Generate screenshot ID (timestamp-based?)
4. Base64 encode image data
5. Send via WebSocket as `screenshot` message type to backend

#### Backend:
1. Receive base64 screenshot data
2. Decode and save to `output/screenshots/{screenshot_id}.jpg`
3. Return tool result with screenshot path/URL
4. Mount `output/screenshots/` for PWA access

#### Agent:
1. Tool result contains accessible screenshot URL
2. Agent can embed in markdown response (check `agents/agent.md` for image syntax)
3. PWA displays screenshot in chat

**Message Flow:**
```
Agent → Frontend: tool_request(screenshot)
Frontend → Backend: screenshot message {type: 'screenshot', data: base64, id: ...}
Backend: Save to output/screenshots/
Backend → Frontend: tool_result {success: true, url: '/screenshots/...'}
Frontend → Agent: tool_result
Agent → PWA: agent_response with ![screenshot](url)
PWA: Displays image
```

---

### 3. Focus Tool (Fit View)

**Purpose:**
- Focus ComfyUI canvas on selected nodes
- Prepare for screenshot (show relevant workflow section)

**Technical Approach:**

#### ComfyUI Integration:
1. ComfyUI has "Fit View" button (bottom right)
2. Already works with selection - fits view to selected nodes
3. Need to find and call that function programmatically

#### Tool Flow:
1. Use existing `select_nodes` tool to select target nodes
2. Call fit view function to center/zoom on selection
3. Optionally take screenshot after focusing

**Investigation Needed:**
- Find fit view function in ComfyUI codebase
- Determine how to call it from `web/js/fl_api.js`
- Check if it's exposed in ComfyUI app instance

---

## 🗂️ File Structure

### New Folders:
```
output/
  screenshots/          # New folder for canvas screenshots
    {timestamp}.jpg
    {timestamp}.jpg
```

### Backend Mounts:
```python
# In backend/server.py
app.mount("/output", StaticFiles(directory="output"), name="output")
app.mount("/input", StaticFiles(directory="input"), name="input")
app.mount("/screenshots", StaticFiles(directory="output/screenshots"), name="screenshots")
```

---

## 🛠️ Implementation Tasks

### Phase 1: Image Access
- [ ] Mount `/output` and `/input` folders in backend
- [ ] Create agent tool `get_latest_images` or similar
- [ ] Use env var for server URL (not hardcoded localhost)
- [ ] Test image display in PWA

### Phase 2: Screenshot Tool
- [ ] Research Canvas API for screenshot capture
- [ ] Implement screenshot capture in `web/js/fl_api.js`
- [ ] Add `screenshot` message type to WebSocket protocol
- [ ] Backend handler to save base64 image
- [ ] Create `output/screenshots/` folder
- [ ] Mount `/screenshots` in backend
- [ ] Create agent tool `take_screenshot`
- [ ] Test screenshot flow end-to-end

### Phase 3: Focus Tool
- [ ] Research ComfyUI fit view function
- [ ] Find how to call it programmatically
- [ ] Integrate with existing `select_nodes` tool
- [ ] Create `focus_nodes` tool or add to `select_nodes`
- [ ] Test focus + screenshot workflow

---

## 📋 Investigation Checklist

- [ ] Check `agents/agent.md` for image markdown syntax
- [ ] Search online for Canvas screenshot best practices
- [ ] Investigate ComfyUI codebase for fit view function
- [ ] Review `web/js/fl_api.js` for tool implementation patterns
- [ ] Check existing tool result structure for file paths

---

## 💡 Design Considerations

### Screenshot ID Format
```javascript
const screenshotId = `screenshot_${Date.now()}_${sessionId.substring(0, 8)}`;
// Example: screenshot_1729532400000_a1b2c3d4.jpg
```

### Base64 Encoding
```javascript
// Canvas to base64
const canvas = document.getElementById('comfyui-canvas');
const base64 = canvas.toDataURL('image/jpeg', 0.9); // 90% quality
```

### Server URL Environment Variable
```python
# In config.py or settings
SERVER_URL = os.getenv('FL_SERVER_URL', 'http://localhost:8000')
```

---

## 🔗 Related Files

- `agents/agent.md` - Agent instructions for image embedding
- `web/js/fl_api.js` - ComfyUI frontend tool API
- `backend/server.py` - WebSocket message handling
- `backend/models.py` - Message type definitions
- `web/js/ws_client.js` - WebSocket client

---

**Feedback Collected:** 2025-10-21  
**Next Step:** Investigation phase 🔍