# Queue Workflow Return Value Analysis

## Problem Statement

The `queue_workflow` MCP tool currently returns `{"queued": true, "batch_count": N}` but doesn't verify that the workflow actually made it into the ComfyUI queue. We need to:

1. Capture the full return data from ComfyUI's `app.queuePrompt()` including `prompt_id`, `number`, and `node_errors`
2. Use this data to verify the workflow is actually queued
3. Provide detailed error feedback when queueing fails

## Current Data Flow

### Frontend Chain:
```
ToolExecutor._handleQueueWorkflow()
  ↓
FL_API.queueWorkflow()
  ↓
app.queuePrompt() [ComfyUI native]
  ↓
Returns: { queued: true, batch_count: N }  ← Missing prompt_id!
```

### Backend Chain:
```python
# backend/mcp_server.py:1236
r = await _execute_tool(ctx, "queue_workflow", request.model_dump())
request_id = r.get('request_id')  # ❌ WRONG! This field doesn't exist
```

## What ComfyUI Actually Returns

According to ComfyUI's source code and API documentation, `app.queuePrompt()` returns:

```javascript
{
  prompt_id: string,    // UUID v4 identifier for this queued prompt
  number: integer,      // Queue position/sequence number
  node_errors: object   // Validation errors (empty {} if no errors)
}
```

### Example Returns:

**Success:**
```javascript
{
  prompt_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  number: 42,
  node_errors: {}
}
```

**Validation Error:**
```javascript
{
  prompt_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  number: null,
  node_errors: {
    "5": {
      "errors": [{
        "type": "required_input_missing",
        "message": "Required input 'image' is missing"
      }],
      "dependent_outputs": ["7", "9"]
    }
  }
}
```

## Verification Strategy

### Step 1: Capture Full ComfyUI Response

Modify `web/js/fl_api.js` to return all data from `app.queuePrompt()`:

```javascript
return { 
  queued: true,
  batch_count: parseInt(app.ui.batchCount.value),
  prompt_id: queueResult.prompt_id,
  queue_number: queueResult.number,
  node_errors: queueResult.node_errors
};
```

### Step 2: Verification Logic in Backend

The backend should:

1. **Check for node_errors first** - If present, return detailed error immediately
2. **Use `get_execution_history` tool** - This directly queries ComfyUI's history endpoint with the `prompt_id`
3. **Verify prompt is in queue or history** - If not found anywhere, something went wrong
4. **Return detailed status** - Give the agent actionable information

### Step 3: Detailed Error Responses

**Case 1: Node Validation Errors**
```python
if node_errors:
    return {
        "success": False,
        "error": "Workflow validation failed",
        "node_errors": node_errors,
        "suggestion": "Fix the node configuration errors before queueing"
    }
```

**Case 2: Not in Queue/History**
```python
if prompt_id not in history and prompt_id not in queue:
    return {
        "success": False,
        "error": "Workflow failed to queue",
        "prompt_id": prompt_id,
        "suggestion": "ComfyUI may have rejected the workflow. Check ComfyUI console for errors."
    }
```

**Case 3: Success**
```python
return {
    "success": True,
    "prompt_id": prompt_id,
    "queue_number": queue_number,
    "status": "queued" if in_queue else "executing",
    "message": f"Workflow queued at position {queue_number}"
}
```

## Benefits of This Approach

1. **Immediate Validation Feedback** - Agents know right away if there are node errors
2. **Queue Verification** - Confirms the workflow actually made it into ComfyUI's queue
3. **Actionable Errors** - Agents get specific guidance on what went wrong
4. **Tracking Capability** - The `prompt_id` can be used to track execution progress
5. **Debug Support** - Full error details help diagnose workflow issues

## Implementation Impact

### Files to Modify:
1. `web/js/fl_api.js` - Update `queueWorkflow()` to capture and return full ComfyUI response
2. `backend/mcp_server.py` - Update `queue_workflow` tool to verify queue status

### Backward Compatibility:
- The frontend change is additive (adds fields, doesn't remove)
- The backend change improves error handling without breaking existing flows
- Existing code that checks `queued: true` will continue to work

## Edge Cases to Handle

1. **ComfyUI not responding** - Timeout on history check
2. **Prompt in history but failed** - Check execution status
3. **Multiple batch items** - Each gets its own prompt_id
4. **Queue cleared before verification** - Unlikely but possible race condition

## Next Steps

1. Create `investigation.md` with detailed code locations and current implementations
2. Create `implementation.md` with final code changes ready to copy/paste
3. Test the changes with both successful and failing workflows
4. Document the new return format for agent developers
