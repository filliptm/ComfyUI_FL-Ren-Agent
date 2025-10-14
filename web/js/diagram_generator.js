/**
 * Diagram Generator - Utilities for generating and formatting Mermaid diagrams
 * 
 * This module provides helper functions for generating Mermaid diagrams from
 * ComfyUI workflow data, formatting diagram code, and validating diagram syntax.
 * 
 * @module diagram_generator
 */

/**
 * DiagramGenerator class - Generate Mermaid diagrams from workflow data
 */
export class DiagramGenerator {
    constructor() {
        console.log('[DiagramGenerator] Initialized');
    }

    /**
     * Generate a Mermaid flowchart from nodes
     * @param {Array} nodes - Array of workflow nodes
     * @param {Object} options - Diagram options
     * @returns {string} Mermaid diagram code
     */
    generateFlowchart(nodes, options = {}) {
        const {
            direction = 'LR',
            includeConnections = true,
            includeParameters = false,
            maxLabelLength = 30
        } = options;

        let diagram = `flowchart ${direction}\n`;

        // Add nodes
        for (const node of nodes) {
            const label = this._formatNodeLabel(node, includeParameters, maxLabelLength);
            const nodeId = this._sanitizeId(node.id);
            const shape = this._getNodeShape(node.type);

            diagram += `    ${nodeId}${shape[0]}"${label}"${shape[1]}\n`;
        }

        // Add connections
        if (includeConnections) {
            for (const node of nodes) {
                if (node.inputs) {
                    for (const input of node.inputs) {
                        if (input.link) {
                            const sourceNode = nodes.find(n => 
                                n.outputs?.some(o => o.links?.includes(input.link))
                            );
                            if (sourceNode) {
                                const sourceId = this._sanitizeId(sourceNode.id);
                                const targetId = this._sanitizeId(node.id);
                                const linkLabel = input.name ? `|${input.name}|` : '';
                                diagram += `    ${sourceId} -->${linkLabel} ${targetId}\n`;
                            }
                        }
                    }
                }
            }
        }

        return diagram;
    }

    /**
     * Generate a Mermaid graph from nodes
     * @param {Array} nodes - Array of workflow nodes
     * @param {Object} options - Diagram options
     * @returns {string} Mermaid diagram code
     */
    generateGraph(nodes, options = {}) {
        const {
            direction = 'LR',
            includeLabels = true,
            maxLabelLength = 30
        } = options;

        let diagram = `graph ${direction}\n`;

        // Add nodes
        for (const node of nodes) {
            const nodeId = this._sanitizeId(node.id);
            
            if (includeLabels) {
                const label = this._truncate(node.title || node.type, maxLabelLength);
                diagram += `    ${nodeId}["${label}"]\n`;
            } else {
                diagram += `    ${nodeId}\n`;
            }
        }

        // Add connections
        for (const node of nodes) {
            if (node.inputs) {
                for (const input of node.inputs) {
                    if (input.link) {
                        const sourceNode = nodes.find(n => 
                            n.outputs?.some(o => o.links?.includes(input.link))
                        );
                        if (sourceNode) {
                            const sourceId = this._sanitizeId(sourceNode.id);
                            const targetId = this._sanitizeId(node.id);
                            diagram += `    ${sourceId} --> ${targetId}\n`;
                        }
                    }
                }
            }
        }

        return diagram;
    }

    /**
     * Generate a simple node list diagram
     * @param {Array} nodes - Array of workflow nodes
     * @returns {string} Mermaid diagram code
     */
    generateNodeList(nodes) {
        let diagram = 'graph TD\n';
        
        for (const node of nodes) {
            const nodeId = this._sanitizeId(node.id);
            const label = `${node.type}<br/>${node.title || ''}`;
            diagram += `    ${nodeId}["${label}"]\n`;
        }
        
        return diagram;
    }

    /**
     * Generate a workflow statistics diagram
     * @param {Object} stats - Workflow statistics
     * @returns {string} Mermaid diagram code
     */
    generateStatsChart(stats) {
        let diagram = 'pie title Workflow Nodes\n';
        
        if (stats.nodes_by_type) {
            for (const [type, count] of Object.entries(stats.nodes_by_type)) {
                diagram += `    "${type}" : ${count}\n`;
            }
        }
        
        return diagram;
    }

    /**
     * Format node label with optional parameters
     * @private
     */
    _formatNodeLabel(node, includeParameters = false, maxLength = 30) {
        let label = node.title || node.type;
        
        if (includeParameters && node.parameters) {
            const params = Object.entries(node.parameters)
                .slice(0, 2)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            
            if (params) {
                label += `<br/><small>${params}</small>`;
            }
        }
        
        return this._truncate(label, maxLength);
    }

