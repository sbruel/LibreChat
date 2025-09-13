import React, { useEffect, useRef, useMemo } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { useRealtimeVoice } from '~/hooks/useRealtimeVoice';
import MessagesView from '../Messages/MessagesView';
import type { TMessage } from 'librechat-data-provider';
import { buildTree } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import store from '~/store';

interface VoiceConversationProps {
  conversationId?: string;
  endpoint?: string;
  model?: string;
  onTranscriptUpdate?: (messages: TMessage[]) => void;
}

export default function VoiceConversation({
  conversationId,
  endpoint,
  model,
  onTranscriptUpdate
}: VoiceConversationProps) {
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const messageIdCounter = useRef(0);
  const messageIdMap = useRef<Map<string, string>>(new Map());
  
  const {
    connectionState,
    isConnected,
    isConnecting,
    isMicMuted,
    isSpeakerMuted,
    micLevel,
    speakerLevel,
    transcript,
    currentChunk,
    connect,
    disconnect,
    toggleMicrophone,
    toggleSpeaker
  } = useRealtimeVoice({
    conversationId,
    systemPrompt: conversation?.assistant || 'You are a helpful assistant.',
    voice: 'cedar',
    onTranscriptUpdate,
    onError: (error) => {
      console.error('Voice conversation error:', error);
    }
  });
  
  // Check if this is a realtime model
  const isRealtimeModel = model?.includes('realtime') || model === 'gpt-4o-realtime-preview' || model === 'gpt-4o-realtime';
  
  const handleConnect = async () => {
    if (isConnected) {
      disconnect();
    } else {
      await connect();
    }
  };
  
  if (!isRealtimeModel) {
    return null;
  }

  // Generate stable message IDs for each transcript entry
  const getStableMessageId = (index: number, role: string, text: string) => {
    const key = `${index}-${role}-${text.substring(0, 30)}`;
    if (!messageIdMap.current.has(key)) {
      messageIdMap.current.set(key, `voice-msg-${++messageIdCounter.current}`);
    }
    return messageIdMap.current.get(key)!;
  };

  // Build messages tree with proper parent-child relationships
  const messagesTree = useMemo(() => {
    const messages: TMessage[] = [];
    let lastMessageId = '00000000-0000-0000-0000-000000000000';
    
    // Convert each transcript entry to a message
    transcript.forEach((entry, index) => {
      const messageId = getStableMessageId(index, entry.role, entry.text);
      
      messages.push({
        messageId,
        conversationId: conversationId || '',
        parentMessageId: lastMessageId,
        sender: entry.role === 'user' ? 'User' : 'Assistant',
        text: entry.text,
        isCreatedByUser: entry.role === 'user',
        error: false,
        unfinished: false,
        clientId: messageId,
        model: model || '',
        createdAt: new Date(Date.now() - (transcript.length - index) * 5000).toISOString(),
        updatedAt: new Date(Date.now() - (transcript.length - index) * 5000).toISOString(),
      } as TMessage);
      
      lastMessageId = messageId;
    });
    
    // Add current chunk as a streaming message
    if (currentChunk) {
      const streamingId = 'voice-streaming-current';
      messages.push({
        messageId: streamingId,
        conversationId: conversationId || '',
        parentMessageId: lastMessageId,
        sender: 'Assistant',
        text: currentChunk + '...',  // Add ellipsis to indicate ongoing speech
        isCreatedByUser: false,
        error: false,
        unfinished: false,  // Don't mark as unfinished to avoid error display
        isStreaming: false,  // Don't use streaming flag which may trigger error display
        clientId: streamingId,
        model: model || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Add a custom flag that we're currently generating
        isGenerating: true,
      } as TMessage);
    }
    
    // Build the tree structure
    if (messages.length === 0) {
      return null;
    }
    
    return buildTree({ messages, fileMap: {} });
  }, [transcript, currentChunk, conversationId, model]);

  return (
    <>
      {/* Messages display area */}
      <div className="flex-1 overflow-y-auto">
        {messagesTree ? (
          <MessagesView messagesTree={messagesTree} hideActionButtons={true} />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center space-y-2">
              <p className="text-lg">
                {connectionState === 'disconnected' && 'Click the phone button to start voice conversation'}
                {connectionState === 'connecting' && 'Connecting...'}
                {connectionState === 'connected' && 'Start speaking...'}
                {connectionState === 'error' && 'Connection error. Please try again.'}
              </p>
              {isConnected && (
                <p className="text-xs italic">
                  Note: Your speech may not appear due to an OpenAI API limitation,
                  but the assistant can hear you.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom voice controls */}
      <div className="sticky bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-center space-x-4">
            {/* Main call button */}
            <button
              onClick={handleConnect}
              className={`
                relative p-4 rounded-full transition-all duration-300
                ${isConnected 
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg' 
                  : isConnecting
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-lg animate-pulse'
                  : 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                }
              `}
              title={isConnected ? 'End call' : 'Start call'}
            >
              {/* Audio level indicator */}
              {isConnected && (
                <>
                  <div 
                    className="absolute inset-0 rounded-full bg-white/20"
                    style={{
                      transform: `scale(${1 + micLevel * 0.2})`,
                      opacity: micLevel * 0.5,
                      transition: 'transform 0.1s, opacity 0.1s'
                    }}
                  />
                  <div 
                    className="absolute inset-0 rounded-full bg-blue-400/20"
                    style={{
                      transform: `scale(${1 + speakerLevel * 0.2})`,
                      opacity: speakerLevel * 0.5,
                      transition: 'transform 0.1s, opacity 0.1s'
                    }}
                  />
                </>
              )}
              
              {isConnected ? (
                <PhoneOff className="w-6 h-6 relative z-10" />
              ) : (
                <Phone className="w-6 h-6 relative z-10" />
              )}
            </button>

            {/* Microphone control */}
            {isConnected && (
              <>
                <button
                  onClick={toggleMicrophone}
                  className={`
                    p-3 rounded-full transition-all
                    ${isMicMuted 
                      ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }
                    hover:bg-gray-200 dark:hover:bg-gray-700
                  `}
                  title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                
                {/* Speaker control */}
                <button
                  onClick={toggleSpeaker}
                  className={`
                    p-3 rounded-full transition-all
                    ${isSpeakerMuted 
                      ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }
                    hover:bg-gray-200 dark:hover:bg-gray-700
                  `}
                  title={isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                >
                  {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              </>
            )}

            {/* Connection status text */}
            <div className="ml-4 text-sm text-gray-600 dark:text-gray-400">
              {connectionState === 'connected' && (
                <span className="flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                  Connected
                </span>
              )}
              {connectionState === 'connecting' && (
                <span className="flex items-center">
                  <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2 animate-pulse" />
                  Connecting...
                </span>
              )}
              {connectionState === 'error' && (
                <span className="flex items-center text-red-500">
                  <span className="w-2 h-2 bg-red-500 rounded-full mr-2" />
                  Error
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}