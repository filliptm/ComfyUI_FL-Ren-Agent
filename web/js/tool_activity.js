/**
 * Tool Activity Visualization for FL_JS
 * Shows floating cards when tools are executing
 */

/**
 * Tool configuration registry
 * Single source of truth for tool icons, labels, and descriptions
 */
export const TOOL_CONFIG = {
    // Query & Understanding
    "workflow_overview": {
        icon: "🔍",
        label: "Overview",
        description: "Getting workflow summary and statistics"
    },
    "query_workflow": {
        icon: "🔎", 
        label: "Query",
        description: "Searching workflow nodes and connections"
    },
    "workflow_diagram": {
        icon: "📐",
        label: "Diagram",
        description: "Generating visual workflow diagram"
    },

    // Node Creation & Modification  
    "create_nodes": {
        icon: "✨",
        label: "Create",
        description: "Adding new nodes to workflow"
    },
    "remove_nodes": {
        icon: "🗑️",
        label: "Remove",
        description: "Deleting nodes from workflow"
    },
    "connect_nodes": {
        icon: "🔗",
        label: "Connect",
        description: "Linking nodes together"
    },
    
    // Selection & Focus
    "select_nodes": {
        icon: "👁️",
        label: "Select",
        description: "Selecting nodes in canvas"
    },
    "find_node": {
        icon: "🎯",
        label: "Find",
        description: "Locating specific node by criteria"
    },
    "get_current_node_selection": {
        icon: "👁️",
        label: "Get Selection",
        description: "Reading currently selected nodes"
    },

    // Layout & Organization
    "modify_layout": {
        icon: "🏗️",
        label: "Layout",
        description: "Adjusting node positions and layout"
    },
    "get_layout": {
        icon: "📐",
        label: "Get Layout",
        description: "Reading current layout configuration"
    },

    // Workflow Execution
    "queue_workflow": {
        icon: "🚀",
        label: "Queue",
        description: "Starting workflow execution"
    },
    "cancel_workflow": {
        icon: "⏹️",
        label: "Cancel",
        description: "Stopping workflow execution"
    },
    "get_queue_status": {
        icon: "📊",
        label: "Status",
        description: "Checking execution queue status"
    },
    "enable_auto_queue": {
        icon: "🔄",
        label: "Auto Queue",
        description: "Enabling auto-queue on changes"
    },
    "disable_auto_queue": {
        icon: "⏸️",
        label: "Stop Auto",
        description: "Disabling auto-queue mode"
    },
    "set_batch_count": {
        icon: "🔢",
        label: "Batch Count",
        description: "Setting number of batch iterations"
    },

    // Node Value Manipulation
    "set_node_values": {
        icon: "⚙️",
        label: "Set Values",
        description: "Updating node widget values"
    },
    "get_node_values": {
        icon: "📊",
        label: "Get Values",
        description: "Reading node widget values"
    },
    "get_node_slots": {
        icon: "🔌",
        label: "Get Slots",
        description: "Reading node input/output slots"
    },

    // Node State
    "bypass_nodes": {
        icon: "🚫",
        label: "Bypass",
        description: "Disabling nodes without removing them"
    },
    "unbypass_nodes": {
        icon: "✅",
        label: "Unbypass",
        description: "Re-enabling bypassed nodes"
    },
    "pin_nodes": {
        icon: "📌",
        label: "Pin",
        description: "Preventing nodes from moving"
    },
    "unpin_nodes": {
        icon: "📍",
        label: "Unpin",
        description: "Allowing nodes to be repositioned"
    },

    // Connection Operations
    "connect_nodes_batch": {
        icon: "🔗",
        label: "Batch Connect",
        description: "Creating multiple node connections"
    },
    "auto_connect_workflow": {
        icon: "🧩",
        label: "Auto Connect",
        description: "Automatically connecting compatible nodes"
    },

    // Utilities & Generation
    "generate_seed": {
        icon: "🌱",
        label: "Seed",
        description: "Generating random seed value"
    },
    "generate_float": {
        icon: "🎲",
        label: "Random Float",
        description: "Generating random decimal number"
    },
    "generate_int": {
        icon: "🎲",
        label: "Random Int",
        description: "Generating random integer"
    },
    "random_choice": {
        icon: "🎯",
        label: "Random Choice",
        description: "Selecting random item from list"
    },

    // System Control
    "disable_sleep": {
        icon: "☕",
        label: "Keep Awake",
        description: "Preventing system from sleeping"
    },
    "enable_sleep": {
        icon: "😴",
        label: "Allow Sleep",
        description: "Allowing system sleep again"
    },
    "disable_screensaver": {
        icon: "🖥️",
        label: "No Screensaver",
        description: "Disabling screensaver during execution"
    },
    "enable_screensaver": {
        icon: "🌙",
        label: "Screensaver",
        description: "Re-enabling screensaver"
    },
    "send_images": {
        icon: "📤",
        label: "Send Images",
        description: "Sending generated images to chat"
    },

    // Python-only tools
    "calculate_expressions": {
        icon: "🧮",
        label: "Calculate",
        description: "Evaluating math expressions"
    },
    "wait": {
        icon: "⏳",
        label: "Wait",
        description: "Pausing execution for delay"
    },

    // ComfyUI File Operations
    "comfy_list_folders": {
        icon: "📂",
        label: "List Folders",
        description: "Browsing ComfyUI directory structure"
    },
    "comfy_read_file": {
        icon: "📄",
        label: "Read File",
        description: "Reading ComfyUI resource files"
    },
    "comfy_search_resources": {
        icon: "🔍",
        label: "Search Resources",
        description: "Searching for models and resources"
    },

    // Node Library
    "node_library_search": {
        icon: "🔍",
        label: "Search Nodes",
        description: "Searching available node types"
    },
    "node_library_get_details": {
        icon: "📖",
        label: "Node Details",
        description: "Getting node type specifications"
    },
    "node_library_find_compatible": {
        icon: "🔗",
        label: "Find Compatible",
        description: "Finding nodes compatible with slot types"
    },

    // Manager Operations
    "manager_search_nodes": {
        icon: "🔍",
        label: "Search Manager",
        description: "Searching ComfyUI Manager database"
    },
    "manager_get_node_mappings": {
        icon: "🗺️",
        label: "Node Mappings",
        description: "Getting node-to-package mappings"
    },
    "manager_check_updates": {
        icon: "🔄",
        label: "Check Updates",
        description: "Checking for custom node updates"
    },

    // Error Tracking
    "get_recent_errors": {
        icon: "⚠️",
        label: "Recent Errors",
        description: "Retrieving recent execution errors"
    },
    "get_errors_for_run": {
        icon: "🔍",
        label: "Run Errors",
        description: "Getting errors for specific workflow run"
    },
    "clear_error_buffer": {
        icon: "🧹",
        label: "Clear Errors",
        description: "Clearing error tracking buffer"
    },

    // Execution Tracking
    "get_queue_status_details": {
        icon: "📊",
        label: "Queue Details",
        description: "Getting detailed queue information"
    },
    "get_execution_details": {
        icon: "🔍",
        label: "Execution Details",
        description: "Inspecting workflow execution progress"
    },

    // Generic fallback
    "*": {
        icon: "⚡",
        label: "Tool",
        description: "Executing tool operation"
    }
};

