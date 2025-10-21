# Ren Go - Setup Guide

**Ren Go** is a Progressive Web App for controlling ComfyUI from your mobile phone. This guide will help you set it up.

---

## 📱 What is Ren Go?

Ren Go lets you:
- 💬 Chat with Ren from your phone
- 🎨 Control ComfyUI workflows remotely
- 🔔 Get notified when workflows complete
- 🔗 Use one-tap Ren links for common actions
- 🔄 Connect to any active ComfyUI session

It's the same Ren assistant you know, optimized for mobile.

---

## 🚀 Quick Start

### Prerequisites

1. **FL_JS backend running**
   ```bash
   cd backend
   python server.py
   ```

2. **ComfyUI with FL_JS extension**
   - ComfyUI running at `http://localhost:8188`
   - FL_JS extension installed and enabled
   - Sidebar chat connected to backend

### Option A: Local Network (Easiest)

**Perfect for**: Using Ren Go on same WiFi as your computer

1. **Find your computer's IP address**:
   
   **macOS/Linux**:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
   
   **Windows**:
   ```bash
   ipconfig | findstr IPv4
   ```
   
   Example output: `192.168.1.100`

2. **On your phone's browser**, navigate to:
   ```
   http://192.168.1.100:8000/pwa
   ```
   (Replace `192.168.1.100` with your actual IP)

3. **Select your session** from the list

4. **Start chatting!**

5. **Install to home screen** (optional but recommended):
   - **iOS**: Tap Share → "Add to Home Screen"
   - **Android**: Menu → "Install app" or "Add to Home screen"

**Pros**:
- ✅ No additional setup
- ✅ No external services
- ✅ Fast and reliable
- ✅ Free

**Cons**:
- ❌ Only works on same WiFi network
- ❌ Doesn't work over cellular data
- ❌ No HTTPS (some PWA features limited)

---

### Option B: ngrok (For Remote Access)

**Perfect for**: Accessing Ren Go from anywhere (cellular, different WiFi, etc.)

1. **Install ngrok**:
   
   **macOS** (via Homebrew):
   ```bash
   brew install ngrok/ngrok/ngrok
   ```
   
   **Linux/Windows**: Download from https://ngrok.com/download

2. **Sign up for ngrok** (free): https://dashboard.ngrok.com/signup

3. **Authenticate ngrok**:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```
   (Get your auth token from https://dashboard.ngrok.com/get-started/your-authtoken)

4. **Start ngrok tunnel**:
   ```bash
   ngrok http 8000
   ```
   
   You'll see output like:
   ```
   Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
   ```

5. **On your phone's browser**, navigate to the HTTPS URL:
   ```
   https://abc123.ngrok-free.app/pwa
   ```
   (Use YOUR unique ngrok URL)

6. **Select your session** and start chatting

7. **Install to home screen** for best experience

**Pros**:
- ✅ Works from anywhere (cellular, different WiFi)
- ✅ HTTPS enabled (full PWA features)
- ✅ Easy to set up
- ✅ Free tier available

**Cons**:
- ❌ URL changes each time (unless paid plan)
- ❌ Requires ngrok running
- ❌ Slight latency increase
- ❌ Free tier has connection limits

**Tip**: Keep the ngrok terminal window open. When you close it, the tunnel stops.

---

### Option C: Cloudflare Tunnel (Advanced)

**Perfect for**: Persistent URL without paying for ngrok

1. **Install Cloudflare Tunnel**:
   ```bash
   # macOS
   brew install cloudflare/cloudflare/cloudflared
   
   # Linux/Windows: See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   ```

2. **Authenticate**:
   ```bash
   cloudflared tunnel login
   ```

3. **Create tunnel**:
   ```bash
   cloudflared tunnel create ren-go
   ```

4. **Configure tunnel** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: YOUR_TUNNEL_ID
   credentials-file: /path/to/YOUR_TUNNEL_ID.json
   
   ingress:
     - hostname: ren-go.yourdomain.com
       service: http://localhost:8000
     - service: http_status:404
   ```

5. **Run tunnel**:
   ```bash
   cloudflared tunnel run ren-go
   ```

6. **Access** at `https://ren-go.yourdomain.com/pwa`

