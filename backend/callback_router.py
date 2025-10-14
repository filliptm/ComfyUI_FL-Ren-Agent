"""Callback router for tool execution via WebSocket.

This module manages the routing of tool execution requests from the MCP server
to the frontend via WebSocket, and handles the asynchronous waiting for results.
"""

import asyncio
import logging
import uuid
from contextvars import ContextVar
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Context variable to store the current session_id for tool callbacks
current_session_id: ContextVar[Optional[str]] = ContextVar("current_session_id", default=None)


class CallbackTimeout(Exception):
    """Raised when a callback times out waiting for a response."""
    pass


class CallbackError(Exception):
    """Raised when a callback receives an error response."""
    pass


class CallbackRouter:
    """Routes tool callbacks between MCP server and WebSocket clients.
    
    The CallbackRouter manages pending tool execution requests, sending them
    to the appropriate WebSocket client and waiting for responses with timeout
    handling.
    
    Attributes:
        connection_manager: WebSocket connection manager instance
        pending_callbacks: Dict mapping request_id to asyncio.Future
        default_timeout: Default timeout in seconds for tool callbacks
    """
    
    def __init__(self, connection_manager, default_timeout: float = 30.0):
        """Initialize the callback router.
        
        Args:
            connection_manager: WebSocket connection manager instance
            default_timeout: Default timeout in seconds (default: 30.0)
        """
        self.connection_manager = connection_manager
        self.pending_callbacks: Dict[str, asyncio.Future] = {}
        self.default_timeout = default_timeout
        logger.info(f"CallbackRouter initialized with {default_timeout}s timeout")
    
    async def execute_tool_callback(
        self,
        tool_name: str,
        parameters: Dict[str, Any],
        timeout_ms: Optional[int] = None
    ) -> Dict[str, Any]:
        """Execute a tool via WebSocket callback.
        
        This method sends a tool execution request to the frontend via WebSocket,
        waits for the response, and returns the result. It handles timeouts and
        errors appropriately.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Tool parameters as a dictionary
            timeout_ms: Optional timeout in milliseconds (overrides default)
            
        Returns:
            Dict containing the tool execution result
            
        Raises:
            CallbackTimeout: If the callback times out
            CallbackError: If the callback receives an error response
            RuntimeError: If no session_id is set in context
            
        Example:
            >>> result = await router.execute_tool_callback(
            ...     tool_name="create_node",
            ...     parameters={"node_type": "KSampler", "parameters": {}}
            ... )
        """
        # Get session_id from context
        session_id = current_session_id.get()
        if not session_id:
            error_msg = "No session_id set in context for tool callback"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        
        # Calculate timeout
        timeout_seconds = (
            timeout_ms / 1000.0 if timeout_ms is not None 
            else self.default_timeout
        )
        
        # Create future for this callback
        future = asyncio.get_event_loop().create_future()
        self.pending_callbacks[request_id] = future
        
        logger.debug(
            f"Executing tool callback: session={session_id}, "
            f"tool={tool_name}, request_id={request_id}"
        )
        
        try:
            # Send tool request to frontend
            message = {
                "type": "tool_request",
                "session_id": session_id,
                "request_id": request_id,
                "tool_name": tool_name,
                "parameters": parameters,
                "timeout_ms": timeout_ms or int(self.default_timeout * 1000)
            }
            
            await self.connection_manager.send_to_session(session_id, message)
            logger.debug(f"Tool request sent: {request_id}")
            
            # Wait for response with timeout
            try:
                result = await asyncio.wait_for(future, timeout=timeout_seconds)
                logger.debug(f"Tool callback completed: {request_id}")
                return result
                
            except asyncio.TimeoutError:
                error_msg = (
                    f"Tool callback timeout after {timeout_seconds}s: "
                    f"tool={tool_name}, request_id={request_id}"
                )
                logger.error(error_msg)
                raise CallbackTimeout(error_msg)
                
        finally:
            # Clean up pending callback
            self.pending_callbacks.pop(request_id, None)
    
    async def handle_tool_result(
        self,
        request_id: str,
        success: bool,
        data: Optional[Any] = None,
        error: Optional[str] = None,
        execution_time_ms: Optional[float] = None
    ) -> None:
        """Handle a tool result from the frontend.
        
        This method is called when the frontend sends back a tool execution result.
        It resolves or rejects the corresponding pending future.
        
        Args:
            request_id: Request ID matching the original tool request
            success: Whether the tool execution succeeded
            data: Tool execution result data (if success=True)
            error: Error message (if success=False)
            execution_time_ms: Time taken to execute tool in milliseconds
        """
        future = self.pending_callbacks.get(request_id)
        
        if not future:
            logger.warning(
                f"Received tool result for unknown request_id: {request_id}"
            )
            return
        
        if future.done():
            logger.warning(
                f"Received tool result for already-completed request: {request_id}"
            )
            return
        
        logger.debug(
            f"Handling tool result: request_id={request_id}, "
            f"success={success}, execution_time={execution_time_ms}ms"
        )
        
        if success:
            # Resolve future with result data
            future.set_result(data)
            logger.debug(f"Tool callback succeeded: {request_id}")
        else:
            # Reject future with error
            error_msg = error or "Unknown tool execution error"
            future.set_exception(CallbackError(error_msg))
            logger.error(f"Tool callback failed: {request_id} - {error_msg}")
    
    def cancel_pending_callbacks(self, session_id: str) -> None:
        """Cancel all pending callbacks for a session.
        
        This is called when a session disconnects to clean up any pending
        tool execution requests.
        
        Args:
            session_id: Session ID to cancel callbacks for
        """
        cancelled_count = 0
        
        for request_id, future in list(self.pending_callbacks.items()):
            if not future.done():
                future.cancel()
                cancelled_count += 1
        
        if cancelled_count > 0:
            logger.info(
                f"Cancelled {cancelled_count} pending callbacks for session: {session_id}"
            )
    
    def get_pending_count(self) -> int:
        """Get the number of pending callbacks.
        
        Returns:
            Number of pending tool callbacks
        """
        return len(self.pending_callbacks)