/**
 * Get tool configuration by name
 * @param {string} toolName - Name of the tool
 * @returns {object} - Icon, label, and description
 */
export function getToolConfig(toolName) {
    return TOOL_CONFIG[toolName] || TOOL_CONFIG["*"];
}

/**
 * Tool Activity Visualization
 * Shows floating cards when tools are executing
 */
export class ToolActivity {
    constructor(chatContainer) {
        this.chatContainer = chatContainer;
        this.activeCards = new Map(); // request_id -> {element, timeout}
        this.overlay = null;
        this.maxVisible = 3;
        this.autoCleanupMs = 30000; // 30 seconds fallback
        
        this._createOverlay();
        console.log('[ToolActivity] Initialized');
    }

    /**
     * Show tool activity card
     * @param {string} toolName - Name of the tool being executed
     * @param {string} requestId - Unique request identifier
     */
    showTool(toolName, requestId = 'default') {
        console.log(`[ToolActivity] Showing tool: ${toolName} (${requestId})`);
        
        // Get tool configuration from exported config
        const config = getToolConfig(toolName);
        
        // Create card element
        const card = this._createCard(config, requestId, toolName);
        
        // Add to active cards
        this._addCard(card, requestId);
        
        // Set fallback cleanup timer
        const timeout = setTimeout(() => {
            console.log(`[ToolActivity] Auto-cleanup for ${requestId}`);
            this.hideTool(requestId);
        }, this.autoCleanupMs);
        
        this.activeCards.get(requestId).timeout = timeout;
        
        // Add viewport verification
        requestAnimationFrame(() => {
            const rect = card.getBoundingClientRect();
            if (rect.top < 0 || rect.bottom > window.innerHeight) {
                console.warn('[ToolActivity] Card out of viewport:', rect);
                this._adjustCardPosition(card);
            }
        });
    }

