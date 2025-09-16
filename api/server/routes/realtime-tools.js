const express = require('express');
const router = express.Router();
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { logger } = require('~/config');
const { Constants } = require('librechat-data-provider');

/**
 * Execute MCP tool for realtime voice conversations
 */
router.post('/execute', requireJwtAuth, async (req, res) => {
  try {
    const { toolName, args } = req.body;
    logger.debug('[realtime-tools] Tool execution request:', { toolName, args });

    // Parse MCP tool name if it includes the delimiter
    // Format is: actualToolName_mcp_serverName
    let actualToolName = toolName;
    let mcpServerName = null;
    
    if (toolName.includes(Constants.mcp_delimiter)) {
      const parts = toolName.split(Constants.mcp_delimiter);
      // First part is the actual tool name
      actualToolName = parts[0];
      // Everything after _mcp_ is the server name
      mcpServerName = parts.slice(1).join(Constants.mcp_delimiter);
      
      logger.debug('[realtime-tools] Parsed tool name:', { 
        originalName: toolName, 
        actualToolName, 
        mcpServerName 
      });
    }

    // Get the MCP manager
    const { getMCPManager } = require('~/config');
    const mcpManager = getMCPManager();
    
    if (!mcpManager) {
      logger.error('[realtime-tools] MCP manager not available');
      return res.status(500).json({ error: 'MCP service not available' });
    }

    // Execute the tool through MCP
    try {
      logger.info('[realtime-tools] Executing MCP tool:', { 
        actualToolName, 
        mcpServerName, 
        args 
      });
      
      // Create a minimal flow manager for this request
      const { FlowStateManager } = require('@librechat/api');
      const { CacheKeys } = require('librechat-data-provider');
      const { getLogStores } = require('~/cache');
      
      // Use the FLOWS cache key for flow state management
      const cache = getLogStores(CacheKeys.FLOWS);
      const flowManager = new FlowStateManager(cache);
      
      // The callTool expects an object with specific parameters
      const result = await mcpManager.callTool({
        serverName: mcpServerName,
        toolName: actualToolName,
        provider: 'agents', // Using agents provider for MCP tools
        toolArguments: args,
        user: req.user,
        flowManager: flowManager
      });
      
      logger.debug('[realtime-tools] Tool execution result:', result);
      
      res.json({ 
        success: true, 
        result 
      });
    } catch (toolError) {
      logger.error('[realtime-tools] Tool execution error:', toolError);
      res.status(500).json({ 
        error: 'Tool execution failed', 
        details: toolError.message 
      });
    }
  } catch (error) {
    logger.error('[realtime-tools] Error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

module.exports = router;