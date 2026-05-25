# Server Autostart - Implementation Plan

**Date:** 2025-10-24  
**Mode:** Design → Implementation  
**Focus:** Terminal launch solution with subprocess fallback  

---

## Implementation Summary

Replace the current subprocess-managed backend with a **terminal launch** approach that:
1. ✅ Launches backend in user's native terminal (primary)
2. ✅ Falls back to current subprocess approach (if terminal fails)
3. ✅ Handles all platforms (Windows/macOS/Linux)
4. ✅ Preserves venv context via `sys.executable`
5. ✅ Requires no cleanup (terminal close = process terminates)
6. ✅ Provides real-time log visibility

---

## Architecture Overview

### New Class: `TerminalLauncher`

**Purpose:** Platform-specific terminal window launching

**Responsibilities:**
- Detect platform (Windows/macOS/Linux)
- Detect headless environment
- Build platform-specific terminal commands
- Launch backend in separate terminal
- Handle launch failures gracefully

### Updated Class: `ServerRunner`

**Changes:**
- Add `launch_mode` parameter: `"auto"`, `"terminal"`, `"subprocess"`, `"manual"`
- Integrate `TerminalLauncher` for terminal mode
- Keep existing subprocess logic as fallback
- Simplified cleanup (no subprocess = no cleanup needed)

### Configuration

**New `.env` options:**
```bash
# Backend launch mode
BACKEND_LAUNCH_MODE=auto  # auto, terminal, subprocess, manual

# Existing options (unchanged)
AUTO_START_BACKEND=true
AUTO_RESTART_BACKEND=true  # Only applies to subprocess mode
LOG_BACKEND_TO_FILE=true   # Only applies to subprocess mode
WS_PORT=8000
```

**Mode behaviors:**
- `auto`: Try terminal, fallback to subprocess
- `terminal`: Terminal only, fail if can't launch
- `subprocess`: Current behavior (managed subprocess)
- `manual`: Don't auto-start (user starts manually)

---

## File Structure

```
backend/
├── server_runner.py          # UPDATED: Add launch_mode logic
├── terminal_launcher.py      # NEW: Platform-specific terminal launching
├── server.py                 # UNCHANGED
└── config.py                 # UPDATED: Add backend_launch_mode setting

__init__.py                   # UPDATED: Use new launch_mode
.env                          # UPDATED: Add BACKEND_LAUNCH_MODE
```

---

## Implementation Details

### 1. Create `backend/terminal_launcher.py`

