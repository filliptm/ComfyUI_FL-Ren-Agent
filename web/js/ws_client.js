/**
 * WebSocket Client for FL_JS Agentic System
 * 
 * Features:
 * - Session-based connection with handshake protocol
 * - Automatic reconnection with exponential backoff
 * - Message queueing during disconnection
 * - Event-driven architecture for message handling
 */

/**
 * Simple EventEmitter implementation
 */
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }
    
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(listener => listener(...args));
        }
    }
    
    off(event, listenerToRemove) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
    }
}

class WSClient extends EventEmitter {
    constructor(sessionId, config = {}) {
        super();
        this.sessionId = sessionId;
        this.ws = null;
        
        // Configuration
        this.config = {
            url: config.url || 'ws://localhost:8000/ws',
            maxReconnectAttempts: config.maxReconnectAttempts || 5,
            initialReconnectDelay: config.initialReconnectDelay || 1000, // 1 second
            maxReconnectDelay: config.maxReconnectDelay || 30000, // 30 seconds
            clientVersion: config.clientVersion || '1.0.0',
        };
        
        // State
        this.connected = false;
        this.handshakeComplete = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = this.config.initialReconnectDelay;
        this.reconnectTimeout = null;
        this.messageQueue = [];
        
        console.log('[WSClient] Initialized with session:', this.sessionId);
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[WSClient] Already connected');
            return;
        }

        console.log('[WSClient] Connecting to:', this.config.url);
        this.emit('connecting');
        
        try {
            this.ws = new WebSocket(this.config.url);
            
            this.ws.onopen = () => this.handleOpen();
            this.ws.onclose = (event) => this.handleClose(event);
            this.ws.onerror = (error) => this.handleError(error);
            this.ws.onmessage = (event) => this.handleMessage(event);
        } catch (error) {
            console.error('[WSClient] Connection error:', error);
            this.attemptReconnect();
        }
    }

    /**
     * Handle WebSocket open event
     */
    handleOpen() {
        console.log('[WSClient] WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = this.config.initialReconnectDelay;
        
        // Send handshake
        this.sendHandshake();
        
        this.emit('connected');
    }

    /**
     * Handle WebSocket close event
     */
    handleClose(event) {
        console.log('[WSClient] WebSocket disconnected:', event.code, event.reason);
        this.connected = false;
        this.handshakeComplete = false;
        
        this.emit('disconnected', event);
        
        // Attempt reconnection
        this.attemptReconnect();
    }

    /**
     * Handle WebSocket error event
     */
    handleError(error) {
        console.error('[WSClient] WebSocket error:', error);
        this.emit('error', error);
    }

    /**
     * Handle incoming WebSocket message
     */
    handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('[WSClient] Received message:', message.type);
            
            // Validate session_id
            if (message.session_id !== this.sessionId) {
                console.warn('[WSClient] Session ID mismatch:', message.session_id, 'vs', this.sessionId);
                return;
            }
            
            // Route message based on type
            switch (message.type) {
                case 'handshake_ack':
                    this.handleHandshakeAck(message);
                    break;
                
                case 'agent_response':
                    this.emit('agent_response', message);
                    break;
                
                case 'tool_request':
                    this.emit('tool_request', message);
                    break;
                
                case 'typing_indicator':
                    this.emit('typing_indicator', message);
                    break;
                
                case 'error':
                    console.error('[WSClient] Server error:', message.error_code, message.message);
                    this.emit('error', message);
                    break;
                
                default:
                    console.warn('[WSClient] Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('[WSClient] Error parsing message:', error);
        }
    }

    /**
     * Send handshake message
     */
    sendHandshake() {
        console.log('[WSClient] Sending handshake');
        this.send({
            type: 'handshake',
            session_id: this.sessionId,
            client_version: this.config.clientVersion,
        });
    }

    /**
     * Handle handshake acknowledgment
     */
    handleHandshakeAck(message) {
        console.log('[WSClient] Handshake acknowledged:', message.status);
        this.handshakeComplete = true;
        
        // Process queued messages
        this.flushMessageQueue();
        
        this.emit('handshake_ack', message);
    }

    /**
     * Attempt to reconnect with exponential backoff
     */
    attemptReconnect() {
        // Clear any existing reconnect timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        
        // Check if max attempts reached
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            console.error('[WSClient] Max reconnection attempts reached');
            this.emit('max_reconnect_reached');
            return;
        }
        
        this.reconnectAttempts++;
        console.log(`[WSClient] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
        
        this.reconnectTimeout = setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);
        
        // Exponential backoff
        this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.config.maxReconnectDelay
        );
    }

    /**
     * Send message to server
     */
    send(message) {
        // Ensure session_id is set
        if (!message.session_id) {
            message.session_id = this.sessionId;
        }
        
        // Add timestamp if not present
        if (!message.timestamp) {
            message.timestamp = new Date().toISOString();
        }
        
        // ✅ FIX #1: Allow handshake messages to bypass handshakeComplete check
        const isHandshake = message.type === 'handshake';
        const canSend = this.ws && 
                        this.ws.readyState === WebSocket.OPEN && 
                        (this.handshakeComplete || isHandshake);
        
        if (canSend) {
            try {
                this.ws.send(JSON.stringify(message));
                console.log('[WSClient] Sent message:', message.type);
            } catch (error) {
                console.error('[WSClient] Error sending message:', error);
                this.messageQueue.push(message);
            }
        } else {
            // Queue message for later
            console.log('[WSClient] Queueing message (not ready):', message.type);
            this.messageQueue.push(message);
        }
    }

    /**
     * Flush queued messages
     */
    flushMessageQueue() {
        if (this.messageQueue.length === 0) {
            return;
        }
        
        console.log(`[WSClient] Flushing ${this.messageQueue.length} queued messages`);
        
        const queue = [...this.messageQueue];
        this.messageQueue = [];
        
        queue.forEach(message => {
            this.send(message);
        });
    }

    /**
     * Send user message to agent
     */
    sendUserMessage(content) {
        this.send({
            type: 'user_message',
            content: content,
        });
    }

    /**
     * Send tool execution result
     */
    sendToolResult(requestId, success, data, error, executionTimeMs) {
        this.send({
            type: 'tool_result',
            request_id: requestId,
            success: success,
            data: data || null,
            error: error || null,
            execution_time_ms: executionTimeMs,
        });
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        console.log('[WSClient] Disconnecting');
        
        // Clear reconnect timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        // Close WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.connected = false;
        this.handshakeComplete = false;
    }

    /**
     * Check if client is connected and ready
     */
    isReady() {
        return this.connected && this.handshakeComplete;
    }

    /**
     * Get connection state
     */
    getState() {
        return {
            connected: this.connected,
            handshakeComplete: this.handshakeComplete,
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length,
            readyState: this.ws ? this.ws.readyState : null,
        };
    }
}

// Export as ES6 module for ComfyUI
export default WSClient;
