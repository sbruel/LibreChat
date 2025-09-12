import React, { useState, useRef, useCallback } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';
import type { TMessage } from 'librechat-data-provider';

interface SimpleVoiceChatProps {
  conversationId?: string;
  endpoint?: string;
  model?: string;
  onTranscriptUpdate?: (messages: TMessage[]) => void;
  onSendMessage?: (text: string) => void;
}

export default function SimpleVoiceChat({
  conversationId,
  endpoint,
  model,
  onTranscriptUpdate,
  onSendMessage
}: SimpleVoiceChatProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        
        try {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Convert to base64 for sending to backend
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result as string;
            
            // Send to backend for transcription
            const response = await fetch('/api/audio/transcribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              credentials: 'include',
              body: JSON.stringify({
                audio: base64Audio,
                conversationId
              })
            });
            
            if (response.ok) {
              const data = await response.json();
              const transcribedText = data.text;
              
              setTranscript(transcribedText);
              
              // Send the transcribed message
              if (onSendMessage && transcribedText) {
                onSendMessage(transcribedText);
              }
            } else {
              setError('Failed to transcribe audio');
            }
          };
        } catch (err) {
          console.error('Error processing audio:', err);
          setError('Error processing audio');
        } finally {
          setIsProcessing(false);
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Failed to access microphone. Please check permissions.');
    }
  }, [conversationId, onSendMessage]);
  
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);
  
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);
  
  // Check if this is a voice-enabled model
  const isVoiceEnabled = model?.includes('realtime') || 
                        model === 'gpt-4o-realtime-preview' || 
                        model === 'gpt-4o-realtime' ||
                        model === 'gpt-4o-audio-preview';
  
  if (!isVoiceEnabled) {
    return null;
  }
  
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
          Voice Input
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {isRecording ? 'Recording... Click to stop' : 
           isProcessing ? 'Processing...' :
           'Click to start recording'}
        </p>
      </div>
      
      {/* Recording Button */}
      <button
        onClick={toggleRecording}
        disabled={isProcessing}
        className={`
          relative w-32 h-32 rounded-full flex items-center justify-center
          transition-all duration-300 transform hover:scale-105
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isRecording 
            ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50 animate-pulse' 
            : isProcessing
            ? 'bg-gray-500 shadow-lg shadow-gray-500/50'
            : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/50'
          }
        `}
      >
        {isProcessing ? (
          <Loader2 className="w-12 h-12 text-white animate-spin" />
        ) : isRecording ? (
          <Square className="w-12 h-12 text-white" />
        ) : (
          <Mic className="w-12 h-12 text-white" />
        )}
      </button>
      
      {/* Status/Error Messages */}
      {error && (
        <div className="text-red-500 text-sm text-center">
          {error}
        </div>
      )}
      
      {/* Transcript Display */}
      {transcript && (
        <div className="w-full max-w-2xl p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Transcribed Text
          </h3>
          <p className="text-gray-700 dark:text-gray-300">
            {transcript}
          </p>
        </div>
      )}
      
      {/* Instructions */}
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 max-w-md">
        <p>Press and release to record your message.</p>
        <p>The audio will be transcribed and sent as a text message.</p>
      </div>
    </div>
  );
}