**Pros**:
- ✅ Persistent URL
- ✅ Free
- ✅ HTTPS
- ✅ Custom domain

**Cons**:
- ❌ More complex setup
- ❌ Requires Cloudflare account
- ❌ Requires domain name

---

## 🔧 Troubleshooting

### "No active sessions found"

**Problem**: Session picker shows no sessions

**Solutions**:
1. Make sure ComfyUI is running
2. Make sure FL_JS extension is enabled in ComfyUI
3. Open ComfyUI sidebar chat (this creates the session)
4. Tap "Refresh" in Ren Go
5. Check backend logs for errors:
   ```bash
   # In backend directory
   python server.py
   # Look for "Session created" messages
   ```

### "Failed to load sessions"

**Problem**: Can't connect to backend

**Solutions**:
1. Check backend is running: `http://YOUR_IP:8000/health`
2. Check firewall isn't blocking port 8000
3. On local network: Make sure phone and computer on same WiFi
4. On ngrok: Make sure ngrok tunnel is running
5. Try restarting backend

### "Connection lost"

**Problem**: WebSocket disconnects

**Solutions**:
1. Check backend logs for errors
2. Check network connection (WiFi/cellular)
3. Try refreshing the page
4. Return to session picker and reconnect
5. If using ngrok, check tunnel is still running

### PWA won't install

**Problem**: "Add to Home Screen" not showing

**Solutions**:
1. **iOS**: Must use Safari (not Chrome)
2. **Android**: Must use Chrome (not Firefox)
3. Must be served over HTTPS (use ngrok or Cloudflare)
4. Try visiting site multiple times (some browsers require this)
5. Clear browser cache and try again

### Notifications not working

**Problem**: No notifications when workflows complete

**Solutions**:
1. Grant notification permission when prompted
2. Check phone's notification settings for browser
3. Must use HTTPS (ngrok/Cloudflare, not local IP)
4. Try backgrounding the app and queueing a workflow
5. Check browser supports notifications (Safari iOS 16.4+)

### Can't see messages from ComfyUI

**Problem**: Messages sent from ComfyUI sidebar don't appear in PWA

**Solutions**:
1. Make sure both connected to same session
2. Check session ID matches (visible in ComfyUI sidebar)
3. Try refreshing PWA
4. Check backend logs for message routing
5. Reconnect from session picker

### Images not loading

**Problem**: Ren mentions images but they don't display

**Solutions**:
1. This is expected - image serving not yet implemented
2. Workaround: Ask Ren to describe the image
3. Or check ComfyUI on desktop to see image
4. Image gallery feature planned for future

---

## 📱 Using Ren Go

### Session Picker

When you first open Ren Go, you'll see available sessions:

```
┌──────────────────────────────┐
│ abc12345...                    │
│ 💻 ComfyUI  📱 Mobile          │
│ Last active: 2m ago            │
│                 [Connect →]    │
└──────────────────────────────┘
```

- **Session ID**: First 8 characters of session UUID
- **💻 ComfyUI**: ComfyUI frontend connected
- **📱 Mobile**: PWA already connected (you or someone else)
- **Last active**: When session last received a message
- **Connect**: Tap to join this session

**Tip**: You can connect to the same session from multiple devices!

### Chat Interface

After connecting, you'll see the familiar chat interface:

```
┌──────────────────────────────┐
│ Ren 🌸                        │
│ 🟢 Connected                   │
├──────────────────────────────┤
│                                │
│ [Message history appears here] │
│                                │
├──────────────────────────────┤
│ Type a message...          👉 │
└──────────────────────────────┘
```

**Try saying**:
- "Generate a sunset landscape"
- "Show me the current workflow"
- "What's in the queue?"
- "Explain the KSampler settings"
- "Help me debug the last error"

### Notifications

When a workflow completes (and PWA is backgrounded):

1. **Phone buzzes** with notification:
   ```
   ✨ Workflow Complete!
   Finished in 30.0s
   ```

2. **Tap notification** to open PWA

3. **See system message** in chat:
   ```
   ✅ Workflow completed successfully in 30.0s
   
   [Show me the output](ren://message)
   ```

4. **Tap Ren link** to see results

