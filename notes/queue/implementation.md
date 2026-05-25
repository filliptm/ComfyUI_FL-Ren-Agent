# Queue Workflow Implementation - Ready to Copy/Paste

## Changes Required

This implementation involves **2 files** with **2 functions** to modify:

1. `web/js/fl_api.js` - Update `queueWorkflow()` to capture ComfyUI's return data
2. `backend/mcp_server.py` - Update `queue_workflow()` to verify queue status

---

## Change 1: Frontend - Capture Queue Result

**File:** `web/js/fl_api.js`  
**Location:** Lines 1310-1322  
**Function:** `queueWorkflow()`

### Complete Replacement Function:

```javascript
/**
 * Queue workflow for execution
 * @param {number|null} batchCount - Batch count (null for current)
 * @returns {object} Queue result with prompt_id, queue_number, and node_errors
 */
queueWorkflow(batchCount = null) {
    try {
        if (batchCount !== null) {
            app.ui.batchCount.value = batchCount;
        }
        
        // Call ComfyUI's queuePrompt and capture the result
        const queueResult = app.queuePrompt();
        
        console.log(`[FL_API] Queued workflow (batch: ${app.ui.batchCount.value})`);
        console.log(`[FL_API] Queue result:`, queueResult);
        
        // Return comprehensive queue information
        return { 
            queued: true, 
            batch_count: parseInt(app.ui.batchCount.value),
            prompt_id: queueResult.prompt_id,
            queue_number: queueResult.number,
            node_errors: queueResult.node_errors || {}
        };
    } catch (error) {
        console.error("[FL_API] queueWorkflow error:", error);
        throw error;
    }
}
```

**Instructions:**
1. Open `web/js/fl_api.js`
2. Find the `queueWorkflow()` function (around line 1310)
3. Replace the entire function with the code above
4. Save the file

---

## Change 2: Backend - Verify Queue Status

**File:** `backend/mcp_server.py`  
**Location:** Lines 1230-1242  
**Function:** `queue_workflow()`

### Complete Replacement Function:

```python
@mcp.tool()
async def queue_workflow(request: QueueWorkflowRequest, ctx: Context) -> Dict[str, Any]:
    """Queue the workflow for execution.
    
    Before calling this tool, call `workflow_overview` to double check for 
    disconnected nodes and any missing slot connections.
    
    This tool now verifies that the workflow actually made it into ComfyUI's queue
    and provides detailed feedback on any validation errors or queue failures.
    
    Returns:
        Success case:
        {
            "success": True,
            "prompt_id": str,
            "queue_number": int,
            "batch_count": int,
            "status": "queued" | "running",
            "message": str
        }
        
        Validation error case:
        {
            "success": False,
            "error": "Workflow validation failed",
            "node_errors": {...},
            "suggestion": str
        }
        
        Queue failure case:
        {
            "success": False,
            "error": str,
            "prompt_id": str,
            "suggestion": str
        }
    """
    # Queue the workflow via frontend
    r = await _execute_tool(ctx, "queue_workflow", request.model_dump())
    logger.debug(f"Queue result: {r}")
    
    # Extract queue information from frontend response
    prompt_id = r.get('prompt_id')
    node_errors = r.get('node_errors', {})
    queue_number = r.get('queue_number')
    batch_count = r.get('batch_count')
    
    # Check for node validation errors first
    if node_errors:
        logger.warning(f"Workflow validation failed: {node_errors}")
        return {
            "success": False,
            "error": "Workflow validation failed",
            "node_errors": node_errors,
            "suggestion": (
                "The workflow has node configuration errors. "
                "Use workflow_overview to identify disconnected nodes or missing inputs. "
                "Fix the errors and try queueing again."
            )
        }
    
    # Verify the workflow actually made it into the queue
    if prompt_id:
        try:
            # Check if prompt appears in history (it should appear immediately when queued)
            history_result = await get_execution_history(
                GetWorkflowHistoryRequest(prompt_id=prompt_id),
                ctx
            )
            
            # If status is 'unknown', the prompt never made it to the queue
            if history_result.get('status') == 'unknown':
                logger.error(f"Prompt {prompt_id} not found in queue or history")
                return {
                    "success": False,
                    "error": "Workflow failed to queue",
                    "prompt_id": prompt_id,
                    "suggestion": (
                        "ComfyUI did not accept the workflow. This can happen when:\n"
                        "1. The workflow hasn't changed and ComfyUI is returning cached results\n"
                        "2. ComfyUI rejected the workflow for internal reasons\n\n"
                        "Try modifying a parameter (like seed, steps, or strength) and queue again. "
                        "Check the ComfyUI console for any error messages."
                    )
                }
            
            # Success - workflow is queued or already running
            status = history_result.get('status', 'queued')
            logger.info(f"Workflow queued successfully: {prompt_id} (position {queue_number}, status: {status})")
            
            return {
                "success": True,
                "prompt_id": prompt_id,
                "queue_number": queue_number,
                "batch_count": batch_count,
                "status": status,
                "message": f"Workflow queued successfully at position {queue_number} (status: {status})"
            }
            
        except Exception as e:
            # History check failed - log but don't fail the queue operation
            logger.warning(f"Could not verify queue status: {e}")
            return {
                "success": True,
                "prompt_id": prompt_id,
                "queue_number": queue_number,
                "batch_count": batch_count,
                "status": "queued",
                "message": f"Workflow queued at position {queue_number} (verification skipped)",
                "warning": "Could not verify queue status"
            }
    else:
        # No prompt_id returned - unexpected error
        logger.error(f"No prompt_id in queue result: {r}")
        return {
            "success": False,
            "error": "No prompt_id returned from queue operation",
            "raw_result": r,
            "suggestion": "This is unexpected. Check that ComfyUI is running and the frontend is connected."
        }
```

