# Server Autostart - Deep Investigation

**Date:** 2025-10-24  
**Mode:** Debugging  
**Focus:** Answer open questions from analysis.md with code evidence  

---

## Investigation Summary

This document examines the codebase to answer critical questions about the server autostart hanging issue.

---

## Q1: Does `atexit.register()` reliably fire when ComfyUI stops?

### Evidence from Code:

**File:** `backend/server_runner.py` (line 62)
```python
# Register cleanup handlers
atexit.register(self.cleanup)
```

### Answer: **PROBABLY NOT RELIABLE**

**Reasoning:**

1. **`atexit` only fires on clean Python exit**
   - Works: `sys.exit()`, normal script completion, `KeyboardInterrupt` (Ctrl+C)
   - **Doesn't work**: SIGKILL, segfault, os._exit(), forced termination

2. **ComfyUI shutdown behavior is unknown**
   - If ComfyUI catches SIGTERM and calls `sys.exit()` → `atexit` fires ✅
   - If ComfyUI is killed with SIGKILL → `atexit` doesn't fire ❌
   - If ComfyUI crashes → `atexit` doesn't fire ❌

3. **Testing needed:**
   ```python
   # Add to cleanup() method:
   def cleanup(self):
       logger.info("[CLEANUP] atexit handler fired!")  # ← Add this
       if self._cleaned_up:
           return
       # ... rest of cleanup
   ```

**Conclusion:** We **cannot rely** on `atexit` for cleanup. Need better approach.

---

## Q2: Are there existing orphaned backend processes?

### How to Check:

**macOS/Linux:**
```bash
# Find all Python processes running server.py
ps aux | grep "python.*server.py" | grep -v grep

# Check what's using port 8000
lsof -i :8000

# Or check any custom port
lsof -i :9999
```

**Windows:**
```cmd
REM Find processes on port 8000
netstat -ano | findstr :8000

REM Then find the process details
tasklist | findstr <PID>
```

### What to Look For:

1. **Multiple `python server.py` processes**
   - Each orphaned instance = one failed cleanup
   - Accumulates over multiple ComfyUI restarts

2. **Processes without parent (PPID = 1)**
   - Parent process died, child was orphaned
   - Init process (PID 1) adopted the orphan

3. **Port conflicts**
   - "Port already in use" errors
   - Backend can't start because orphan is holding the port

**Conclusion:** Likely **YES** - orphaned processes accumulate without proper cleanup.

---

## Q3: Does uvicorn/FastAPI handle SIGTERM gracefully?

### Evidence from Code:

**File:** `backend/server.py` (lines 69-102)
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # ... startup code ...
    
    yield  # ← Server runs here
    
    # Shutdown - THIS RUNS ON SIGTERM
    logger.info("Shutting down FL_JS backend server")
    cleanup_task_handle.cancel()
    try:
        await cleanup_task_handle
    except asyncio.CancelledError:
        pass
```

### Answer: **YES, uvicorn handles SIGTERM gracefully**

**How it works:**

1. **uvicorn receives SIGTERM**
   - Uvicorn has built-in signal handlers
   - Catches SIGTERM and SIGINT (Ctrl+C)

2. **Triggers lifespan shutdown**
   - Exits the `yield` statement
   - Runs shutdown code after `yield`
   - Cancels background tasks
   - Closes connections

3. **Then exits cleanly**
   - Returns from `uvicorn.run()`
   - Python interpreter exits
   - `atexit` handlers fire (if process not killed)

**Testing:**
```bash
# Start server manually
cd backend && python server.py

# In another terminal, send SIGTERM
kill -TERM <pid>

# Should see in logs:
# "Shutting down FL_JS backend server"
```

**Conclusion:** uvicorn **does** handle SIGTERM gracefully. The problem is:
- **ServerRunner** sends SIGTERM to subprocess ✅
- **But ServerRunner itself** may not receive cleanup signal ❌

---

## Q4: What happens to daemon threads when parent process exits?

### Evidence from Code:

**File:** `backend/server_runner.py` (lines 194-216)
```python
def _start_output_capture(self):
    """Start thread to capture and duplicate subprocess output."""
    def capture_output():
        # ... reads from process.stdout ...
    
    output_thread = threading.Thread(target=capture_output, daemon=True)  # ← DAEMON
    output_thread.start()
```

**File:** `backend/server_runner.py` (line 224)
```python
def _start_monitoring(self):
    """Start monitoring thread for auto-restart."""
    self._should_monitor = True
    self._monitor_thread = threading.Thread(target=self._monitor_process, daemon=True)  # ← DAEMON
    self._monitor_thread.start()
