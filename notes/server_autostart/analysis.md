# Server Autostart Hanging Issue - Analysis

**Date:** 2025-10-24  
**Mode:** Research  
**Focus:** Understanding why backend server process hangs when ComfyUI stops  

---

## Problem Statement

When ComfyUI auto-starts the FL_JS backend server (via `__init__.py` → `ServerRunner`), the process exhibits problematic behavior:

### Observed Issues:

1. **Process hangs when ComfyUI stops**
   - Backend server process doesn't terminate cleanly
   - Port remains occupied
   - Requires manual kill to free the port

2. **Lost terminal/output visibility**
   - Server runs in subprocess without visible terminal
   - Users can't see backend logs in real-time
   - Difficult to debug issues

3. **Unclear process state**
   - User doesn't know if server is running
   - Can't easily restart or monitor the backend
   - No visual feedback about server health

---

## Current Implementation Overview

### Startup Flow:

```
ComfyUI starts
    ↓
__init__.py loads (custom node initialization)
    ↓
Imports backend.config.settings (reads .env)
    ↓
if AUTO_START_BACKEND == true:
    ↓
ServerRunner.__init__(
    backend_dir="backend/",
    port=settings.ws_port,
    auto_start=True,
    auto_restart=True,
    log_to_file=True
)
    ↓
ServerRunner.start()
    ↓
subprocess.Popen(
    [python, "-u", "backend/server.py"],
    cwd="backend/",
    stdout=PIPE,
    stderr=STDOUT
)
    ↓
Output capture thread (writes to file + stdout)
    ↓
Monitoring thread (auto-restart on crash)
```

### Key Components:

**File:** `__init__.py`
- Detects if running within ComfyUI (always true for custom nodes)
- Imports `ServerRunner` if `AUTO_START_BACKEND=true`
- Keeps reference to prevent garbage collection: `_FL_JS_SERVER = server_runner`
- Registers cleanup via `atexit.register(self.cleanup)`

**File:** `backend/server_runner.py`
- Creates subprocess with `subprocess.Popen()`
- Captures output via `stdout=PIPE`
- Spawns background threads:
  - Output capture thread (daemon)
  - Monitoring thread for auto-restart (daemon)
- Cleanup registered with `atexit.register(self.cleanup)`

---

## Root Cause Hypotheses

### Hypothesis 1: Daemon Threads Don't Prevent Process Exit ✅ (Likely)