**Instructions:**
1. Open `backend/mcp_server.py`
2. Find the `queue_workflow()` function (around line 1230)
3. Replace the entire function with the code above
4. Save the file

---

## Summary of Changes

### What Changed:

1. **Frontend (`web/js/fl_api.js`):**
   - Now captures the return value from `app.queuePrompt()`
   - Returns `prompt_id`, `queue_number`, and `node_errors` to backend
   - Maintains backward compatibility (still returns `queued: true`)

2. **Backend (`backend/mcp_server.py`):**
   - Extracts `prompt_id`, `node_errors`, and `queue_number` from frontend response
   - Checks for node validation errors first
   - Verifies prompt appears in queue/history using existing `get_execution_history` tool
   - Provides detailed, actionable error messages for different failure cases
   - Returns comprehensive success information including `prompt_id` for tracking

### New Return Format:

**Success:**
```json
{
  "success": true,
  "prompt_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "queue_number": 42,
  "batch_count": 1,
  "status": "queued",
  "message": "Workflow queued successfully at position 42 (status: queued)"
}
```

**Node Validation Error:**
```json
{
  "success": false,
  "error": "Workflow validation failed",
  "node_errors": {
    "5": {
      "errors": [{"type": "required_input_missing", "message": "Required input 'image' is missing"}],
      "dependent_outputs": ["7", "9"]
    }
  },
  "suggestion": "The workflow has node configuration errors. Use workflow_overview to identify disconnected nodes or missing inputs. Fix the errors and try queueing again."
}
```

**Queue Failure (Cached/Rejected):**
```json
{
  "success": false,
  "error": "Workflow failed to queue",
  "prompt_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "suggestion": "ComfyUI did not accept the workflow. This can happen when:\n1. The workflow hasn't changed and ComfyUI is returning cached results\n2. ComfyUI rejected the workflow for internal reasons\n\nTry modifying a parameter (like seed, steps, or strength) and queue again. Check the ComfyUI console for any error messages."
}
```

---

## Testing After Implementation

### Test 1: Normal Queue
```python
# Queue a valid workflow
result = await queue_workflow(QueueWorkflowRequest(batch_count=1), ctx)
assert result["success"] == True
assert "prompt_id" in result
assert "queue_number" in result
```

### Test 2: Validation Error
```python
# Create workflow with disconnected nodes, then queue
result = await queue_workflow(QueueWorkflowRequest(batch_count=1), ctx)
assert result["success"] == False
assert "node_errors" in result
assert "suggestion" in result
```

### Test 3: Cached Result
```python
# Queue same workflow twice without changes
result1 = await queue_workflow(QueueWorkflowRequest(batch_count=1), ctx)
result2 = await queue_workflow(QueueWorkflowRequest(batch_count=1), ctx)
# Second call might fail with cache suggestion
if not result2["success"]:
    assert "cached" in result2["suggestion"].lower()
```

---

## Rollback Instructions

If you need to revert these changes:

### Frontend Rollback:
```javascript
queueWorkflow(batchCount = null) {
    try {
        if (batchCount !== null) {
            app.ui.batchCount.value = batchCount;
        }
        app.queuePrompt();
        console.log(`[FL_API] Queued workflow (batch: ${app.ui.batchCount.value})`);
        return { queued: true, batch_count: parseInt(app.ui.batchCount.value) };
    } catch (error) {
        console.error("[FL_API] queueWorkflow error:", error);
        throw error;
    }
}
```

### Backend Rollback:
```python
@mcp.tool()
async def queue_workflow(request: QueueWorkflowRequest, ctx: Context) -> Dict[str, Any]:
    """Queue the workflow for execution."""
    r = await _execute_tool(ctx, "queue_workflow", request.model_dump())
    logger.debug(r)
    return r
```