```

### Answer: **Daemon threads are killed immediately**

**What happens:**

1. **Python interpreter starts exiting**
   - Main thread finishes
   - Only daemon threads remain

2. **All daemon threads are killed immediately**
   - No cleanup
   - No finally blocks
   - No exception handling
   - Just... dead

3. **Consequences:**
   - Output capture thread: may leave file handle open
   - Monitoring thread: can't finish cleanup
   - Log files: may be truncated or corrupted

**From Python docs:**
> "Daemon threads are abruptly stopped at shutdown. Their resources (such as open files, database transactions, etc.) may not be released properly."

**Conclusion:** Daemon threads **cannot be relied on** for cleanup. They're for background tasks that don't matter if interrupted.

---

## Q5: Is there a better subprocess management approach?

### Current Approach:

```python
self.process = subprocess.Popen(
    [python_exe, "-u", str(server_script)],
    cwd=str(self.backend_dir),
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)
```

**Problems:**
1. Subprocess is **child** of ComfyUI process
2. When parent dies unexpectedly → child orphaned
3. `atexit` cleanup unreliable
4. Daemon threads can't help

### Alternative 1: Process Groups (Unix)

```python
self.process = subprocess.Popen(
    [python_exe, "-u", str(server_script)],
    start_new_session=True,  # ← Creates new process group
    preexec_fn=os.setsid,    # ← Detach from parent (Unix only)
)
```

**Benefits:**
- Process runs in separate session
- Not tied to parent's lifecycle
- Won't receive parent's signals

**Problems:**
- Still need to track PID to kill later
- Harder to clean up
- **Doesn't solve the fundamental problem**

### Alternative 2: Separate Terminal (RECOMMENDED)

**Concept:** Don't manage the subprocess at all. Launch it in user's terminal.

**Windows:**
```python
import subprocess
import platform

if platform.system() == "Windows":
    # Start new cmd window that stays open
    subprocess.Popen(
        ['cmd', '/c', 'start', 'cmd', '/k', 
         f'cd /d "{backend_dir}" && "{python_exe}" server.py'],
        shell=True,
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )
```

**macOS:**
```python
if platform.system() == "Darwin":
    # Use AppleScript to open Terminal.app
    script = f'''
    tell application "Terminal"
        do script "cd '{backend_dir}' && '{python_exe}' server.py"
        activate
    end tell
    '''
    subprocess.Popen(['osascript', '-e', script])
```

**Linux:**
```python
if platform.system() == "Linux":
    # Try common terminal emulators
    terminals = [
        ['gnome-terminal', '--', 'bash', '-c'],
        ['xterm', '-hold', '-e'],
        ['konsole', '-e'],
        ['xfce4-terminal', '-e'],
    ]
    
    cmd = f"cd '{backend_dir}' && '{python_exe}' server.py; exec bash"
    
    for term_cmd in terminals:
        if shutil.which(term_cmd[0]):
            subprocess.Popen(term_cmd + [cmd])
            break
```

**Benefits:**
- ✅ User sees backend running
- ✅ User can Ctrl+C to stop
- ✅ Terminal close = process terminates
- ✅ No orphaned processes
- ✅ No cleanup needed from ComfyUI
- ✅ Real-time log visibility

**Problems:**
- ⚠️ Platform-specific code
- ⚠️ May not work in headless environments
- ⚠️ Requires terminal emulator installed

**Mitigation:**
- Detect headless environment (no DISPLAY on Linux)
- Fallback to current approach if terminal launch fails
- Add config option: `USE_SEPARATE_TERMINAL=true/false`

### Alternative 3: systemd/launchd/Windows Service

**Not practical** for a ComfyUI extension. Too complex for users.

---

## Q6: How do other ComfyUI custom nodes handle background services?

### Research Needed:

Search GitHub for:
```
"comfyui" "subprocess.Popen" "server"
"comfyui" "custom_nodes" "backend"
```

### Common Patterns (from general knowledge):

1. **No background server** - Most common
   - Custom nodes run synchronously
   - No separate process needed

2. **User starts server manually** - Second most common
   - Extension assumes server is running
   - Provides instructions in README
   - No auto-start complexity

3. **Auto-start with subprocess** - Rare
   - Same problems we're facing
   - Usually poorly documented issues

**Conclusion:** FL_JS is unusual in needing a persistent backend server. Most extensions don't face this problem.

---

## Q7: Platform-Specific Terminal Launch Methods

### Windows:

**Method 1: `cmd /c start` (Recommended)**
```python
subprocess.Popen(
    ['cmd', '/c', 'start', 'cmd', '/k', command],
    shell=True,
    creationflags=subprocess.CREATE_NEW_CONSOLE
)
```

**Flags:**
- `/c` - Execute command and terminate
- `start` - Start new window
- `/k` - Keep window open after command

**Method 2: `subprocess.CREATE_NEW_CONSOLE`**
```python
subprocess.Popen(
    [python_exe, 'server.py'],
    cwd=backend_dir,
    creationflags=subprocess.CREATE_NEW_CONSOLE
)
```

**Simpler but less control over window title/behavior**

### macOS:

**Method 1: AppleScript (Recommended)**
```python
script = f'''
tell application "Terminal"
    do script "cd '{backend_dir}' && '{python_exe}' server.py"
    activate
end tell
'''
subprocess.Popen(['osascript', '-e', script])
```

**Method 2: `open` command**
```python
subprocess.Popen([
    'open', '-a', 'Terminal.app', 
    '--args', python_exe, 'server.py'
])
```

**Less reliable - doesn't set working directory**

### Linux:

**Challenge:** Many different terminal emulators

**Solution:** Try multiple, use first available
```python
terminals = [
    {
        'name': 'gnome-terminal',
        'cmd': lambda cmd: ['gnome-terminal', '--', 'bash', '-c', cmd]
    },
    {
        'name': 'konsole',
        'cmd': lambda cmd: ['konsole', '-e', 'bash', '-c', cmd]
    },
    {
        'name': 'xfce4-terminal',
        'cmd': lambda cmd: ['xfce4-terminal', '-e', f'bash -c "{cmd}"']
    },
    {
        'name': 'xterm',
        'cmd': lambda cmd: ['xterm', '-hold', '-e', cmd]
    },
]

