/**
 * Ren PWA - Main Application
 * 
 * Mobile Progressive Web App for controlling ComfyUI via Ren assistant.
 */

import SessionManager from '/js/session_manager.js';
import WSClient from '/js/ws_client.js';
import { ChatUI } from '/js/chat_ui.js';
import { getToolConfig } from '/js/tool_activity.js';

class RenPWA {
    constructor() {
        this.sessionManager = null;
        this.wsClient = null;
        this.chatUI = null;
        this.currentSessionId = null;
        this.notificationsEnabled = false;
        this.isAppVisible = true;
        
        // Get backend URL from current location
        this.backendUrl = this.getBackendUrl();
        
        console.log('[RenPWA] Initializing...');
        console.log('[RenPWA] Backend URL:', this.backendUrl);
        
        this.init();
    }
    
    /**
     * Get backend URL based on current location
     */
    getBackendUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws`;
    }
    
    /**
     * Initialize PWA
     */
    async init() {
        // Setup visibility tracking
        this.setupVisibilityTracking();
        
        // Show session picker
        await this.showSessionPicker();
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    /**
     * Setup visibility tracking for notifications
     */
    setupVisibilityTracking() {
        document.addEventListener('visibilitychange', () => {
            this.isAppVisible = !document.hidden;
            console.log('[RenPWA] App visibility:', this.isAppVisible ? 'visible' : 'hidden');
        });
    }
    
    /**
     * Request notification permission
     */
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.log('[RenPWA] Notifications not supported');
            return false;
        }
        
        if (Notification.permission === 'granted') {
            this.notificationsEnabled = true;
            return true;
        }
        
        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            this.notificationsEnabled = permission === 'granted';
            console.log('[RenPWA] Notification permission:', permission);
            return this.notificationsEnabled;
        }
        
        return false;
    }
    
    /**
     * Show browser notification (only when app is backgrounded)
     */
    showNotification(title, options = {}) {
        // Only show notification if app is not visible
        if (this.isAppVisible) {
            console.log('[RenPWA] App visible, skipping notification');
            return;
        }
        
        if (!this.notificationsEnabled) {
            console.log('[RenPWA] Notifications not enabled');
            return;
        }
        
        const notification = new Notification(title, {
            icon: '/pwa/static/icons/icon-192.png',
            badge: '/pwa/static/icons/icon-192.png',
            ...options,
        });
        
        // Focus app when notification is clicked
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        console.log('[RenPWA] Notification shown:', title);
    }
    
    /**
     * Add system message to chat
     */
    addSystemMessage(content, renLinks = []) {
        if (!this.chatUI) return;
        
        // Create system message with Ren links
        const message = {
            type: 'system_message',
            content: content,
            renLinks: renLinks,
            timestamp: new Date().toISOString(),
        };
        
        // Add to chat UI
        this.chatUI.addSystemMessage(message);
    }
    
    /**
     * Handle execution success event
     */
    handleExecutionSuccess(data) {
        const promptId = data.prompt_id;
        const execution = data.execution || {};
        const startTime = execution.start_time ? new Date(execution.start_time) : null;
        const endTime = execution.end_time ? new Date(execution.end_time) : new Date();
        const duration = startTime ? ((endTime - startTime) / 1000).toFixed(1) : '?';
        
        console.log('[RenPWA] Execution success:', promptId, `${duration}s`);
        
        // Show notification (only if backgrounded)
        this.showNotification('✨ Workflow Complete!', {
            body: `Finished in ${duration}s`,
            tag: 'workflow-success',
        });
        
        // Add system message to chat
        this.addSystemMessage(
            `✅ **Workflow completed successfully** in ${duration}s`,
            [
                { text: 'Show me the output', action: 'Show me the output' },
            ]
        );
    }
    
    /**
     * Handle execution error event
     */
    handleExecutionError(data) {
        const promptId = data.prompt_id;
        const nodeId = data.node_id;
        const nodeType = data.node_type;
        const exceptionType = data.exception_type;
        const exceptionMessage = data.exception_message || 'Unknown error';
        
        console.log('[RenPWA] Execution error:', nodeType, exceptionMessage);
        
        // Show notification (only if backgrounded)
        this.showNotification('❌ Workflow Error', {
            body: `${nodeType} failed: ${exceptionMessage.substring(0, 100)}`,
            tag: 'workflow-error',
        });
        
        // Add system message to chat
        let errorDetails = `⚠️ **Workflow error in node ${nodeId}**\n\n`;
        errorDetails += `**Type:** ${nodeType}\n`;
        errorDetails += `**Error:** ${exceptionMessage}\n`;
        
        this.addSystemMessage(
            errorDetails,
            [
                { text: 'Help me debug this', action: 'Help me debug this error' },
                { text: 'Show me the workflow', action: 'Show me the workflow' },
            ]
        );
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Refresh sessions button
        const refreshBtn = document.getElementById('refresh-sessions');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadSessions());
        }
    }
    
    /**
     * Show session picker and load available sessions
     */
    async showSessionPicker() {
        const picker = document.getElementById('session-picker');
        const chatContainer = document.getElementById('chat-container');
        
        picker.style.display = 'flex';
        chatContainer.style.display = 'none';
        
        await this.loadSessions();
    }
    
    /**
     * Load available sessions from backend
     */
    async loadSessions() {
        const sessionList = document.getElementById('session-list');
        sessionList.innerHTML = '<div class="loading">Loading sessions...</div>';
        
        try {
            const response = await fetch(`${window.location.origin}/api/sessions`);
            const data = await response.json();
            
            console.log('[RenPWA] Loaded sessions:', data);
            
            if (data.sessions.length === 0) {
                sessionList.innerHTML = `
                    <div class="no-sessions">
                        <p>🚫 No active sessions found</p>
                        <p class="hint">Open ComfyUI with FL_JS extension to create a session</p>
                    </div>
                `;
                return;
            }
            
            // Filter to show only sessions with frontend connection
            const activeSessions = data.sessions.filter(s => s.has_frontend);
            
            if (activeSessions.length === 0) {
                sessionList.innerHTML = `
                    <div class="no-sessions">
                        <p>🚫 No ComfyUI sessions found</p>
                        <p class="hint">Sessions exist but no ComfyUI frontend is connected</p>
                    </div>
                `;
                return;
            }
            
            // Render session list
            sessionList.innerHTML = activeSessions.map(session => `
                <div class="session-card" data-session-id="${session.session_id}">
                    <div class="session-info">
                        <div class="session-id">${session.session_id.substring(0, 8)}...</div>
                        <div class="session-status">
                            ${session.has_frontend ? '<span class="status-badge frontend">💻 ComfyUI</span>' : ''}
                            ${session.has_pwa ? '<span class="status-badge pwa">📱 Mobile</span>' : ''}
                        </div>
                        <div class="session-time">Last active: ${this.formatTime(session.last_activity)}</div>
                    </div>
                    <button class="btn-connect" data-session-id="${session.session_id}">
                        Connect →
                    </button>
                </div>
            `).join('');
            
            // Add click handlers to connect buttons
            sessionList.querySelectorAll('.btn-connect').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const sessionId = e.target.dataset.sessionId;
                    this.connectToSession(sessionId);
                });
            });
            
        } catch (error) {
            console.error('[RenPWA] Failed to load sessions:', error);
            sessionList.innerHTML = `
                <div class="error">
                    <p>❌ Failed to load sessions</p>
                    <p class="hint">${error.message}</p>
                </div>
            `;
        }
    }
    
    /**
     * Connect to a specific session
     */
    async connectToSession(sessionId) {
        console.log('[RenPWA] Connecting to session:', sessionId);
        
        this.currentSessionId = sessionId;
        
        // Request notification permission
        await this.requestNotificationPermission();
        
        // Hide session picker, show chat
        const picker = document.getElementById('session-picker');
        const chatContainer = document.getElementById('chat-container');
        
        picker.style.display = 'none';
        chatContainer.style.display = 'flex';
        
        // Initialize WebSocket client with PWA identifier
        this.wsClient = new WSClient(sessionId, {
            url: this.backendUrl,
            clientVersion: '1.0.0-pwa',  // Identifies as PWA connection
            maxReconnectAttempts: 10,
        });
        
        // Initialize Chat UI
        this.chatUI = new ChatUI(chatContainer, this.wsClient);
        
        // Setup WebSocket event handlers
        this.setupWebSocketHandlers();
        
        // Connect
        this.wsClient.connect();
        
        console.log('[RenPWA] Chat UI initialized');
    }
    
    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.wsClient.on('connected', () => {
            console.log('[RenPWA] Connected to backend');
        });
        
        this.wsClient.on('disconnected', () => {
            console.log('[RenPWA] Disconnected from backend');
            // Could show reconnection UI here
        });
        
        this.wsClient.on('handshake_ack', (message) => {
            console.log('[RenPWA] Handshake complete:', message.status);
        });
        
        this.wsClient.on('error', (error) => {
            console.error('[RenPWA] Error:', error);
        });
        
        this.wsClient.on('max_reconnect_reached', () => {
            console.error('[RenPWA] Max reconnection attempts reached');
            // Show error UI and option to return to session picker
            if (confirm('Connection lost. Return to session picker?')) {
                this.showSessionPicker();
            }
        });
        
        // Listen for execution events
        this.wsClient.on('execution_success', (data) => {
            this.handleExecutionSuccess(data);
        });
        
        this.wsClient.on('execution_error', (data) => {
            this.handleExecutionError(data);
        });
        
        // Listen for tool execution events (for breadcrumb display)
        this.wsClient.on('tool_request', (message) => {
            console.log('[RenPWA] Tool request:', message.tool_name);
            
            try {
                const toolConfig = getToolConfig(message.tool_name);
                this.chatUI?.startToolInChain(
                    message.tool_name,
                    toolConfig.icon,
                    toolConfig.label
                );
            } catch (error) {
                console.warn('[RenPWA] Could not start tool in breadcrumb chain:', error);
            }
        });
        
        this.wsClient.on('tool_report', (message) => {
            console.log('[RenPWA] Tool report:', message.tool_name);
            
            try {
                const toolConfig = getToolConfig(message.tool_name);
                this.chatUI?.startToolInChain(
                    message.tool_name,
                    toolConfig.icon,
                    toolConfig.label
                );
                // Mark as complete immediately for Python-only tools
                this.chatUI?.completeToolInChain(message.tool_name);
            } catch (error) {
                console.warn('[RenPWA] Could not add tool to breadcrumb chain:', error);
            }
        });
    }
    
    /**
     * Format ISO timestamp to relative time
     */
    formatTime(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
}

// Initialize PWA when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.renPWA = new RenPWA();
    });
} else {
    window.renPWA = new RenPWA();
}

console.log('[RenPWA] Module loaded');