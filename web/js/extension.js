/**
 * FL_JS Agentic System - ComfyUI Extension
 * 
 * Provides AI-powered workflow assistance via natural language chat interface.
 * Requires FL_JS backend server to be running.
 * 
 * Backend server must be started separately:
 *     cd backend
 *     python server.py
 */

import { app } from "../../scripts/app.js";
import SessionManager from "./session_manager.js";
import WSClient from "./ws_client.js";
import { ToolExecutor } from "./tool_executor.js";
import { ChatUI } from "./chat_ui.js";
import { DiagramGenerator } from "./diagram_generator.js";

let chatUI = null;
let wsClient = null;
let toolExecutor = null;
let diagramGenerator = null;

app.registerExtension({
    name: "fl_js.agentic_system",
    
    async setup() {
        console.log("[FL_JS] Initializing Agentic System extension...");
        
        try {
            // Initialize session manager
            const sessionManager = new SessionManager();
            const sessionId = sessionManager.getSessionId();
            
            console.log(`[FL_JS] Session ID: ${sessionId}`);
            
            // Initialize WebSocket client
            wsClient = new WSClient(sessionId, {
                url: 'ws://localhost:8000/ws',  // TODO: Make configurable
                heartbeatInterval: 30000,
                maxReconnectAttempts: 5,
            });
            
            // Initialize diagram generator
            diagramGenerator = new DiagramGenerator();
            console.log("[FL_JS] Diagram generator initialized");
            
            // Initialize tool executor
            toolExecutor = new ToolExecutor(wsClient);
            console.log("[FL_JS] Tool executor initialized");
            
            // Set up WebSocket event handlers
            wsClient.onConnect = () => {
                console.log("[FL_JS] Connected to backend server");
            };
            
            wsClient.onDisconnect = (event) => {
                console.log("[FL_JS] Disconnected from backend server:", event.code);
            };
            
            wsClient.onHandshakeAck = (message) => {
                console.log("[FL_JS] Handshake complete:", message.status);
                if (message.status === 'reconnected') {
                    console.log("[FL_JS] Reconnected to existing session");
                }
            };
            
            wsClient.onAgentResponse = (message) => {
                console.log("[FL_JS] Agent response received:", message.content);
            };
            
            wsClient.onToolRequest = async (message) => {
                console.log("[FL_JS] Tool request received:", message.tool_name);
                // Execute tool via tool executor
                await toolExecutor.executeToolRequest(message);
            };
            
            wsClient.onTypingIndicator = (message) => {
                console.log("[FL_JS] Agent is typing...");
            };
            
            wsClient.onError = (error) => {
                console.error("[FL_JS] Error:", error);
            };
            
            wsClient.onMaxReconnectReached = () => {
                console.error("[FL_JS] Max reconnection attempts reached. Please check backend server.");
            };
            
            // Store instances globally for other modules
            window.FL_JS = {
                sessionManager,
                wsClient,
                toolExecutor,
                diagramGenerator,
                chatUI: null, // Will be set when sidebar is rendered
                app,
                version: '0.3.0',
            };
            
            // Connect to backend
            console.log("[FL_JS] Connecting to backend server...");
            wsClient.connect();
            
            console.log("[FL_JS] Extension initialized successfully!");
            console.log("[FL_JS] Note: Backend server must be running (cd backend && python server.py)");
            
        } catch (error) {
            console.error("[FL_JS] Failed to initialize extension:", error);
        }
    },
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Hook for modifying node definitions before registration
        // Currently unused, but available for future enhancements
    },
    
    async nodeCreated(node) {
        // Hook for when a node instance is created
        // Currently unused, but available for future enhancements
    },
});

// Register sidebar tab
app.registerExtension({
    name: "fl_js.sidebar",
    
    async setup() {
        // Wait for app to be ready
        await new Promise(resolve => {
            if (app.extensionManager) {
                resolve();
            } else {
                const interval = setInterval(() => {
                    if (app.extensionManager) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
            }
        });
        
        console.log("[FL_JS] Registering sidebar tab...");
        
        try {
            app.extensionManager.registerSidebarTab({
                id: "fl_js_assistant",
                icon: "pi pi-comments",
                title: "FL_JS Assistant",
                tooltip: "AI assistant for workflow creation and modification",
                type: "custom",
                render: (el) => {
                    console.log("[FL_JS] Rendering sidebar tab...");
                    
                    // Initialize chat UI on first render
                    if (!chatUI) {
                        chatUI = new ChatUI(el, wsClient);
                        window.FL_JS.chatUI = chatUI;
                        console.log("[FL_JS] Chat UI initialized in sidebar");
                    }
                    
                    return el;
                },
                destroy: () => {
                    console.log("[FL_JS] Destroying sidebar tab...");
                    if (chatUI) {
                        chatUI.destroy();
                        chatUI = null;
                        window.FL_JS.chatUI = null;
                    }
                }
            });
            
            console.log("[FL_JS] Sidebar tab registered successfully!");
        } catch (error) {
            console.error("[FL_JS] Failed to register sidebar tab:", error);
            console.error("[FL_JS] Note: Make sure you're using a ComfyUI version that supports sidebar tabs");
        }
    }
});

console.log("[FL_JS] Extension module loaded");
