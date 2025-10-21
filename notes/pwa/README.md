# Ren Go - Mobile PWA for ComfyUI

**Ren Go** is a Progressive Web App that lets you interact with your ComfyUI workflows from your phone. Chat with Ren, control workflows, and get notified when generations complete - all from your mobile device.

---

## 🎯 Project Overview

Ren Go brings the power of the FL_JS Ren assistant to your mobile phone. It's a minimal, chat-focused interface that connects to the same backend as your ComfyUI instance, allowing seamless multi-device workflow control.

### Key Features

- 💬 **Chat Interface** - Same Ren assistant, optimized for mobile
- 🔔 **Smart Notifications** - Get notified when workflows complete or fail
- 🔗 **Ren Links** - One-tap actions like "Show me the output" or "Help me debug this"
- 🔄 **Session Switching** - Connect to any active ComfyUI session
- 📱 **PWA Installation** - Install to home screen like a native app
- ✨ **Offline Support** - Service worker caches assets for reliability
- 🔒 **Secure** - Works over HTTPS via ngrok or local network

### What Makes It Special

> **The chat is the interface.**

No complex UI, no learning curve. Just talk to Ren:
- "Generate a sunset landscape"
- "Show me the workflow"
- "What went wrong with the last run?"
- "Explain the KSampler settings"

Ren responds with images, diagrams, explanations - everything flows through the conversation.

---

## 📚 Documentation Structure

This directory contains all planning and implementation documentation for Ren Go:

### Planning Documents

1. **[idea.md](./idea.md)** - Original concept and vision
   - Use cases and goals
   - Architecture overview
   - Multi-client session design

2. **[investigation.md](./investigation.md)** - Architecture deep dive
   - How WebSocket multi-client works
   - Backend structure analysis
   - Frontend component reuse strategy
   - Session management details

### Implementation Guides

3. **[implementation.md](./implementation.md)** - Complete PWA build guide
   - Step-by-step backend changes
   - PWA frontend structure
   - Service worker setup
   - Testing procedures
   - Deployment considerations
   - **Start here for implementation!**

4. **[notifications_implementation.md](./notifications_implementation.md)** - Smart notifications guide
   - Execution progress notifications
   - Error alerts
   - System messages with Ren links
   - Notification permission handling
   - Mobile-specific considerations

### Research & Ideas

5. **[more_ideas/analysis.md](./more_ideas/analysis.md)** - Future enhancement ideas
   - Image preview gallery
   - Voice input
   - Workflow templates
   - Queue management
   - Session search
   - (Most features deferred to keep PWA minimal)

---

## 🚀 Quick Start

See **[web/pwa/README.md](../../web/pwa/README.md)** for setup instructions.

**TL;DR**:
1. Implement backend changes from `implementation.md`
2. Create PWA files in `web/pwa/`
3. Start backend: `python backend/server.py`
4. Open ComfyUI with FL_JS extension
5. Access PWA: `http://localhost:8000/pwa`
6. For mobile: Use ngrok to expose backend
7. Install PWA to home screen

---

## 🏛️ Architecture Summary

### High-Level Flow

```
💻 ComfyUI (Frontend)           📱 Ren Go (PWA)
        │                            │
        │ WebSocket                 │ WebSocket
        │ (client_version:          │ (client_version:
        │  "FL_JS 1.0")             │  "1.0.0-pwa")
        │                            │
        └───────┬───────────────────┘
                │
         🔌 FL_JS Backend (FastAPI)
                │
         Session Manager
         - Multi-client support
         - Message routing
         - Tool execution
                │
         🤖 Ren Agent (Pydantic AI)
```

### Session Architecture

**One Session, Multiple Clients**:
- ComfyUI frontend connects (type: `frontend`)
- PWA connects to same session (type: `pwa`)
- Both share conversation history
- Tool requests route to `frontend` (ComfyUI)
- Agent responses broadcast to all clients

**Connection Types**:
- `frontend` - ComfyUI web interface (can execute tools)
- `pwa` - Mobile PWA (read-only for tools, can chat)
- `mcp` - MCP server subprocess (internal)

### Message Flow Examples

**User sends message from PWA**:
```
PWA --[user_message]--> Backend
                         │
                    Agent processes
                         │
                    ├--[agent_response]--> PWA
                    └--[agent_response]--> ComfyUI
```

**Agent needs to execute tool**:
```
Backend --[tool_request]--> ComfyUI Frontend
                             │
                        Tool executes
                             │
         ComfyUI --[tool_result]--> Backend
                                     │
                                Agent continues
                                     │
                                ├--[response]--> PWA
                                └--[response]--> ComfyUI
```

**Workflow execution events**:
```
ComfyUI --[execution_event]--> Backend
                                │
                           Broadcasts to PWA
                                │
                           PWA --[notification]--> User
                           PWA --[system_message]--> Chat
```

