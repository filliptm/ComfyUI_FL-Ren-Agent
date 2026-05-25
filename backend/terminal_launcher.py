"""Platform-specific terminal launcher for FL_JS backend.

Handles launching the backend server in a separate terminal window across
Windows, macOS, and Linux platforms.
"""

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
    
    The launched terminal will:
    - Use the same Python interpreter as ComfyUI (preserves venv)
    - Show real-time backend logs
    - Terminate the backend when closed
    - Require no cleanup from parent process
    """
    
    def __init__(self, backend_dir: Path, python_exe: str, port: int):
        """Initialize terminal launcher.
        
        Args:
            backend_dir: Path to backend directory containing server.py
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
            (can_launch, reason) tuple where:
            - can_launch: True if terminal launch is possible
            - reason: Human-readable explanation
        """
        system = platform.system()
        
        # Check platform support
        if system not in ["Windows", "Darwin", "Linux"]:
            return False, f"Unsupported platform: {system}"
        
        # Check for headless environment on Linux
        if system == "Linux":
            if 'DISPLAY' not in os.environ:
                return False, "Headless environment (no DISPLAY variable)"
            
            # Check for available terminal emulator
            terminal = self._find_linux_terminal()
            if not terminal:
                return False, "No terminal emulator found (tried: gnome-terminal, konsole, xfce4-terminal, xterm)"
        
        return True, "Terminal launch available"
    
    def _find_linux_terminal(self) -> Optional[str]:
        """Find available terminal emulator on Linux.
        
        Returns:
            Terminal command name or None if not found
        """
        # Try terminals in order of preference
        terminals = [
            'gnome-terminal',
            'konsole',
            'xfce4-terminal',
            'xterm',
        ]
        
        for term in terminals:
            if shutil.which(term):
                self.logger.debug(f"Found terminal emulator: {term}")
                return term
        
        self.logger.warning("No terminal emulator found")
        return None
    
    def launch(self) -> Tuple[bool, str]:
        """Launch backend in terminal window.
        
        Returns:
            (success, message) tuple where:
            - success: True if launch succeeded
            - message: Human-readable status message
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
            self.logger.exception("Terminal launch failed")
            return False, f"Launch failed: {e}"
    
    def _launch_windows(self) -> Tuple[bool, str]:
        """Launch backend in Windows cmd.exe.
        
        Returns:
            (success, message) tuple
        """
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        # Build command to run in new cmd window
        # /k keeps window open after command completes
        cmd = (
            f'cd /d "{backend_dir_str}" && '
            f'"{python_exe_str}" server.py'
        )
        
        self.logger.info(f"Launching Windows terminal: {cmd}")
        
        # Launch new cmd window with title
        # Using 'start' command to open new window
        subprocess.Popen(
            ['cmd', '/c', 'start', 'FL_JS Backend', 'cmd', '/k', cmd],
            shell=True,
            creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, 'CREATE_NEW_CONSOLE') else 0,
        )
        
        return True, "Launched in new cmd.exe window"
    
    def _launch_macos(self) -> Tuple[bool, str]:
        """Launch backend in macOS Terminal.app.
        
        Uses AppleScript to open a new Terminal window and run the server.
        
        Returns:
            (success, message) tuple
        """
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        # Build AppleScript to open Terminal and run command
        # The Terminal window will stay open showing the server output
        script = f'''
tell application "Terminal"
    do script "cd '{backend_dir_str}' && '{python_exe_str}' server.py"
    activate
end tell
'''
        
        self.logger.info(f"Launching macOS Terminal.app")
        
        # Execute AppleScript
        subprocess.Popen(['osascript', '-e', script])
        
        return True, "Launched in Terminal.app"
    
    def _launch_linux(self) -> Tuple[bool, str]:
        """Launch backend in Linux terminal emulator.
        
        Tries to find and use an available terminal emulator.
        
        Returns:
            (success, message) tuple
        """
        terminal = self._find_linux_terminal()
        if not terminal:
            return False, "No terminal emulator found"
        
        backend_dir_str = str(self.backend_dir)
        python_exe_str = str(self.python_exe)
        
        # Build command that keeps terminal open after execution
        # 'exec bash' at the end keeps terminal open
        cmd = f"cd '{backend_dir_str}' && '{python_exe_str}' server.py; exec bash"
        
        self.logger.info(f"Launching {terminal}: {cmd}")
        
        # Terminal-specific command building
        # Each terminal has slightly different argument syntax
        try:
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
                # -hold keeps window open after command exits
                subprocess.Popen(
                    ['xterm', '-title', 'FL_JS Backend', '-hold', '-e', cmd]
                )
            else:
                return False, f"Unknown terminal: {terminal}"
            
            return True, f"Launched in {terminal}"
        
        except Exception as e:
            self.logger.exception(f"Failed to launch {terminal}")
            return False, f"Failed to launch {terminal}: {e}"