**Evidence:**
- Both output capture and monitoring threads are `daemon=True`
- Daemon threads don't prevent Python interpreter from exiting
- When ComfyUI stops, Python exits immediately
- Subprocess is **not** a daemon (can't be) - it's a separate OS process
- `atexit` handlers may not run reliably on abrupt shutdown

**Why this causes hanging:**
- ComfyUI exits → Python interpreter exits
- `atexit.register(self.cleanup)` may not fire
- Subprocess is **orphaned** (parent dies, child keeps running)
- Backend server continues running without parent process
- Port stays occupied

### Hypothesis 2: Subprocess Not Properly Terminated ✅ (Likely)

**Evidence:**
```python
# In cleanup():
self.process.terminate()  # Sends SIGTERM
self.process.wait(timeout=5)  # Waits 5 seconds
if timeout:
    self.process.kill()  # Sends SIGKILL
```

**Potential issues:**
- If `atexit` doesn't fire, cleanup never runs
- If cleanup runs but FastAPI/uvicorn doesn't respond to SIGTERM quickly
- If subprocess is in a blocking state (waiting on I/O)

### Hypothesis 3: Output Capture Thread Blocks Cleanup ⚠️ (Possible)

**Evidence:**
```python
for line in iter(self.process.stdout.readline, ''):
    # Blocking read on stdout
```

**Potential issues:**
- Thread is reading from `process.stdout` in blocking mode
- If subprocess doesn't close stdout cleanly, thread hangs forever
- Daemon thread won't prevent exit, but may delay cleanup

### Hypothesis 4: No Terminal = No Visibility ✅ (Confirmed)

**Evidence:**
- Subprocess runs with `stdout=PIPE`
- Output is captured and written to file
- User sees `[FL_JS Backend] ...` prefixed logs in ComfyUI console
- But no separate terminal window

**Why this is a problem:**
- Users can't see real-time backend activity
- Can't interact with backend (no stdin)
- Difficult to debug issues
- No visual confirmation that backend is running

---

## Comparison: Manual vs Auto-Start

### Manual Start (Works Perfectly):

```bash
cd backend
python server.py
```

**Behavior:**
- Runs in user's terminal
- User sees all output immediately
- Ctrl+C cleanly stops server
- Terminal closes → process terminates
- No orphaned processes

### Auto-Start (Current Implementation):

```python
subprocess.Popen([python, "server.py"], stdout=PIPE, ...)
```

**Behavior:**
- Runs as subprocess of ComfyUI
- Output captured via PIPE
- No terminal visible to user
- ComfyUI exit → cleanup may not run → process orphaned
- User has no control over process

---

## Proposed Solution: Launch Separate Terminal

### Concept:

Instead of `subprocess.Popen()` with captured output, **launch backend in its own terminal window**.

### Benefits:

1. **Visibility** - User sees backend running in separate window
2. **Control** - User can Ctrl+C to stop backend independently
3. **Clean shutdown** - Terminal close → process terminates naturally
4. **No orphaning** - Backend is independent process, not child of ComfyUI
5. **Debugging** - User can see errors/logs in real-time
6. **User awareness** - Clear visual indicator that backend is running

### Platform-Specific Commands:

**Windows:**
```python
subprocess.Popen(
    ['cmd', '/c', 'start', 'cmd', '/k', f'cd {backend_dir} && {python} server.py'],
    shell=True
)
```

**macOS:**
```python
subprocess.Popen([
    'osascript', '-e',
    f'tell app "Terminal" to do script "cd {backend_dir} && {python} server.py"'
])
```

**Linux:**
```python
# Try gnome-terminal, then xterm, then konsole
for terminal in ['gnome-terminal', 'xterm', 'konsole']:
    if shutil.which(terminal):
        subprocess.Popen([terminal, '--', 'bash', '-c', f'cd {backend_dir} && {python} server.py'])
        break
```

---

## Open Questions for Investigation

### Q1: Does `atexit.register()` reliably fire when ComfyUI stops?

**Why it matters:**
- If `atexit` doesn't fire, cleanup never runs
- Subprocess is orphaned

**How to verify:**
- Add logging to `cleanup()` method
- Check if cleanup logs appear when ComfyUI exits
- Test both graceful shutdown and forced termination

### Q2: Are there existing orphaned backend processes?

**Why it matters:**
- Multiple orphaned processes could occupy different ports
- Could explain "port in use" errors

**How to verify:**
- Check running processes: `ps aux | grep "python.*server.py"`
- Check port usage: `lsof -i :8000` (macOS/Linux) or `netstat -ano | findstr :8000` (Windows)

### Q3: Does uvicorn/FastAPI handle SIGTERM gracefully?

**Why it matters:**
- If uvicorn doesn't respond to SIGTERM, `process.terminate()` won't work
- Would require SIGKILL, which is less clean

**How to verify:**
- Test manual SIGTERM: `kill -TERM <pid>`
- Check if server shuts down gracefully
- Look for shutdown handlers in `backend/server.py`

### Q4: What happens to daemon threads when parent process exits?

**Why it matters:**
- Daemon threads are killed immediately on exit
- May not finish writing logs
- May leave file handles open

**How to verify:**
- Check if log files are properly closed after ComfyUI exit
- Look for truncated log entries

### Q5: Is there a better subprocess management approach?

**Why it matters:**
- Maybe we shouldn't use `subprocess.Popen()` at all
- Could use process groups, `nohup`, or systemd-style management

**Alternatives to investigate:**
- `subprocess.Popen(start_new_session=True)` - Creates new process group
- `nohup` wrapper - Immune to hangups
- `screen` or `tmux` - Terminal multiplexer (keeps session alive)
- Platform-specific service managers

### Q6: How do other ComfyUI custom nodes handle background services?

**Why it matters:**
- There may be established patterns in the ComfyUI ecosystem
- Could learn from existing solutions

**How to investigate:**
- Search for ComfyUI custom nodes that run backend servers
- Look at their subprocess management code
- Check ComfyUI documentation for best practices

---

## Detection: Are We Running in ComfyUI?

### Current Detection:

```python
# In __init__.py:
if AUTO_START:
    # This code only runs if __init__.py is loaded
    # __init__.py only loads if we're a ComfyUI custom node
    # Therefore: we're ALWAYS in ComfyUI when this runs
```

**Conclusion:** We're always in ComfyUI context when auto-start triggers.

### Additional Detection Methods (if needed):

```python
# Check for ComfyUI in parent process
import psutil
parent = psutil.Process().parent()
if 'comfyui' in parent.name().lower():
    # Running under ComfyUI
```

```python
# Check for ComfyUI-specific environment variables
if 'COMFYUI_PATH' in os.environ:
    # Running under ComfyUI
```

---

## Next Steps

**Investigation needed (`investigation.md`):**

1. ✅ Verify `atexit` behavior when ComfyUI stops
2. ✅ Check for orphaned backend processes
3. ✅ Test SIGTERM handling in uvicorn/FastAPI
4. ✅ Examine daemon thread cleanup behavior
5. ✅ Research alternative subprocess management approaches
6. ✅ Look at how other ComfyUI extensions handle background services
7. ✅ Determine best terminal launch method per platform

**After investigation, create `implementation.md` with:**
- Chosen approach (terminal launch vs other solution)
- Platform-specific implementation details
- Fallback behavior if terminal launch fails
- Configuration options for users
- Testing plan

---

## Risk Assessment

### Current Risk: **HIGH**

**Problems:**
- Orphaned processes accumulate
- Ports get blocked
- Users must manually kill processes
- Poor user experience
- Difficult to debug

### Proposed Solution Risk: **LOW**

**Benefits:**
- Natural process lifecycle
- Better visibility
- User control
- Clean shutdown

**Potential issues:**
- Platform-specific code complexity
- May not work in headless environments (servers)
- Terminal emulator availability varies

**Mitigation:**
- Fallback to current approach if terminal launch fails
- Add configuration option: `USE_SEPARATE_TERMINAL=true/false`
- Detect headless environment and skip terminal launch
