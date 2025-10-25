# Queue Workflow Investigation - Code Locations & Current Implementation

## Frontend Code Locations

### 1. FL_API.queueWorkflow() - `web/js/fl_api.js:1310-1322`

**Current Implementation:**
```javascript
queueWorkflow(batchCount = null) {
    try {
        if (batchCount !== null) {
            app.ui.batchCount.value = batchCount;
        }
        app.queuePrompt();  // ← Calls ComfyUI native function
        console.log(`[FL_API] Queued workflow (batch: ${app.ui.batchCount.value})`);
        return { queued: true, batch_count: parseInt(app.ui.batchCount.value) };
    } catch (error) {
        console.error("[FL_API] queueWorkflow error:", error);
        throw error;
    }
}
```

**Problem:** The return value from `app.queuePrompt()` is **ignored**. This function returns:
```javascript
{
  prompt_id: "uuid-string",
  number: 42,
  node_errors: {}
}
```

But we're not capturing it.

### 2. ToolExecutor._handleQueueWorkflow() - `web/js/tool_executor.js:566-569`

**Current Implementation:**
```javascript
async _handleQueueWorkflow(params) {
    const { batch_count } = params;
    return await this.flApi.queueWorkflow(batch_count || null);
}
```

**This just passes through whatever `fl_api.queueWorkflow()` returns.**

### 3. ToolExecutor.executeToolRequest() - `web/js/tool_executor.js:107-170`

**Current Implementation (relevant parts):**
```javascript
async executeToolRequest(message) {
    const { request_id, tool_name, parameters } = message;
    const startTime = performance.now();
    
    try {
        // Find handler
        const handler = this.toolHandlers[tool_name];
        if (!handler) {
            throw new Error(`Unknown tool: ${tool_name}`);
        }
        
        // Execute handler
        const result = await handler(parameters);
        const executionTime = performance.now() - startTime;
        
        // Send success result
        await this.wsClient.send({
            type: "tool_result",
            request_id: request_id,  // ← WebSocket request ID
            success: true,
            data: result,  // ← This is { queued: true, batch_count: N }
            execution_time_ms: executionTime
        });
    } catch (error) {
        // ... error handling
    }
}
```

**The `data` field contains whatever the tool handler returned.**

## Backend Code Locations

### 1. queue_workflow MCP Tool - `backend/mcp_server.py:1230-1242`

**Current Implementation:**
```python
@mcp.tool()
async def queue_workflow(request: QueueWorkflowRequest, ctx: Context) -> Dict[str, Any]:
    """Queue the workflow for execution. User might say 'run' the workflow. 
    Before calling this tool, call `workflow_overview` to double check for 
    disconnected nodes and any missing slot connections"""
    # First queue the workflow
    r = await _execute_tool(ctx, "queue_workflow", request.model_dump())
    logger.debug(r)
    request_id = r.get('request_id')  # ← BUG! This field doesn't exist
    # TODO Now check history to make sure this actually got into the queue
    # ... (existing TODO comment)
    return r
```

**Problem:** 
- `r` is the `data` field from the frontend's tool result
- It contains: `{ queued: true, batch_count: N }`
- There is **NO** `request_id` field in this data
- The `request_id` in the WebSocket protocol is for routing, not the ComfyUI `prompt_id`

### 2. get_execution_history Tool - `backend/mcp_server.py:2172-2250`

**Current Implementation (relevant parts):**
```python
@mcp.tool()
async def get_execution_history(request: GetWorkflowHistoryRequest, ctx: Context) -> Dict[str, Any]:
    """Get workflow currently processing queue and history from ComfyUI.
    
    Retrieves execution history including status, errors, and outputs for workflows.
    Can fetch a specific workflow by prompt_id or recent history.
    ...
    """
    await _report_tool_activity(ctx, "get_workflow_history")
    
    try:
        comfy_tools = get_comfy_tools()
        
        if request.prompt_id:
            # Get specific workflow history
            history_entry = await comfy_tools.fetch_history(
                prompt_id=request.prompt_id
            )
            
            if not history_entry:
                return {
                    "prompt_id": request.prompt_id,
                    "status": "unknown",
                    "completed": False,
                    "message": "History not found - workflow may still be running or prompt_id is invalid"
                }
            
            # Parse the history entry
            status = history_entry.get("status", {})
            status_str = status.get("status_str", "unknown")
            completed = status.get("completed", False)
            
            result = {
                "prompt_id": request.prompt_id,
                "status": status_str,
                "completed": completed,
                "outputs": history_entry.get("outputs", {}),
                "prompt": history_entry.get("prompt", [])
            }
            # ... error handling
```

**This tool can:**
- Accept a `prompt_id` parameter
- Query ComfyUI's history endpoint directly
- Return detailed status including errors
- Tell us if a prompt is in history or not

## ComfyUI Native Code

### ComfyUI's app.queuePrompt() Return Value

Based on external research and documentation:

```javascript
// What app.queuePrompt() actually returns:
{
  prompt_id: string,    // UUID v4 identifier
  number: integer,      // Queue position/sequence number  
  node_errors: object   // Validation errors (empty {} if valid)
}
```