```python
"""Platform-specific terminal launcher for FL_JS backend."""

import sys
import os
import platform
import subprocess
import shutil
from typing import Optional, Tuple
from pathlib import Path
import logging


class TerminalLauncher:
    """Launch backend server in a separate terminal window.
    
    Supports:
    - Windows: cmd.exe
    - macOS: Terminal.app via AppleScript
    - Linux: gnome-terminal, konsole, xfce4-terminal, xterm
    """
    
    def __init__(self, backend_dir: Path, python_exe: str, port: int):
        """Initialize terminal launcher.
        
        Args:
            backend_dir: Path to backend directory
            python_exe: Full path to Python executable (from sys.executable)
            port: Port number for server
        """
        self.backend_dir = backend_dir
        self.python_exe = python_exe
        self.port = port
        self.logger = logging.getLogger("FL_JS.TerminalLauncher")
    
    def can_launch_terminal(self) -> Tuple[bool, str]:
        """Check if we can launch a terminal window.
        
        Returns:
            (can_launch, reason) tuple
        """
        system = platform.system()
        
        # Check for headless environment on Linux
        if system == "Linux":
            if 'DISPLAY' not in os.environ:
                return False, "Headless environment (no DISPLAY)"
        
        # Check if running in interactive mode
        if not sys.stdout.isatty():
            # Might be running as service/daemon
            # But this is OK - we can still try to launch terminal
            pass
        
        # Check platform support
        if system not in ["Windows", "Darwin", "Linux"]:
            return False, f"Unsupported platform: {system}"
        
        # On Linux, check for available terminal emulator
        if system == "Linux":
            if not self._find_linux_terminal():
                return False, "No terminal emulator found"
        
        return True, "OK"
    
    def _find_linux_terminal(self) -> Optional[str]:
        """Find available terminal emulator on Linux.
        
        Returns:
            Terminal command name or None
        """
        terminals = [
            'gnome-terminal',
            'konsole',
            'xfce4-terminal',
            'xterm',
        ]
        
        for term in terminals:
            if shutil.which(term):
                return term
        
        return None
    
    def launch(self) -> Tuple[bool, str]:
        """Launch backend in terminal window.
        
        Returns:
            (success, message) tuple
        """
        # Check if we can launch
        can_launch, reason = self.can_launch_terminal()
        if not can_launch:
            return False, f"Cannot launch terminal: {reason}"
        
        system = platform.system()
        
        try:
            if system == "Windows":
                return self._launch_windows()
            elif system == "Darwin":
                return self._launch_macos()
            elif system == "Linux":
                return self._launch_linux()
            else:
                return False, f"Unsupported platform: {system}"
        
        except Exception as e:
            return False, f"Launch failed: {e}"
    
    def _launch_windows(self) -> Tuple[bool, str]:
        """Launch backend in Windows cmd.exe.
        
        Returns:
            (success, message) tuple
        """
        # Build command
        # Use /k to keep window open after command
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        cmd = (
            f'cd /d "{backend_dir_str}" && '
            f'"{python_exe_str}" server.py'
        )
        
        # Launch new cmd window
        # creationflags=CREATE_NEW_CONSOLE opens new window
        subprocess.Popen(
            ['cmd', '/c', 'start', 'FL_JS Backend', 'cmd', '/k', cmd],
            shell=True,
            creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, 'CREATE_NEW_CONSOLE') else 0,
        )
        
        return True, "Launched in new cmd window"
    
    def _launch_macos(self) -> Tuple[bool, str]:
        """Launch backend in macOS Terminal.app.
        
        Returns:
            (success, message) tuple
        """
        # Build AppleScript to open Terminal
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        script = f'''
tell application "Terminal"
    do script "cd '{backend_dir_str}' && '{python_exe_str}' server.py"
    activate
end tell
'''
        
        # Execute AppleScript
        subprocess.Popen(['osascript', '-e', script])
        
        return True, "Launched in Terminal.app"
    
    def _launch_linux(self) -> Tuple[bool, str]:
        """Launch backend in Linux terminal emulator.
        
        Returns:
            (success, message) tuple
        """
        terminal = self._find_linux_terminal()
        if not terminal:
            return False, "No terminal emulator found"
        
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        # Build command that keeps terminal open
        cmd = f"cd '{backend_dir_str}' && '{python_exe_str}' server.py; exec bash"
        
        # Terminal-specific command building
        if terminal == 'gnome-terminal':
            # gnome-terminal requires -- before bash command
            subprocess.Popen(
                ['gnome-terminal', '--title=FL_JS Backend', '--', 'bash', '-c', cmd]
            )
        elif terminal == 'konsole':
            subprocess.Popen(
                ['konsole', '--title', 'FL_JS Backend', '-e', 'bash', '-c', cmd]
            )
        elif terminal == 'xfce4-terminal':
            subprocess.Popen(
                ['xfce4-terminal', '--title=FL_JS Backend', '-e', f'bash -c "{cmd}"']
            )
        elif terminal == 'xterm':
            subprocess.Popen(
                ['xterm', '-title', 'FL_JS Backend', '-hold', '-e', cmd]
            )
        else:
            return False, f"Unknown terminal: {terminal}"
        
        return True, f"Launched in {terminal}"
```

---

### 2. Update `backend/config.py`

**Add new setting:**

```python
class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # ... existing settings ...
    
    # === Backend Launch Configuration ===
    backend_launch_mode: Literal["auto", "terminal", "subprocess", "manual"] = "auto"
    auto_start_backend: bool = True  # Existing
    auto_restart_backend: bool = True  # Existing (only for subprocess mode)
    log_backend_to_file: bool = True  # Existing (only for subprocess mode)
```

---

### 3. Update `backend/server_runner.py`

**Changes:**

1. Add `launch_mode` parameter to `__init__`
2. Add `_launch_in_terminal()` method
3. Update `start()` to choose launch method
4. Simplify cleanup (no subprocess in terminal mode)

**Key modifications:**