---

## 📦 Code Reuse Strategy

Ren Go **maximizes code reuse** from the existing ComfyUI frontend:

### Fully Reused (100%)
- `web/js/ws_client.js` - WebSocket client
- `web/js/session_manager.js` - Session management
- `web/js/chat_ui.js` - Chat interface
- `web/js/tool_activity.js` - Tool execution display
- `web/js/_components/MessageBubble.js` - Message rendering
- `web/js/style.css` - Base styles

### PWA-Specific (New)
- `web/pwa/index.html` - PWA entry point
- `web/pwa/app.js` - Session picker + initialization
- `web/pwa/styles.css` - Mobile-optimized overrides
- `web/pwa/service-worker.js` - Offline support
- `web/pwa/manifest.json` - PWA metadata

### Backend Changes (Minimal)
- Add `/pwa` endpoint (serve PWA HTML)
- Add `/api/sessions` endpoint (list active sessions)
- Add event broadcasting to PWA clients
- Update connection type detection

**Total new code**: ~500 lines  
**Code reused**: ~2000+ lines

---

## 🔔 Notifications Design

Notifications are **minimal and smart**:

### When Notifications Appear
- ✅ Workflow completes successfully
- ❌ Workflow fails with error
- Only when PWA is **backgrounded** (not visible)

### What Notifications Include
- **Success**: "✨ Workflow Complete! Finished in 30.0s"
- **Error**: "❌ Workflow Error - KSampler failed: missing input"
- Tap notification → Opens PWA

### System Messages in Chat

Every notification also adds a **system message** to chat with **Ren links**:

**Success message**:
```markdown
✅ **Workflow completed successfully** in 30.0s

[Show me the output](ren://message)
```

**Error message**:
```markdown
⚠️ **Workflow error in node 7**

**Type:** KSampler
**Error:** Required input 'model' not connected

[Help me debug this](ren://message)
```

### Ren Links

Ren links (`ren://message`) are **one-tap actions**:
- Tap the link text → Sends that message to Ren
- "Show me the output" → Ren responds with images
- "Help me debug this" → Ren analyzes and suggests fix
- Perfect for mobile - no typing needed

---

## 🎯 Design Philosophy

### Keep It Minimal

> "Every feature you don't add is a feature you don't have to maintain."

**What we're NOT adding**:
- ❌ Progress bars
- ❌ Image galleries
- ❌ Queue management panels
- ❌ Workflow editors
- ❌ Settings screens

**Why?** Because Ren can do all of this through chat:
- "Show me the queue" → Ren lists workflows
- "Show me the latest image" → Ren displays it
- "Explain my workflow" → Ren shows diagram

### Chat-First Interface

The chat is the **single interface** for everything:
- Asking questions
- Controlling workflows
- Viewing results
- Debugging errors
- Learning ComfyUI

Notifications are just **gentle nudges** to return to the conversation.

### Mobile-Optimized

- Large touch targets (44px minimum)
- Readable text (16px, prevents zoom on iOS)
- Safe area insets for notched devices
- Prevent pull-to-refresh
- Optimized for one-handed use
- Minimal data usage (reuses cached assets)

---

## 🛠️ Implementation Checklist

Follow this order for smooth implementation:

### Phase 1: Core PWA
- [ ] Backend changes (`implementation.md` Phase 1)
  - [ ] Static file serving
  - [ ] `/api/sessions` endpoint
  - [ ] Connection type detection
  - [ ] Message routing updates
- [ ] PWA frontend (`implementation.md` Phase 2)
  - [ ] Create `web/pwa/` directory
  - [ ] `index.html` - Entry point
  - [ ] `app.js` - Session picker + initialization
  - [ ] `styles.css` - Mobile styles
  - [ ] `manifest.json` - PWA metadata
  - [ ] `service-worker.js` - Offline support
  - [ ] Generate icons (192px, 512px)
- [ ] Testing (`implementation.md` Phase 3)
  - [ ] Desktop browser test
  - [ ] Mobile browser test (ngrok)
  - [ ] PWA installation test
  - [ ] Multi-client test

### Phase 2: Notifications
- [ ] Backend broadcasting (`notifications_implementation.md` Phase 1)
  - [ ] Broadcast execution events
  - [ ] Broadcast error events
- [ ] PWA notification handling (`notifications_implementation.md` Phase 2)
  - [ ] Request permission
  - [ ] Show browser notifications
  - [ ] Add system messages
  - [ ] Handle execution events
- [ ] Service worker updates (`notifications_implementation.md` Phase 3)
  - [ ] Notification click handler
- [ ] Styling (`notifications_implementation.md` Phase 4)
  - [ ] System message styles
  - [ ] Ren link styles