    /**
     * Get node shape based on type
     * @private
     */
    _getNodeShape(nodeType) {
        // Map node types to Mermaid shapes
        const shapeMap = {
            'KSampler': ['[[', ']]'],           // Subroutine shape
            'CheckpointLoader': ['[(', ')]'],   // Stadium shape
            'VAEDecode': ['>', ']'],            // Asymmetric shape
            'VAEEncode': ['>', ']'],            // Asymmetric shape
            'SaveImage': ['[/', '\\]'],        // Trapezoid
            'LoadImage': ['[\\', '/]'],        // Trapezoid inverted
            'CLIPTextEncode': ['([', '])'],     // Circle
            'default': ['[', ']']               // Rectangle
        };
        
        return shapeMap[nodeType] || shapeMap['default'];
    }

    /**
     * Sanitize ID for Mermaid
     * @private
     */
    _sanitizeId(id) {
        return `node_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    /**
     * Truncate text to max length
     * @private
     */
    _truncate(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    /**
     * Validate Mermaid diagram syntax
     * @param {string} diagram - Mermaid diagram code
     * @returns {Object} Validation result {valid: boolean, error: string}
     */
    validateDiagram(diagram) {
        try {
            // Basic validation
            if (!diagram || diagram.trim().length === 0) {
                return { valid: false, error: 'Diagram is empty' };
            }

            // Check for diagram type
            const validTypes = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'pie', 'gantt'];
            const firstLine = diagram.trim().split('\n')[0];
            const hasValidType = validTypes.some(type => firstLine.startsWith(type));

            if (!hasValidType) {
                return { valid: false, error: 'Invalid diagram type' };
            }

            return { valid: true, error: null };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    /**
     * Format diagram code for display
     * @param {string} diagram - Mermaid diagram code
     * @returns {string} Formatted diagram code
     */
    formatDiagram(diagram) {
        // Add proper indentation and spacing
        const lines = diagram.split('\n');
        const formatted = lines.map((line, i) => {
            if (i === 0) return line; // Don't indent first line
            return line.trim() ? `    ${line.trim()}` : '';
        });
        
        return formatted.join('\n');
    }

    /**
     * Create a markdown code block with Mermaid diagram
     * @param {string} diagram - Mermaid diagram code
     * @returns {string} Markdown formatted diagram
     */
    toMarkdown(diagram) {
        return `\`\`\`mermaid\n${diagram}\n\`\`\``;
    }

    /**
     * Extract Mermaid diagrams from markdown text
     * @param {string} markdown - Markdown text
     * @returns {Array} Array of diagram codes
     */
    extractDiagrams(markdown) {
        const diagrams = [];
        const regex = /```mermaid\n([\s\S]*?)```/g;
        let match;

        while ((match = regex.exec(markdown)) !== null) {
            diagrams.push(match[1].trim());
        }

        return diagrams;
    }

    /**
     * Generate a workflow overview diagram
     * @param {Object} overview - Workflow overview data
     * @returns {string} Mermaid diagram code
     */
    generateOverviewDiagram(overview) {
        let diagram = 'graph TD\n';
        
        // Summary box
        diagram += `    summary["📊 Workflow Summary<br/>"]
`;
        diagram += `    summary --> total["Total Nodes: ${overview.total_nodes}"]
`;
        diagram += `    summary --> active["Active Nodes: ${overview.active_nodes}"]
`;
        diagram += `    summary --> bypassed["Bypassed Nodes: ${overview.bypassed_nodes}"]
`;
        
        if (overview.disconnected_nodes > 0) {
            diagram += `    summary --> disconnected["⚠️ Disconnected: ${overview.disconnected_nodes}"]
`;
        }
        
        // Node types
        if (overview.nodes_by_type && Object.keys(overview.nodes_by_type).length > 0) {
            diagram += `    summary --> types["Node Types"]
`;
            
            const sortedTypes = Object.entries(overview.nodes_by_type)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            
            for (const [type, count] of sortedTypes) {
                const typeId = this._sanitizeId(type);
                diagram += `    types --> ${typeId}["${type}: ${count}"]
`;
            }
        }
        
        return diagram;
    }

    /**
     * Generate a connection diagram for a specific node
     * @param {Object} node - Node object
     * @param {Array} connectedNodes - Connected nodes
     * @returns {string} Mermaid diagram code
     */
    generateConnectionDiagram(node, connectedNodes) {
        let diagram = 'graph LR\n';
        
        const nodeId = this._sanitizeId(node.id);
        const nodeLabel = node.title || node.type;
        
        // Center node
        diagram += `    ${nodeId}(["${nodeLabel}"])\n`;
        
        // Input connections
        const inputs = connectedNodes.filter(n => n.direction === 'input');
        for (const input of inputs) {
            const inputId = this._sanitizeId(input.id);
            const inputLabel = this._truncate(input.title || input.type, 20);
            diagram += `    ${inputId}["${inputLabel}"] --> ${nodeId}\n`;
        }
        
        // Output connections
        const outputs = connectedNodes.filter(n => n.direction === 'output');
        for (const output of outputs) {
            const outputId = this._sanitizeId(output.id);
            const outputLabel = this._truncate(output.title || output.type, 20);
            diagram += `    ${nodeId} --> ${outputId}["${outputLabel}"]\n`;
        }
        
        return diagram;
    }
}