Same for errors:
```
⚠️ Workflow error in node 7

Type: KSampler
Error: Required input 'model' not connected

[Help me debug this](ren://message)
```

### Ren Links

Ren links are **one-tap actions**:

- Tap the blue link → Sends that message to Ren
- No typing needed
- Perfect for mobile

**Common Ren links**:
- `[Show me the output](ren://message)` - View generated images
- `[Help me debug this](ren://message)` - Get debugging help
- `[Queue it again](ren://message)` - Re-run last workflow
- `[What went wrong?](ren://message)` - Analyze errors

---

## 🔒 Security Considerations

### Current Security Level

⚠️ **Ren Go has minimal security** in the current implementation:

- ❌ No authentication (anyone with URL can access)
- ❌ No encryption (unless using HTTPS)
- ✅ Session IDs are random UUIDs (hard to guess)
- ✅ ngrok/Cloudflare provide HTTPS

### Recommendations

**For personal use** (you controlling your own ComfyUI):
- ✅ Local network is fine (no internet exposure)
- ✅ ngrok is fine (URL is secret, changes frequently)
- ✅ Don't share your ngrok URL publicly

**For shared/production use**:
- ⚠️ Add authentication (JWT tokens, passwords)
- ⚠️ Use HTTPS always
- ⚠️ Add rate limiting
- ⚠️ Add session passwords
- ⚠️ Use firewall rules

### ngrok Security

ngrok URLs are:
- ✅ HTTPS by default (encrypted)
- ✅ Hard to guess (random subdomain)
- ✅ Can add password protection (paid plans)
- ❌ Anyone with URL can access
- ❌ URL visible in ngrok web interface (unless paid)

**Best practice**: Treat ngrok URL like a password. Don't share it publicly.

---

## ⚙️ Advanced Configuration

### Custom Backend URL

By default, PWA connects to same host it's served from. To use a different backend:

**Edit `web/pwa/app.js`**:
```javascript
getBackendUrl() {
    // Force specific backend URL
    return 'wss://your-backend.example.com/ws';
    
    // Or use environment variable (requires build step)
    // return process.env.BACKEND_URL || this.getDefaultUrl();
}
```

### Persistent ngrok URL

ngrok free tier gives random URLs. For persistent URL:

1. **Upgrade to ngrok paid plan** ($8/month)
2. **Reserve domain**: `your-name.ngrok.io`
3. **Use reserved domain**:
   ```bash
   ngrok http 8000 --domain=your-name.ngrok.io
   ```

Now URL never changes!

### Service Worker Cache

To update cached PWA files after changes:

**Edit `web/pwa/service-worker.js`**:
```javascript
// Change version number
const CACHE_NAME = 'ren-pwa-v2';  // Was v1
```

Users will get update on next visit.

### Notification Customization

**Edit `web/pwa/app.js`** in `showNotification()` method:

```javascript
showNotification(title, options = {}) {
    const notification = new Notification(title, {
        icon: '/pwa/static/icons/icon-192.png',
        badge: '/pwa/static/icons/icon-192.png',
        vibrate: [200, 100, 200],  // Custom vibration pattern
        requireInteraction: false,  // Auto-dismiss
        silent: false,              // Play sound
        ...options
    });
}
```

---

## 📊 Performance Tips

### Reduce Data Usage

1. **Service worker caches** most assets (loads once)
2. **WebSocket** is efficient (minimal overhead)
3. **Images** not loaded in PWA (saves bandwidth)
4. **Markdown** rendering is client-side (no server load)

Typical usage: ~1MB initial load, ~10KB per message.

### Battery Optimization

1. **Close PWA** when not using (swipe away from app switcher)
2. **WebSocket** auto-reconnects (no need to keep open)
3. **Notifications** use system APIs (very low power)
4. **Service worker** only activates when needed

Typical battery usage: <5% per hour of active chatting.

### Connection Stability

**WiFi**:
- Very stable
- Low latency (<50ms)
- Best for real-time chat

**Cellular (4G/5G)**:
- Stable but higher latency (100-300ms)
- May disconnect when switching towers
- WebSocket auto-reconnects
- Works fine for chat (not as real-time)

