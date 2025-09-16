import { useState, useCallback, useRef, useEffect } from 'react';
import { RealtimeVoiceClient, ConnectionState, RealtimeVoiceConfig } from '~/services/RealtimeVoiceClient';
import { useAuthContext } from '~/hooks';
import { DEFAULT_VOICE_SYSTEM_PROMPT, DEFAULT_VOICE_GREETING, DEFAULT_VOICE } from '~/constants/voice';
import type { TMessage } from 'librechat-data-provider';

interface UseRealtimeVoiceOptions {
  conversationId?: string;
  systemPrompt?: string;
  voice?: RealtimeVoiceConfig['voice'];
  tools?: any[];
  agentOptions?: any;
  onTranscriptUpdate?: (messages: TMessage[]) => void;
  onError?: (error: Error) => void;
}

interface UseRealtimeVoiceReturn {
  connectionState: ConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  micLevel: number;
  speakerLevel: number;
  transcript: Array<{ role: 'user' | 'assistant' | 'tool'; text: string; plugin?: any }>;
  currentChunk: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMicrophone: () => void;
  toggleSpeaker: () => void;
  sendText: (text: string) => void;
}

export function useRealtimeVoice({
  conversationId,
  systemPrompt = DEFAULT_VOICE_SYSTEM_PROMPT,
  voice = DEFAULT_VOICE,
  tools = [],
  agentOptions,
  onTranscriptUpdate,
  onError
}: UseRealtimeVoiceOptions = {}): UseRealtimeVoiceReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [transcript, setTranscript] = useState<Array<{ 
    role: 'user' | 'assistant' | 'tool'; 
    text: string;
    plugin?: any;
  }>>([]);
  const [currentChunk, setCurrentChunk] = useState('');
  
  const accumulatedChunkRef = useRef<string>('');
  
  const voiceClientRef = useRef<RealtimeVoiceClient | null>(null);
  
  const handleTranscript = useCallback((text: string, role: 'user' | 'assistant', plugin?: any) => {
    setTranscript(prev => [...prev, { role, text, plugin }]);
    // Clear both the displayed chunk and the accumulated chunk
    setCurrentChunk('');
    accumulatedChunkRef.current = '';
    
    // Convert to TMessage format if callback provided
    if (onTranscriptUpdate) {
      const messages: TMessage[] = [...transcript, { role, text, plugin }].map((t, index) => ({
        messageId: `voice-${Date.now()}-${index}`,
        conversationId: conversationId || '',
        parentMessageId: index > 0 ? `voice-${Date.now()}-${index - 1}` : undefined,
        sender: t.role === 'user' ? 'User' : 'Assistant',
        text: t.text || '',
        isCreatedByUser: t.role === 'user',
        error: false,
        unfinished: false,
        clientId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Add plugin data for tool calls
        ...(t.plugin && { plugin: t.plugin })
      } as TMessage));
      
      onTranscriptUpdate(messages);
    }
  }, [transcript, conversationId, onTranscriptUpdate]);
  
  const { token } = useAuthContext();
  
  const handleTranscriptChunk = useCallback((chunk: string) => {
    // Accumulate chunks
    accumulatedChunkRef.current += chunk;
    // Update the displayed chunk with the accumulated text
    setCurrentChunk(accumulatedChunkRef.current);
  }, []);
  
  const handleResponseStart = useCallback(() => {
    // Clear the accumulated chunk when a new response starts
    accumulatedChunkRef.current = '';
    setCurrentChunk('');
  }, []);
  
  const handleToolCall = useCallback(async (callId: string, name: string, args: any) => {
    console.log('[useRealtimeVoice] Tool call received:', { callId, name, args });
    
    // Add tool call to transcript with proper structure for ToolCall component
    // Store the tool call in content_parts format for proper display
    const toolPlugin = {
      type: 'tool_call',
      tool_call: {
        id: callId,
        function: {
          name: name,
          arguments: JSON.stringify(args)
        }
      },
      // Keep old structure for backward compatibility
      loading: true,
      latest: name,
      inputs: [args],
      outputs: null,
      output: null,
      name: name.replace(/_mcp_.*$/, ''), // Remove MCP suffix for display
    };
    
    // Add the tool call as a message
    handleTranscript('', 'assistant', toolPlugin);
    
    // Execute the actual MCP tool
    try {
      const response = await fetch('/api/realtime-tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          toolName: name,
          args: args,
          conversationId: conversationId
        })
      });
      
      const data = await response.json();
      
      let toolResult;
      if (data.success && data.result) {
        // Format the result based on the tool response
        if (Array.isArray(data.result)) {
          // If it's an array of search results, format them
          toolResult = data.result.map((item: any) => 
            typeof item === 'object' ? JSON.stringify(item, null, 2) : item
          ).join('\n\n');
        } else if (typeof data.result === 'object') {
          toolResult = JSON.stringify(data.result, null, 2);
        } else {
          toolResult = String(data.result);
        }
      } else {
        toolResult = data.error || 'Tool execution failed';
      }
      
      console.log('[useRealtimeVoice] Tool result:', toolResult);
      
      // Send tool result back to the assistant
      if (voiceClientRef.current) {
        // OpenAI expects the result in a specific format
        voiceClientRef.current.sendToolResult(callId, { output: toolResult });
      }
      
      // Update the tool message with the result
      setTranscript(prev => {
        const updated = [...prev];
        // Find the tool call message by matching the callId
        const toolIndex = updated.findIndex(entry => 
          entry.plugin?.tool_call?.id === callId
        );
        
        console.log('[useRealtimeVoice] Updating tool result:', {
          callId,
          toolIndex,
          foundPlugin: toolIndex >= 0
        });
        
        if (toolIndex >= 0 && updated[toolIndex].plugin) {
          // Format the output properly for display
          const formattedOutput = typeof toolResult === 'string' ? 
            toolResult : JSON.stringify(toolResult, null, 2);
          
          updated[toolIndex].plugin = {
            ...updated[toolIndex].plugin,
            loading: false,
            outputs: [formattedOutput],
            output: formattedOutput,
            // Update tool_call with result and set progress to complete
            tool_call: {
              ...updated[toolIndex].plugin.tool_call,
              output: formattedOutput,
              progress: 1.0  // Mark as complete
            }
          };
        }
        return updated;
      });
    } catch (error) {
      console.error('[useRealtimeVoice] Tool execution error:', error);
      
      const errorResult = `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`;
      
      // Send error back to assistant
      if (voiceClientRef.current) {
        voiceClientRef.current.sendToolResult(callId, { output: errorResult });
      }
      
      // Update the tool message with error
      setTranscript(prev => {
        const updated = [...prev];
        // Find the tool call message by matching the callId
        const toolIndex = updated.findIndex(entry => 
          entry.plugin?.tool_call?.id === callId
        );
        
        if (toolIndex >= 0 && updated[toolIndex].plugin) {
          updated[toolIndex].plugin = {
            ...updated[toolIndex].plugin,
            loading: false,
            outputs: [errorResult],
            output: errorResult,
            error: true,
            // Update tool_call with error and mark as complete
            tool_call: {
              ...updated[toolIndex].plugin.tool_call,
              output: errorResult,
              error: true,
              progress: 1.0  // Mark as complete even on error
            }
          };
        }
        return updated;
      });
    }
  }, [handleTranscript, token, conversationId]);
  
  const connect = useCallback(async () => {
    if (voiceClientRef.current?.getConnectionState() === 'connected') {
      return;
    }
    
    console.log('useRealtimeVoice - token available:', !!token);
    if (!token) {
      console.warn('No auth token available in useRealtimeVoice');
    }
    
    console.log('[useRealtimeVoice] Connecting with tools:', tools);
    console.log('[useRealtimeVoice] Tools count:', tools?.length || 0);
    
    try {
      const client = new RealtimeVoiceClient({
        voice,
        systemPrompt,
        initialInstructions: DEFAULT_VOICE_GREETING,
        authToken: token,
        tools,
        
        onConnectionStateChange: setConnectionState,
        onTranscript: handleTranscript,
        onTranscriptChunk: handleTranscriptChunk,
        onResponseStart: handleResponseStart,
        onToolCall: handleToolCall,
        onMicrophoneLevel: setMicLevel,
        onPlaybackLevel: setSpeakerLevel,
        onError: (error) => {
          console.error('Voice error:', error);
          onError?.(error);
        }
      });
      
      voiceClientRef.current = client;
      await client.connect(conversationId);
      
    } catch (error) {
      console.error('Failed to connect:', error);
      setConnectionState('error');
      onError?.(error as Error);
    }
  }, [conversationId, systemPrompt, voice, tools, handleTranscript, handleTranscriptChunk, handleResponseStart, handleToolCall, onError, token]);
  
  const disconnect = useCallback(() => {
    if (voiceClientRef.current) {
      voiceClientRef.current.disconnect();
      voiceClientRef.current = null;
    }
  }, []);
  
  const toggleMicrophone = useCallback(() => {
    if (voiceClientRef.current) {
      const newMutedState = !isMicMuted;
      setIsMicMuted(newMutedState);
      voiceClientRef.current.toggleMicrophone(!newMutedState);
    }
  }, [isMicMuted]);
  
  const toggleSpeaker = useCallback(() => {
    if (voiceClientRef.current) {
      const newMutedState = !isSpeakerMuted;
      setIsSpeakerMuted(newMutedState);
      voiceClientRef.current.togglePlayback(!newMutedState);
    }
  }, [isSpeakerMuted]);
  
  const sendText = useCallback((text: string) => {
    if (voiceClientRef.current) {
      voiceClientRef.current.sendText(text);
    }
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceClientRef.current) {
        voiceClientRef.current.disconnect();
        voiceClientRef.current = null;
      }
    };
  }, []);
  
  return {
    connectionState,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting',
    isMicMuted,
    isSpeakerMuted,
    micLevel,
    speakerLevel,
    transcript,
    currentChunk,
    connect,
    disconnect,
    toggleMicrophone,
    toggleSpeaker,
    sendText
  };
}

export default useRealtimeVoice;