```python
from typing import Optional, Literal
from backend.terminal_launcher import TerminalLauncher

class ServerRunner:
    """Manages FL_JS FastAPI backend server subprocess."""
    
    def __init__(
        self,
        backend_dir: str,
        port: int = 8000,
        launch_mode: Literal["auto", "terminal", "subprocess", "manual"] = "auto",
        auto_start: bool = True,
        auto_restart: bool = True,
        log_to_file: bool = True,
    ):
        """Initialize server runner.
        
        Args:
            backend_dir: Path to backend directory containing server.py
            port: Port to run server on
            launch_mode: How to launch backend (auto/terminal/subprocess/manual)
            auto_start: Whether to start server immediately
            auto_restart: Whether to restart server if it crashes (subprocess only)
            log_to_file: Whether to log server output to file (subprocess only)
        """
        self.backend_dir = Path(backend_dir).resolve()
        self.port = port
        self.launch_mode = launch_mode
        self.auto_restart = auto_restart
        self.log_to_file = log_to_file
        
        # Track which mode was actually used
        self.active_mode: Optional[str] = None
        
        # Subprocess tracking (only used in subprocess mode)
        self.process: Optional[subprocess.Popen] = None
        self.log_file_handle: Optional[object] = None
        self._cleaned_up = False
        self._should_monitor = False
        self._monitor_thread: Optional[threading.Thread] = None
        
        # Setup logging
        self.logger = logging.getLogger("FL_JS.ServerRunner")
        
        # Register cleanup handlers (only needed for subprocess mode)
        atexit.register(self.cleanup)
        
        if auto_start and launch_mode != "manual":
            self.start()
    
    def start(self) -> bool:
        """Start the FastAPI backend server.
        
        Returns:
            True if started successfully, False otherwise
        """
        # Check if already running (subprocess mode)
        if self.process is not None:
            print("[FL_JS] Backend already running (subprocess)")
            return True
        
        # Check port availability
        if self.is_port_in_use():
            print(f"[FL_JS] Port {self.port} already in use.")
            print(f"[FL_JS] If you're running the backend manually, this is OK.")
            print(f"[FL_JS] Otherwise, change WS_PORT in .env or stop the conflicting service.")
            return False
        
        # Determine launch method
        if self.launch_mode == "manual":
            print("[FL_JS] Manual launch mode - not starting backend")
            return False
        
        elif self.launch_mode == "terminal":
            return self._launch_in_terminal(fallback=False)
        
        elif self.launch_mode == "subprocess":
            return self._launch_as_subprocess()
        
        elif self.launch_mode == "auto":
            # Try terminal first, fallback to subprocess
            return self._launch_in_terminal(fallback=True)
        
        else:
            print(f"[FL_JS] Unknown launch mode: {self.launch_mode}")
            return False
    
    def _launch_in_terminal(self, fallback: bool = True) -> bool:
        """Launch backend in separate terminal window.
        
        Args:
            fallback: If True, fallback to subprocess on failure
        
        Returns:
            True if started successfully, False otherwise
        """
        print(f"[FL_JS] Attempting to launch backend in terminal window...")
        
        # Create launcher
        launcher = TerminalLauncher(
            backend_dir=self.backend_dir,
            python_exe=sys.executable,
            port=self.port,
        )
        
        # Try to launch
        success, message = launcher.launch()
        
        if success:
            print(f"[FL_JS] {message}")
            print(f"[FL_JS] Backend starting on port {self.port}...")
            print(f"[FL_JS] Check the terminal window for logs")
            print(f"[FL_JS] Close the terminal window to stop the backend")
            
            self.active_mode = "terminal"
            
            # Wait for server to be ready
            if self.wait_for_server(timeout=15):
                print(f"[FL_JS] Backend server started successfully!")
                return True
            else:
                print("[FL_JS] Backend server failed to start (timeout)")
                print("[FL_JS] Check the terminal window for errors")
                return False
        
        else:
            print(f"[FL_JS] Terminal launch failed: {message}")
            
            if fallback:
                print("[FL_JS] Falling back to subprocess mode...")
                return self._launch_as_subprocess()
            else:
                return False
    
    def _launch_as_subprocess(self) -> bool:
        """Launch backend as managed subprocess (current behavior).
        
        Returns:
            True if started successfully, False otherwise
        """
        # This is the EXISTING start() logic
        # Just moved to separate method
        
        try:
            # Use same Python as ComfyUI
            python_exe = sys.executable
            server_script = self.backend_dir / "server.py"
            
            if not server_script.exists():
                print(f"[FL_JS] Error: server.py not found at {server_script}")
                print(f"[FL_JS] Backend directory: {self.backend_dir}")
                return False
            
            print(f"[FL_JS] Starting backend server (subprocess mode) on port {self.port}...")
            
            # Setup log file
            self.log_file_handle = self._setup_log_file()
            
            # Determine stdout/stderr
            if self.log_file_handle:
                stdout_dest = subprocess.PIPE
                stderr_dest = subprocess.STDOUT
            else:
                stdout_dest = None
                stderr_dest = None
            
            # Start subprocess
            self.process = subprocess.Popen(
                [python_exe, "-u", str(server_script)],
                cwd=str(self.backend_dir),
                stdout=stdout_dest,
                stderr=stderr_dest,
                bufsize=1,
                universal_newlines=True,
            )
            
            self.active_mode = "subprocess"
            
            # If logging to file, start output capture thread
            if self.log_file_handle and self.process.stdout:
                self._start_output_capture()
            
            # Wait for server to be ready
            if self.wait_for_server(timeout=15):
                print(f"[FL_JS] Backend server started successfully! (PID: {self.process.pid})")
                
                # Start monitoring thread if auto-restart enabled
                if self.auto_restart:
                    self._start_monitoring()
                
                return True
            else:
                print("[FL_JS] Backend server failed to start (timeout)")
                print("[FL_JS] Check backend/logs/server.log for errors")
                self.cleanup()
                return False
        
        except Exception as e:
            print(f"[FL_JS] Failed to start backend server: {e}")
            self.cleanup()
            return False
    
    # ... rest of existing methods (wait_for_server, cleanup, etc.) ...
    # These remain UNCHANGED
    
    def cleanup(self):
        """Terminate the backend server process (subprocess mode only)."""
        if self._cleaned_up:
            return
        
        self._cleaned_up = True
        
        # Stop monitoring
        self._should_monitor = False
        
        # Only cleanup subprocess if we launched in subprocess mode
        if self.active_mode == "subprocess" and self.process is not None:
            try:
                print(f"[FL_JS] Terminating backend server (PID: {self.process.pid})...")
                
                # Try graceful termination first
                self.process.terminate()
                
                # Wait up to 5 seconds for graceful shutdown
                try:
                    self.process.wait(timeout=5)
                    print("[FL_JS] Backend server terminated gracefully")
                except subprocess.TimeoutExpired:
                    print("[FL_JS] Backend server did not terminate, killing...")
                    self.process.kill()
                    self.process.wait()
                    print("[FL_JS] Backend server killed")
            
            except Exception as e:
                print(f"[FL_JS] Error during cleanup: {e}")
            
            finally:
                self.process = None
        
        elif self.active_mode == "terminal":
            # No cleanup needed for terminal mode
            print("[FL_JS] Terminal mode - no cleanup needed")
            print("[FL_JS] Close the terminal window to stop the backend")
        
        # Close log file (subprocess mode only)
        if self.log_file_handle:
            try:
                self.log_file_handle.write(f"\n{'='*80}\n")
                self.log_file_handle.write(f"FL_JS Backend Server Stopped: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
                self.log_file_handle.write(f"{'='*80}\n\n")
                self.log_file_handle.close()
            except Exception:
                pass
            finally:
                self.log_file_handle = None
```