**Tip**: PWA shows connection status in header (🟢 Connected / 🔴 Disconnected)

---

## 📚 Further Reading

### Documentation
- [Implementation Guide](../../notes/pwa/implementation.md) - Full technical details
- [Notifications Guide](../../notes/pwa/notifications_implementation.md) - Notification system
- [Architecture Overview](../../notes/pwa/investigation.md) - How it works
- [Original Concept](../../notes/pwa/idea.md) - Design philosophy

### PWA Resources
- [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web.dev PWA](https://web.dev/progressive-web-apps/)
- [Can I Use - PWA](https://caniuse.com/web-app-manifest)

### Tools
- [ngrok Documentation](https://ngrok.com/docs)
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Lighthouse PWA Audit](https://developers.google.com/web/tools/lighthouse)

---

## ❓ FAQ

### Can I use this on iOS?

**Yes!** iOS 16.4+ supports PWAs with notifications.

- ✅ Safari required (not Chrome)
- ✅ Add to Home Screen works
- ✅ Notifications work (with HTTPS)
- ✅ Offline support works
- ❌ Some PWA features limited vs Android

### Can I use this on Android?

**Yes!** Android has excellent PWA support.

- ✅ Chrome recommended
- ✅ Full PWA features
- ✅ Notifications work great
- ✅ Can set as default handler
- ✅ Offline support works

### Does this work on iPad/tablet?

**Yes!** Works on any device with a modern browser.

- iPads use iOS Safari (same as iPhone)
- Android tablets use Chrome (same as phone)
- Larger screen = more comfortable typing

### Can multiple people share a session?

**Yes!** The architecture supports multiple clients:

- Person A: ComfyUI on desktop
- Person B: PWA on phone  
- Person C: PWA on tablet

All see same conversation, all can send messages. Tool execution happens on Person A's ComfyUI.

### What happens if I lose connection?

1. PWA shows "🔴 Disconnected" in header
2. Can still type messages (queued locally)
3. WebSocket auto-reconnects (up to 10 attempts)
4. Once reconnected, queued messages send
5. If max attempts reached, shows error + return to session picker

### How do I update the PWA?

PWA updates automatically:

1. Service worker checks for updates
2. Downloads new version in background
3. Activates on next visit
4. No user action needed!

To force update: Close and reopen PWA.

### Can I use this without ComfyUI?

**No.** Ren Go requires:
- FL_JS backend running
- ComfyUI with FL_JS extension
- Active session from ComfyUI frontend

Without these, session picker shows "No active sessions".

### How much data does this use?

**Initial load**: ~1-2MB (cached by service worker)
**Per message**: ~5-10KB (text only)
**Per image** (if implemented): ~500KB-2MB

Typical hour of chatting: ~1-2MB total.

---

## 🐛 Known Issues

### iOS Safari
- ⚠️ Notifications require iOS 16.4+ (older versions don't support)
- ⚠️ Must use Safari (Chrome on iOS doesn't support PWA install)
- ⚠️ Service worker has limitations vs Android

### Android Chrome
- ✅ Generally works great
- ⚠️ Some manufacturers (Samsung, Xiaomi) have aggressive battery optimization
- ⚠️ May need to whitelist browser in battery settings

### Local Network (HTTP)
- ⚠️ Some PWA features require HTTPS (notifications, service worker)
- ⚠️ Use ngrok/Cloudflare for full functionality
- ✅ Chat works fine over HTTP

### Image Display
- ❌ Image gallery not yet implemented
- ❌ Ren can mention images but can't display them
- 🚧 Planned for future release

---

## 🚀 Next Steps

1. **Choose your setup method** (local network or ngrok)
2. **Follow the steps** in the relevant section above
3. **Test on your phone**
4. **Install to home screen** for best experience
5. **Grant notification permission**
6. **Start chatting with Ren!**

Enjoy controlling ComfyUI from anywhere! 🌸

---

## 💬 Support

If you run into issues:

1. Check **Troubleshooting** section above
2. Review backend logs for errors
3. Check browser console (F12) for errors
4. Verify WebSocket connection in Network tab
5. Try restarting backend and refreshing PWA

For bugs or feature requests, see main project documentation.
