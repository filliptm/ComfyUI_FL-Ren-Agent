/**
 * Ren PWA - Main Application
 * 
 * Mobile Progressive Web App for controlling ComfyUI via Ren assistant.
 */

import SessionManager from '../js/session_manager.js';
import WSClient from '../js/ws_client.js';
import { ChatUI } from '../js/chat_ui.js';

class RenPWA {
    constructor() {
        this.sessionManager = null;
        this.wsClient = null;
        this.chatUI = null;
        this.currentSessionId = null;
        
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
        // Show session picker
        await this.showSessionPicker();
        
        // Setup event listeners
        this.setupEventListeners();
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