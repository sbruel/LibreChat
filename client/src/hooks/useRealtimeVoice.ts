import { useState, useCallback, useRef, useEffect } from 'react';
import { RealtimeVoiceClient, ConnectionState, RealtimeVoiceConfig } from '~/services/RealtimeVoiceClient';
import { useAuthContext } from '~/hooks';
import type { TMessage } from 'librechat-data-provider';

interface UseRealtimeVoiceOptions {
  conversationId?: string;
  systemPrompt?: string;
  voice?: RealtimeVoiceConfig['voice'];
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
  transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
  currentChunk: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMicrophone: () => void;
  toggleSpeaker: () => void;
  sendText: (text: string) => void;
}

export function useRealtimeVoice({
  conversationId,
  systemPrompt = 'You are a helpful assistant.',
  voice = 'cedar',
  onTranscriptUpdate,
  onError
}: UseRealtimeVoiceOptions = {}): UseRealtimeVoiceReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [currentChunk, setCurrentChunk] = useState('');
  
  const voiceClientRef = useRef<RealtimeVoiceClient | null>(null);
  
  const handleTranscript = useCallback((text: string, role: 'user' | 'assistant') => {
    setTranscript(prev => [...prev, { role, text }]);
    setCurrentChunk('');
    
    // Convert to TMessage format if callback provided
    if (onTranscriptUpdate) {
      const messages: TMessage[] = [...transcript, { role, text }].map((t, index) => ({
        messageId: `voice-${Date.now()}-${index}`,
        conversationId: conversationId || '',
        parentMessageId: index > 0 ? `voice-${Date.now()}-${index - 1}` : undefined,
        sender: t.role === 'user' ? 'User' : 'Assistant',
        text: t.text,
        isCreatedByUser: t.role === 'user',
        error: false,
        unfinished: false,
        clientId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as TMessage));
      
      onTranscriptUpdate(messages);
    }
  }, [transcript, conversationId, onTranscriptUpdate]);
  
  const { token } = useAuthContext();
  
  const connect = useCallback(async () => {
    if (voiceClientRef.current?.getConnectionState() === 'connected') {
      return;
    }
    
    console.log('useRealtimeVoice - token available:', !!token);
    if (!token) {
      console.warn('No auth token available in useRealtimeVoice');
    }
    
    try {
      const client = new RealtimeVoiceClient({
        voice,
        systemPrompt,
        initialInstructions: 'Hello! How can I help you today?',
        authToken: token,
        
        onConnectionStateChange: setConnectionState,
        onTranscript: handleTranscript,
        onTranscriptChunk: setCurrentChunk,
        onResponseStart: () => setCurrentChunk(''),
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
  }, [conversationId, systemPrompt, voice, handleTranscript, onError, token]);
  
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