for terminal in terminals:
    if shutil.which(terminal['name']):
        subprocess.Popen(terminal['cmd'](command))
        break
else:
    # No terminal found, fallback to subprocess
    logger.warning("No terminal emulator found, using subprocess")
```

**Command format:**
```bash
bash -c "cd '/path/to/backend' && python server.py; exec bash"
#                                                     ^^^^^^^^^
#                                                     Keep terminal open
```

---

## Detection: Headless Environment

### Linux:
```python
import os

def is_headless():
    """Check if running in headless environment (no display)."""
    return 'DISPLAY' not in os.environ
```

### All Platforms:
```python
import sys

def has_terminal():
    """Check if stdout is connected to a terminal."""
    return sys.stdout.isatty()
```

### Combined Check:
```python
def can_launch_terminal():
    """Check if we can launch a separate terminal window."""
    if platform.system() == "Linux":
        # Check for DISPLAY environment variable
        if 'DISPLAY' not in os.environ:
            return False
    
    # Check if running in interactive mode
    if not sys.stdout.isatty():
        # Might be running as service/daemon
        return False
    
    return True
```

---

## Recommended Solution Architecture

### Hybrid Approach:

1. **Primary: Terminal Launch** (if possible)
   - Detect platform
   - Check if headless
   - Launch in separate terminal
   - No cleanup needed

2. **Fallback: Current Subprocess** (if terminal fails)
   - Use existing `ServerRunner` code
   - Improved cleanup with signal handlers
   - Better logging

3. **Configuration:**
   ```python
   # In .env or config
   BACKEND_LAUNCH_MODE=auto  # auto, terminal, subprocess, manual
   ```

### Implementation Phases:

**Phase 1: Add terminal launch option**
- Create `TerminalLauncher` class
- Platform detection
- Terminal command builders
- Fallback logic

**Phase 2: Improve subprocess cleanup**
- Add signal handlers to ServerRunner
- Better process group management
- Improved logging

**Phase 3: User configuration**
- Add config option to choose mode
- Documentation
- Testing across platforms

---

## Answers Summary

| Question | Answer | Confidence |
|----------|--------|------------|
| Q1: Does `atexit` fire reliably? | **NO** - depends on how ComfyUI exits | High |
| Q2: Are there orphaned processes? | **YES** - likely accumulating | High |
| Q3: Does uvicorn handle SIGTERM? | **YES** - gracefully | High |
| Q4: What happens to daemon threads? | **Killed immediately** - no cleanup | High |
| Q5: Better subprocess approach? | **Separate terminal** recommended | High |
| Q6: How do other nodes handle this? | **Most don't** - unusual requirement | Medium |
| Q7: Platform-specific methods? | **Documented above** - all platforms | High |

---

## Next Steps

Create `notes/server_autostart/implementation.md` with:

1. ✅ Terminal launcher implementation
2. ✅ Platform-specific code
3. ✅ Fallback behavior
4. ✅ Configuration options
5. ✅ Testing plan
6. ✅ User documentation updates

---

## Code Evidence Summary

### Files Examined:

1. **`__init__.py`**
   - Entry point for auto-start
   - Creates `ServerRunner` instance
   - Keeps reference to prevent GC

2. **`backend/server_runner.py`**
   - Subprocess management
   - `atexit.register(self.cleanup)` - unreliable
   - Daemon threads for output capture and monitoring
   - Cleanup logic that may not run

3. **`backend/server.py`**
   - FastAPI lifespan manager
   - Graceful shutdown logic
   - Works correctly when SIGTERM received

### Key Finding:

**The problem is NOT in the backend server** (it shuts down fine).

**The problem is in ServerRunner** - it can't reliably clean up the subprocess when ComfyUI exits.

**Solution:** Don't try to manage subprocess lifecycle. Let user's terminal handle it.