---

### 4. Update `__init__.py`

**Pass `launch_mode` to ServerRunner:**

```python
# Import configuration
try:
    from backend.config import settings
    AUTO_START = settings.auto_start_backend
    AUTO_RESTART = settings.auto_restart_backend
    LOG_TO_FILE = settings.log_backend_to_file
    LAUNCH_MODE = settings.backend_launch_mode  # NEW
    PORT = settings.ws_port
except ImportError as e:
    print(f"[FL_JS] Warning: Could not load config ({e}), using defaults")
    AUTO_START = True
    AUTO_RESTART = True
    LOG_TO_FILE = True
    LAUNCH_MODE = "auto"  # NEW
    PORT = 8000

# Start backend server if enabled
if AUTO_START:
    try:
        from backend.server_runner import ServerRunner
        
        print("="*80)
        print("[FL_JS] Initializing FL_JS Agentic System...")
        print("="*80)
        
        server_runner = ServerRunner(
            backend_dir=str(BACKEND_DIR),
            port=PORT,
            launch_mode=LAUNCH_MODE,  # NEW
            auto_start=True,
            auto_restart=AUTO_RESTART,
            log_to_file=LOG_TO_FILE,
        )
        
        # ... rest unchanged ...
```

---

### 5. Update `.env`

**Add new option:**