- [ ] Testing (`notifications_implementation.md` Testing Guide)
  - [ ] Success notification
  - [ ] Error notification
  - [ ] Ren link functionality
  - [ ] Background-only behavior

### Phase 3: Polish
- [ ] Create proper PWA icons
- [ ] Test on iOS Safari
- [ ] Test on Android Chrome
- [ ] Test on actual mobile device (not just emulator)
- [ ] Test over cellular data (not just WiFi)
- [ ] Optimize bundle size
- [ ] Add loading states
- [ ] Add error handling UI

---

## 📊 Project Status

**Current Status**: 🟡 Planning Complete, Ready for Implementation

### Completed
- ✅ Architecture design
- ✅ Code reuse strategy
- ✅ Implementation plan
- ✅ Notification design
- ✅ Documentation

### Next Steps
1. Follow `implementation.md` to build core PWA
2. Follow `notifications_implementation.md` to add notifications
3. Test on mobile device via ngrok
4. Create production icons
5. Deploy and iterate based on usage

---

## 📝 Implementation Time Estimates

**Phase 1 - Core PWA**: 3-4 hours
- Backend changes: 1 hour
- PWA frontend: 2 hours
- Testing: 1 hour

**Phase 2 - Notifications**: 2-3 hours
- Backend broadcasting: 30 minutes
- PWA notification handling: 1 hour
- Service worker updates: 30 minutes
- Styling: 30 minutes
- Testing: 30 minutes

**Phase 3 - Polish**: 2-3 hours
- Icon creation: 1 hour
- Mobile testing: 1 hour
- Bug fixes: 1 hour

**Total**: ~8-10 hours for complete implementation

---

## 🔗 Related Documentation

### FL_JS Project
- [Backend README](../../backend/README.md)
- [Frontend README](../../web/README.md)
- [Agent Documentation](../agents/agent.md)

### PWA Resources
- [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web.dev PWA](https://web.dev/progressive-web-apps/)
- [PWA Builder](https://www.pwabuilder.com/)

### Tools
- [ngrok](https://ngrok.com/) - Secure tunnels to localhost
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - PWA audit tool
- [Workbox](https://developers.google.com/web/tools/workbox) - Service worker library (optional)

---

## 🤔 FAQ

### Why "Ren Go"?

"Go" (行) means "to go/move" in Japanese, fitting with Ren's name (連 - "connection"). It's also a playful reference to "Pokémon Go" - taking your assistant with you wherever you go.

### Why not build a native app?

PWAs offer:
- ✅ Single codebase for iOS and Android
- ✅ No app store approval needed
- ✅ Instant updates
- ✅ Works on desktop too
- ✅ Reuses existing web code
- ✅ Lower maintenance burden

### Can I use this without ngrok?

Yes! Options:
- **Local network**: Access via `http://[your-ip]:8000/pwa` from phone on same WiFi
- **Cloudflare Tunnel**: Free alternative to ngrok
- **Tailscale**: VPN-based access
- **Self-hosted**: Deploy backend to cloud with HTTPS

### Does this work offline?

Partially:
- ✅ PWA assets cached (loads offline)
- ✅ UI works offline
- ❌ WebSocket requires connection
- ❌ Can't chat with Ren offline

Offline mode shows "Connecting..." until backend available.

### Can multiple people use the same session?

Yes! The architecture supports it:
- Person A: ComfyUI on desktop
- Person B: PWA on phone
- Person C: PWA on tablet

All see the same conversation and can send messages. Tool execution happens on Person A's ComfyUI.

### How secure is this?

Current security:
- ⚠️ No authentication (anyone with URL can access)
- ⚠️ No encryption (unless using HTTPS)
- ✅ Session IDs are UUIDs (hard to guess)
- ✅ ngrok provides HTTPS automatically

For production:
- Add authentication (JWT tokens, API keys)
- Use HTTPS always
- Add rate limiting
- Add session passwords

### What about battery life?

WebSocket connections are efficient:
- Minimal battery drain
- Only active when PWA is open
- Notifications use system APIs (very low power)
- Service worker only activates when needed

Typical usage: <5% battery drain per hour of active chatting.

---

## 👏 Credits

Ren Go builds on:
- **FL_JS** - Agentic workflow system
- **Ren** - ComfyUI assistant agent
- **ComfyUI** - Node-based image generation
- **FastAPI** - Backend framework
- **Pydantic AI** - Agent framework

Inspired by the desire to control creative workflows from anywhere, anytime.

---

## 💬 Support

For questions or issues:
1. Check implementation docs in this directory
2. Review backend/frontend READMEs
3. Test with browser dev tools
4. Check WebSocket messages in network tab
5. Review backend logs for errors

Happy building! 🌸
