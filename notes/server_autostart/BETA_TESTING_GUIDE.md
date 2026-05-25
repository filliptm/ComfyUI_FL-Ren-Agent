# FL_JS Terminal Launch - Beta Testing Guide

**Version:** 1.0  
**Date:** 2025-10-24  
**Feature:** Multi-platform terminal launcher for backend server  

---

## 🎯 What We're Testing

We've implemented a new way to launch the FL_JS backend server that:
- Opens in a **separate terminal window** (so you can see what's happening)
- Uses your **same Python environment** (venv/conda/system)
- **Automatically cleans up** when you close the terminal
- **Falls back** to the old method if terminal launch fails

**Goal:** Verify it works correctly on Windows, macOS, and Linux.

---

## 📋 Pre-Testing Checklist

### 1. Update Your FL_JS Installation

```bash
cd ComfyUI/custom_nodes/ComfyUI_Fill-Nodes
git pull origin main
```

### 2. Check Your `.env` File

Your `.env` file should have a new setting. If it doesn't, add it:

```bash
# Add this line at the top of your .env file
BACKEND_LAUNCH_MODE=auto
```

**Or copy from the new example:**
```bash
cp .env.example .env
# Then edit .env with your API keys
```

### 3. Verify Python Environment

Note which Python environment you're using:
- [ ] System Python
- [ ] venv/virtualenv
- [ ] conda environment
- [ ] Embedded Python (portable ComfyUI)

---

## 🧪 Test Scenarios

### Test 1: Default Launch (Terminal Mode)

**Steps:**
1. Make sure `.env` has `BACKEND_LAUNCH_MODE=auto`
2. Start ComfyUI normally
3. Watch for a **new terminal window** to open

**Expected Results:**
- ✅ New terminal window opens with title "FL_JS Backend"
- ✅ Terminal shows backend server logs
- ✅ ComfyUI console shows: `"Launched in [terminal name]"`
- ✅ ComfyUI console shows: `"Backend server started successfully!"`
- ✅ FL_JS UI loads in browser

**What to Report:**
- Did the terminal window open?
- What terminal was used? (cmd.exe, Terminal.app, gnome-terminal, etc.)
- Can you see the backend logs in the terminal?
- Does the backend actually start? (check port 8000)

**Screenshot Request:** Terminal window showing backend logs

---

### Test 2: Terminal Close Behavior

**Steps:**
1. With backend running in terminal (from Test 1)
2. **Close the terminal window** (X button or close command)
3. Check if backend stopped

**Expected Results:**
- ✅ Backend server stops when terminal closes
- ✅ Port 8000 becomes available again
- ✅ FL_JS UI shows disconnected state
- ✅ No orphaned Python processes

**How to Verify Port:**

**Windows:**
```cmd
netstat -ano | findstr :8000
```

**macOS/Linux:**
```bash
lsof -i :8000
```

**What to Report:**
- Does closing the terminal stop the backend?
- Are there any orphaned processes?
- Does the port get freed up?

---

### Test 3: ComfyUI Restart Behavior

**Steps:**
1. Start ComfyUI (backend launches in terminal)
2. **Restart ComfyUI** (Ctrl+C or close)
3. Start ComfyUI again

**Expected Results:**
- ✅ First start: Terminal opens, backend starts
- ✅ ComfyUI stops: No errors about cleanup
- ✅ Second start: New terminal opens, backend starts again
- ✅ No "port already in use" errors

**What to Report:**
- Does it work cleanly on restart?
- Any error messages?
- Does old terminal stay open or close?

---

### Test 4: Subprocess Fallback Mode

**Steps:**
1. Edit `.env`: `BACKEND_LAUNCH_MODE=subprocess`
2. Restart ComfyUI

**Expected Results:**
- ✅ No terminal window opens
- ✅ Backend runs as subprocess (like before)
- ✅ Logs go to `backend/logs/server.log`
- ✅ ComfyUI console shows: `"Starting backend server (subprocess mode)"`
- ✅ Everything works normally

**What to Report:**
- Does subprocess mode still work?
- Any differences from previous behavior?

---

### Test 5: Manual Mode

**Steps:**
1. Edit `.env`: `BACKEND_LAUNCH_MODE=manual`
2. Restart ComfyUI
3. Backend should NOT auto-start
4. Manually start backend:
   ```bash
   cd ComfyUI/custom_nodes/ComfyUI_Fill-Nodes/backend
   python server.py
   ```

**Expected Results:**
- ✅ ComfyUI starts without launching backend
- ✅ Message says: `"Manual launch mode - not starting backend"`
- ✅ Manual start works correctly
- ✅ FL_JS UI connects after manual start

**What to Report:**
- Does manual mode work?
- Can you start backend manually?

---

### Test 6: Virtual Environment Preservation

**If you're using a venv/conda environment:**

**Steps:**
1. Activate your venv/conda environment
2. Start ComfyUI (which launches backend in terminal)
3. In the backend terminal window, check which Python is running:

**Windows:**
```cmd
where python
```

**macOS/Linux:**
```bash
which python
```

**Expected Results:**
- ✅ Backend uses the **same Python** as ComfyUI
- ✅ Backend can import all required packages
- ✅ No "ModuleNotFoundError" messages

**What to Report:**
- Does the backend use the correct Python?
- Path to Python executable in terminal
- Any import errors?

---

### Test 7: Headless Environment (Linux Only)

**For Linux servers without GUI:**

**Steps:**
1. Unset DISPLAY: `unset DISPLAY`
2. Start ComfyUI

**Expected Results:**
- ✅ Terminal launch fails (expected)
- ✅ Automatically falls back to subprocess mode
- ✅ Message: `"Terminal launch failed: Headless environment"`
- ✅ Message: `"Falling back to subprocess mode..."`
- ✅ Backend starts successfully as subprocess

**What to Report:**
- Does fallback work correctly?
- Any errors during fallback?

---

## 🐛 Bug Report Template

If something doesn't work, please report:

```markdown
### Bug Report

**Platform:** [Windows 10/11 | macOS 13/14 | Linux Ubuntu 22.04 | etc.]
**Python Environment:** [System | venv | conda | embedded]
**Launch Mode:** [auto | terminal | subprocess | manual]

**What Happened:**
[Describe the issue]

**Expected Behavior:**
[What should have happened]

**Console Output:**
```
[Paste relevant console output]
```

**Terminal Output (if applicable):**
```
[Paste backend terminal output]
```

**Screenshots:**
[Attach if relevant]

**Additional Context:**
[Anything else that might help]
```

---

## ✅ Success Report Template

If everything works, please report:

```markdown
### Success Report

**Platform:** [Windows 10/11 | macOS 13/14 | Linux Ubuntu 22.04 | etc.]
**Python Environment:** [System | venv | conda | embedded]
**Terminal Used:** [cmd.exe | Terminal.app | gnome-terminal | konsole | xterm]

**Tests Passed:**
- [x] Test 1: Default Launch
- [x] Test 2: Terminal Close
- [x] Test 3: ComfyUI Restart
- [x] Test 4: Subprocess Fallback
- [x] Test 5: Manual Mode
- [x] Test 6: Venv Preservation
- [ ] Test 7: Headless (N/A or tested)

**Notes:**
[Any observations or comments]

**Screenshot:**
[Terminal window showing backend running]
```

---

## 🔍 Troubleshooting

### Issue: Terminal doesn't open

**Check:**
1. What does ComfyUI console say?
2. Look for: `"Terminal launch failed: [reason]"`
3. If it says "Falling back to subprocess mode" - that's OK!
4. Try `BACKEND_LAUNCH_MODE=subprocess` to use old method

### Issue: "Port already in use"

**Fix:**
1. Close any existing terminal windows with backend
2. Kill orphaned processes:

**Windows:**
```cmd
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**macOS/Linux:**
```bash
lsof -i :8000
kill -9 <PID>
```

### Issue: Backend crashes on startup

**Check:**
1. Look at terminal window for error messages
2. Check `backend/logs/server.log` (if using subprocess mode)
3. Verify your `.env` has correct API keys
4. Try starting backend manually to see full error

### Issue: Wrong Python environment

**Symptoms:**
- ModuleNotFoundError
- Import errors
- "No module named 'fastapi'"

**Fix:**
1. Check which Python ComfyUI is using: `which python` or `where python`
2. The backend should use the same one
3. Report this as a bug if they differ

---

## 📊 What We Need to Know

### Platform Coverage

We need at least one successful test from each:

**Windows:**
- [ ] Windows 10
- [ ] Windows 11
- [ ] Portable ComfyUI (embedded Python)

**macOS:**
- [ ] macOS 13 (Ventura)
- [ ] macOS 14 (Sonoma)
- [ ] macOS 15 (Sequoia)
- [ ] Intel Mac
- [ ] Apple Silicon (M1/M2/M3)

**Linux:**
- [ ] Ubuntu 22.04 / 24.04
- [ ] Debian
- [ ] Fedora
- [ ] Arch
- [ ] Headless server

### Python Environment Coverage

- [ ] System Python
- [ ] venv
- [ ] virtualenv
- [ ] conda/miniconda
- [ ] Embedded Python (portable)

### Terminal Coverage

**Windows:**
- [ ] cmd.exe
- [ ] Windows Terminal

**macOS:**
- [ ] Terminal.app
- [ ] iTerm2

**Linux:**
- [ ] gnome-terminal
- [ ] konsole (KDE)
- [ ] xfce4-terminal
- [ ] xterm

---

## 📝 Testing Checklist for Each Tester

**Your Info:**
- Platform: _______________
- Python Environment: _______________
- Terminal: _______________

**Tests:**
- [ ] Test 1: Default Launch
- [ ] Test 2: Terminal Close
- [ ] Test 3: ComfyUI Restart
- [ ] Test 4: Subprocess Fallback
- [ ] Test 5: Manual Mode
- [ ] Test 6: Venv Preservation (if applicable)
- [ ] Test 7: Headless (Linux only, optional)

**Overall:**
- [ ] Everything works as expected
- [ ] Some issues (see bug report)
- [ ] Major issues (doesn't work)

---

## 🚀 Quick Start for Testers

**TL;DR version:**

1. Update FL_JS: `git pull`
2. Make sure `.env` exists (copy from `.env.example` if needed)
3. Start ComfyUI
4. **Look for a new terminal window** to pop up
5. Check if backend starts successfully
6. Close terminal window, verify backend stops
7. Report results!

---

## 📧 How to Submit Results

**Option 1: GitHub Issue**
- Create an issue with title: `[Beta Test] Terminal Launch - [Your Platform]`
- Use success or bug report template above

**Option 2: Discord/Slack**
- Post in #beta-testing channel
- Include platform and test results

**Option 3: Email**
- Send to: [your-email@example.com]
- Subject: `FL_JS Beta Test - [Platform]`

---

## ❓ Questions?

If you're unsure about anything:
1. Check the troubleshooting section
2. Ask in #beta-testing channel
3. Report what you see (even if you think it's wrong)

**Remember:** There are no stupid questions, and "it didn't work" is valuable feedback!

---

## 🙏 Thank You!

Your testing helps make FL_JS better for everyone. We really appreciate your time and effort!

**Estimated Testing Time:** 15-20 minutes  
**Priority Tests:** 1, 2, 3 (the rest are optional but helpful)

---

**Happy Testing! 🎉**