```bash
# Backend Launch Mode
# - auto: Try terminal, fallback to subprocess (recommended)
# - terminal: Terminal only, fail if can't launch
# - subprocess: Managed subprocess (current behavior)
# - manual: Don't auto-start (start manually)
BACKEND_LAUNCH_MODE=auto

# Existing options
AUTO_START_BACKEND=true
AUTO_RESTART_BACKEND=true  # Only applies to subprocess mode
LOG_BACKEND_TO_FILE=true   # Only applies to subprocess mode
WS_PORT=8000
```

---

## Testing Plan

### Phase 1: Unit Tests

**Test `TerminalLauncher`:**

1. ✅ `can_launch_terminal()` detection
   - Test on Windows/macOS/Linux
   - Test headless detection (Linux)
   - Test platform support

2. ✅ `_find_linux_terminal()` discovery
   - Mock `shutil.which()` to test fallback

3. ✅ Command building (don't actually launch)
   - Verify Windows cmd syntax
   - Verify macOS AppleScript syntax
   - Verify Linux terminal commands

### Phase 2: Integration Tests

**Test `ServerRunner` with different modes:**

1. ✅ `launch_mode="terminal"`
   - Verify terminal window opens
   - Verify server starts
   - Verify port is in use
   - Manually close terminal, verify port freed

2. ✅ `launch_mode="subprocess"`
   - Verify existing behavior unchanged
   - Verify cleanup works

3. ✅ `launch_mode="auto"`
   - On normal environment → terminal
   - On headless environment → subprocess
   - Verify fallback works

4. ✅ `launch_mode="manual"`
   - Verify no auto-start
   - Verify manual start works

### Phase 3: Platform Tests

**Test on each platform:**

1. ✅ **Windows 10/11**
   - cmd.exe launches
   - Window title shows "FL_JS Backend"
   - Server starts correctly
   - Venv Python used

2. ✅ **macOS**
   - Terminal.app launches
   - AppleScript works
   - Server starts correctly
   - Venv Python used

3. ✅ **Linux (Ubuntu/Debian)**
   - gnome-terminal works
   - Server starts correctly
   - Venv Python used

4. ✅ **Linux (KDE)**
   - konsole works
   - Fallback to xterm if konsole not available

5. ✅ **Linux (headless)**
   - Detects no DISPLAY
   - Falls back to subprocess
   - Works correctly

### Phase 4: Venv Tests

**Test with different Python environments:**

1. ✅ **Standard venv**
   - `sys.executable` points to venv Python
   - Terminal uses venv Python
   - Imports work correctly

2. ✅ **conda environment**
   - Same as venv

3. ✅ **System Python (no venv)**
   - Uses system Python
   - Works correctly

4. ✅ **Embedded Python (portable ComfyUI)**
   - Uses embedded Python path
   - Works correctly

### Phase 5: Edge Cases

1. ✅ **Port already in use**
   - Terminal mode: Shows message, doesn't launch
   - Subprocess mode: Shows message, doesn't launch

2. ✅ **server.py missing**
   - Shows error message
   - Doesn't crash

3. ✅ **ComfyUI crashes/killed**
   - Terminal mode: Backend keeps running (expected)
   - Subprocess mode: Backend terminates (if atexit fires)

4. ✅ **Multiple ComfyUI instances**
   - Each tries to use same port
   - Port conflict detected
   - Second instance shows appropriate message

---

## Migration Path

### For Existing Users:

**Default behavior (`.env` not modified):**
- `BACKEND_LAUNCH_MODE=auto` (new default)
- First run: Backend launches in terminal window
- User sees: "Backend starting in terminal window"
- User can close terminal to stop backend

**If user prefers old behavior:**
```bash
# In .env
BACKEND_LAUNCH_MODE=subprocess
```

**If user wants manual control:**
```bash
# In .env
BACKEND_LAUNCH_MODE=manual
AUTO_START_BACKEND=false
```

### Breaking Changes:

**None!** 
- Existing `.env` files work (defaults to `auto`)
- `subprocess` mode preserves exact current behavior
- Users can opt-in to terminal mode

---

## Documentation Updates

### README.md

**Add section: Backend Launch Modes**

```markdown
## Backend Launch Modes

FL_JS can launch the backend server in different ways:

### Auto Mode (Recommended)

Tries to launch in a separate terminal window, falls back to subprocess if that fails.

```bash
BACKEND_LAUNCH_MODE=auto
```

**Benefits:**
- See backend logs in real-time
- Close terminal window to stop backend
- No orphaned processes

### Terminal Mode

Always launches in separate terminal. Fails if terminal can't be opened.

```bash
BACKEND_LAUNCH_MODE=terminal
```

**Use when:**
- You want to see logs
- Running on desktop environment

### Subprocess Mode

Manages backend as a subprocess (previous behavior).

```bash
BACKEND_LAUNCH_MODE=subprocess
```

**Use when:**
- Running headless
- Running as service
- Terminal mode doesn't work

### Manual Mode

Don't auto-start backend. You start it manually.

```bash
BACKEND_LAUNCH_MODE=manual
AUTO_START_BACKEND=false
```

**To start manually:**
```bash
cd backend
python server.py
```
```

---

## Implementation Checklist

### Files to Create:
- [ ] `backend/terminal_launcher.py`

### Files to Modify:
- [ ] `backend/config.py` - Add `backend_launch_mode` setting
- [ ] `backend/server_runner.py` - Add launch mode logic
- [ ] `__init__.py` - Pass launch_mode to ServerRunner
- [ ] `.env.example` - Add `BACKEND_LAUNCH_MODE` with comments
- [ ] `README.md` - Document launch modes

### Testing:
- [ ] Unit tests for `TerminalLauncher`
- [ ] Integration tests for each launch mode
- [ ] Platform tests (Windows/macOS/Linux)
- [ ] Venv tests (venv/conda/system/embedded)
- [ ] Edge case tests

### Documentation:
- [ ] Update README.md with launch modes section
- [ ] Add troubleshooting guide
- [ ] Update installation instructions
- [ ] Add migration notes for existing users

---

## Rollout Strategy

### Phase 1: Development (Current)
- ✅ Create implementation plan
- ⏳ Implement `TerminalLauncher`
- ⏳ Update `ServerRunner`
- ⏳ Update configuration

### Phase 2: Testing
- ⏳ Test on Windows
- ⏳ Test on macOS
- ⏳ Test on Linux (multiple distros)
- ⏳ Test with different venvs

### Phase 3: Beta Release
- ⏳ Deploy to test users
- ⏳ Gather feedback
- ⏳ Fix issues

### Phase 4: Production Release
- ⏳ Update documentation
- ⏳ Merge to main branch
- ⏳ Announce in README/changelog

---

## Risk Assessment

### High Risk:
**None identified**

### Medium Risk:

1. **Platform-specific terminal commands fail**
   - **Mitigation:** Fallback to subprocess mode
   - **Impact:** User sees message, backend still works

2. **Headless detection false positives**
   - **Mitigation:** Allow manual override via `BACKEND_LAUNCH_MODE`
   - **Impact:** User can force subprocess mode

### Low Risk:

1. **Terminal emulator not found (Linux)**
   - **Mitigation:** Try multiple emulators, fallback to subprocess
   - **Impact:** Minimal, subprocess mode works

2. **User closes terminal accidentally**
   - **Mitigation:** Document behavior clearly
   - **Impact:** User just restarts ComfyUI

---

## Success Criteria

✅ **Implementation complete when:**

1. All platform-specific terminal launching works
2. Fallback to subprocess mode works reliably
3. Venv context preserved in all modes
4. No orphaned processes in terminal mode
5. Existing users' workflows unaffected
6. Documentation updated and clear
7. Tests pass on all platforms

---

## Next Steps

**Ready to implement?** 

Start with:
1. Create `backend/terminal_launcher.py`
2. Test platform-specific commands manually
3. Integrate into `ServerRunner`
4. Test on your platform
5. Iterate based on results

**Questions to resolve before implementation:**
- ❓ Should we add a "test terminal launch" command for debugging?
- ❓ Should we log which mode was used to a file for troubleshooting?
- ❓ Should we add a GUI setting in ComfyUI for launch mode?

---

## Related Files

- `notes/server_autostart/analysis.md` - Problem analysis
- `notes/server_autostart/investigation.md` - Deep investigation with code evidence
- `backend/server_runner.py` - Current implementation
- `backend/server.py` - Backend server (unchanged)
- `__init__.py` - ComfyUI entry point