**Example Success:**
```javascript
{
  prompt_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  number: 42,
  node_errors: {}
}
```

**Example Validation Error:**
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

## Data Flow Diagram

```
Backend (Python)                    Frontend (JavaScript)
================                    =====================

queue_workflow()                    
    |
    v
_execute_tool() -----------------> WebSocket Message
                                    type: "tool_request"
                                    request_id: "ws-req-123"
                                    tool_name: "queue_workflow"
                                    parameters: {batch_count: 1}
                                            |
                                            v
                                    ToolExecutor.executeToolRequest()
                                            |
                                            v
                                    _handleQueueWorkflow()
                                            |
                                            v
                                    FL_API.queueWorkflow()
                                            |
                                            v
                                    app.queuePrompt()  ← ComfyUI native
                                    Returns: {prompt_id, number, node_errors}
                                            |
                                            v
                                    CURRENTLY IGNORED! ❌
                                            |
                                            v
                                    Returns: {queued: true, batch_count: 1}
                                            |
                                            v
                                    WebSocket Message
                                    type: "tool_result"
                                    request_id: "ws-req-123"
                                    success: true
                                    data: {queued: true, batch_count: 1}
                                            |
                                            v
Receives tool result <------------- 
r = {queued: true, batch_count: 1}
r.get('request_id')  ❌ None!
```

## The Fix Required

### Frontend Changes

**File:** `web/js/fl_api.js`  
**Function:** `queueWorkflow()`  
**Lines:** 1310-1322

**Change:**
```javascript
queueWorkflow(batchCount = null) {
    try {
        if (batchCount !== null) {
            app.ui.batchCount.value = batchCount;
        }
        const queueResult = app.queuePrompt();  // ← CAPTURE return value
        console.log(`[FL_API] Queued workflow (batch: ${app.ui.batchCount.value})`);
        return { 
            queued: true, 
            batch_count: parseInt(app.ui.batchCount.value),
            prompt_id: queueResult.prompt_id,      // ← ADD THIS
            queue_number: queueResult.number,      // ← ADD THIS  
            node_errors: queueResult.node_errors   // ← ADD THIS
        };
    } catch (error) {
        console.error("[FL_API] queueWorkflow error:", error);
        throw error;
    }
}
```

### Backend Changes

**File:** `backend/mcp_server.py`  
**Function:** `queue_workflow()`  
**Lines:** 1230-1242

**Change:**
```python
@mcp.tool()
async def queue_workflow(request: QueueWorkflowRequest, ctx: Context) -> Dict[str, Any]:
    """Queue the workflow for execution."""
    # Queue the workflow
    r = await _execute_tool(ctx, "queue_workflow", request.model_dump())
    logger.debug(f"Queue result: {r}")
    
    # Extract queue information
    prompt_id = r.get('prompt_id')
    node_errors = r.get('node_errors', {})
    queue_number = r.get('queue_number')
    
    # Check for node validation errors first
    if node_errors:
        return {
            "success": False,
            "error": "Workflow validation failed",
            "node_errors": node_errors,
            "suggestion": "Fix the node configuration errors before queueing. Use workflow_overview to identify issues."
        }
    
    # Verify the workflow actually made it into the queue
    if prompt_id:
        # Check if prompt is in history (it should appear immediately)
        history_result = await get_execution_history(
            GetWorkflowHistoryRequest(prompt_id=prompt_id),
            ctx
        )
        
        if history_result.get('status') == 'unknown':
            # Prompt not in history - something went wrong
            return {
                "success": False,
                "error": "Workflow failed to queue",
                "prompt_id": prompt_id,
                "suggestion": (
                    "ComfyUI may have rejected the workflow. Check ComfyUI console for errors. "
                    "This can happen if the workflow hasn't changed and ComfyUI is returning cached results."
                )
            }
        
        # Success - workflow is queued
        return {
            "success": True,
            "prompt_id": prompt_id,
            "queue_number": queue_number,
            "batch_count": r.get('batch_count'),
            "status": history_result.get('status', 'queued'),
            "message": f"Workflow queued successfully at position {queue_number}"
        }
    else:
        # No prompt_id returned - unexpected
        return {
            "success": False,
            "error": "No prompt_id returned from queue operation",
            "raw_result": r
        }
```

## Testing Strategy

### Test Case 1: Successful Queue
1. Queue a valid workflow
2. Verify `prompt_id` is returned
3. Verify `queue_number` is returned
4. Verify `node_errors` is empty
5. Verify history check confirms prompt is queued

### Test Case 2: Node Validation Error
1. Create workflow with missing required input
2. Queue workflow
3. Verify `node_errors` contains error details
4. Verify error message is descriptive
5. Verify workflow is NOT in queue

### Test Case 3: Cached Result
1. Queue same workflow twice without changes
2. Second queue should potentially fail verification
3. Error message should suggest changing parameters

### Test Case 4: ComfyUI Rejection
1. Queue workflow that ComfyUI rejects for other reasons
2. Verify history check catches the missing prompt
3. Verify error message directs user to ComfyUI console