    /**
     * Adjust card position if out of viewport
     * @private
     */
    _adjustCardPosition(card) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
            card.style.marginBottom = `${rect.bottom - window.innerHeight + 20}px`;
        }
    }

    /**
     * Hide specific tool card
     * @param {string} requestId - Request identifier to hide
     */
    hideTool(requestId) {
        const cardData = this.activeCards.get(requestId);
        if (!cardData) return;
        
        console.log(`[ToolActivity] Hiding tool: ${requestId}`);
        
        // Clear timeout
        if (cardData.timeout) {
            clearTimeout(cardData.timeout);
        }
        
        // Animate out and remove
        this._removeCard(requestId);
    }

    /**
     * Hide all active tool cards
     */
    hideAllTools() {
        console.log('[ToolActivity] Hiding all tools');
        
        const requestIds = Array.from(this.activeCards.keys());
        requestIds.forEach(requestId => {
            this.hideTool(requestId);
        });
    }

    /**
     * Create overlay container
     * @private
     */
    _createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'fl-tool-activity-overlay';
        
        // Insert below chat content instead of above input
        const chatContent = this.chatContainer.querySelector('.fl-chat-content');
        if (chatContent) {
            chatContent.appendChild(this.overlay);
        } else {
            // Fallback: append to container
            this.chatContainer.appendChild(this.overlay);
        }
    }

    /**
     * Create tool card element
     * @private
     */
    _createCard(config, requestId, toolName) {
        const card = document.createElement('div');
        card.className = 'fl-tool-card';
        card.dataset.requestId = requestId;
        card.dataset.toolName = toolName;
        
        card.innerHTML = `
            <div class="fl-tool-header">
                <span class="fl-tool-icon">${config.icon}</span>
                <span class="fl-tool-label">Ren is...</span>
            </div>
            <div class="fl-tool-text">${config.description}</div>
            <div class="fl-tool-activity">
                <div class="fl-activity-dot"></div>
                <div class="fl-activity-dot"></div>
                <div class="fl-activity-dot"></div>
            </div>
        `;
        
        return card;
    }

    /**
     * Add card to overlay with animation
     * @private
     */
    _addCard(card, requestId) {
        // Manage card limit
        this._enforceCardLimit();
        
        // Add to DOM
        this.overlay.appendChild(card);
        
        // Store reference
        this.activeCards.set(requestId, { element: card, timeout: null });
        
        // Trigger animation
        requestAnimationFrame(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        });
    }

    /**
     * Remove card with animation
     * @private
     */
    _removeCard(requestId) {
        const cardData = this.activeCards.get(requestId);
        if (!cardData) return;
        
        const card = cardData.element;
        
        // Animate out
        card.classList.add('exiting');
        
        // Remove after animation
        setTimeout(() => {
            if (card.parentNode) {
                card.parentNode.removeChild(card);
            }
            this.activeCards.delete(requestId);
        }, 300); // Match CSS animation duration
    }

    /**
     * Enforce maximum visible cards
     * @private
     */
    _enforceCardLimit() {
        if (this.activeCards.size >= this.maxVisible) {
            // Remove oldest card
            const oldestRequestId = this.activeCards.keys().next().value;
            this.hideTool(oldestRequestId);
        }
    }

    /**
     * Cleanup all cards (for disconnect/error scenarios)
     */
    cleanup() {
        console.log('[ToolActivity] Cleaning up all cards');
        this.hideAllTools();
    }

    /**
     * Get current activity status
     */
    getStatus() {
        return {
            activeCount: this.activeCards.size,
            activeTools: Array.from(this.activeCards.keys())
        };
    }
}