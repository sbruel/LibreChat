import React from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { useRealtimeVoice } from '~/hooks/useRealtimeVoice';
import type { TMessage } from 'librechat-data-provider';
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
      // TODO: Show error toast notification
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
  
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6">
      {/* Connection Status */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
          Voice Conversation
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {connectionState === 'disconnected' && 'Click to start speaking'}
          {connectionState === 'connecting' && 'Connecting...'}
          {connectionState === 'connected' && 'Connected - Speak naturally'}
          {connectionState === 'error' && 'Connection error'}
        </p>
      </div>
      
      {/* Main Call Button */}
      <button
        onClick={handleConnect}
        className={`
          relative w-32 h-32 rounded-full flex items-center justify-center
          transition-all duration-300 transform hover:scale-105
          ${isConnected 
            ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50' 
            : isConnecting
            ? 'bg-yellow-500 hover:bg-yellow-600 shadow-lg shadow-yellow-500/50'
            : 'bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/50'
          }
        `}
      >
        {/* Audio Level Indicator */}
        {isConnected && (
          <>
            <div 
              className="absolute inset-0 rounded-full bg-white/20 animate-pulse"
              style={{
                transform: `scale(${1 + micLevel * 0.3})`,
                opacity: micLevel * 0.5
              }}
            />
            <div 
              className="absolute inset-0 rounded-full bg-blue-400/20"
              style={{
                transform: `scale(${1 + speakerLevel * 0.3})`,
                opacity: speakerLevel * 0.5
              }}
            />
          </>
        )}
        
        {isConnected ? (
          <PhoneOff className="w-12 h-12 text-white" />
        ) : (
          <Phone className="w-12 h-12 text-white" />
        )}
      </button>
      
      {/* Controls */}
      {isConnected && (
        <div className="flex space-x-4">
          <button
            onClick={toggleMicrophone}
            className={`
              p-3 rounded-full transition-all
              ${isMicMuted 
                ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400' 
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }
              hover:bg-gray-200 dark:hover:bg-gray-700
            `}
            title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          
          <button
            onClick={toggleSpeaker}
            className={`
              p-3 rounded-full transition-all
              ${isSpeakerMuted 
                ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400' 
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }
              hover:bg-gray-200 dark:hover:bg-gray-700
            `}
            title={isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
          >
            {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      )}
      
      {/* Live Transcript */}
      {(transcript.length > 0 || currentChunk) && (
        <div className="w-full max-w-2xl mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg max-h-64 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Live Transcript
          </h3>
          <div className="space-y-2">
            {transcript.map((entry, index) => (
              <div key={index} className={`text-sm ${entry.role === 'user' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                <span className="font-semibold">{entry.role === 'user' ? 'You: ' : 'Assistant: '}</span>
                {entry.text}
              </div>
            ))}
            {currentChunk && (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-semibold">Assistant: </span>
                <span className="italic">{currentChunk}...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}