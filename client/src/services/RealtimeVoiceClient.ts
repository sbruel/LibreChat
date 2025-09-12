/**
 * RealtimeVoiceClient - Real-time voice conversation client for OpenAI's Realtime API
 * Adapted from QuickVoice for LibreChat integration
 */

export interface RealtimeVoiceConfig {
  // Session Configuration
  voice?: 'alloy' | 'ash' | 'ballad' | 'cedar' | 'coral' | 'echo' | 'marin' | 'sage' | 'shimmer' | 'verse';
  language?: string;
  systemPrompt?: string;
  initialInstructions?: string;
  authToken?: string;
  
  // Tools Configuration
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters?: any;
    };
  }>;
  
  // Event Callbacks
  onConnectionStateChange?: (state: ConnectionState) => void;
  onTranscript?: (transcript: string, role: 'user' | 'assistant') => void;
  onTranscriptChunk?: (chunk: string) => void;
  onUserTranscript?: (transcript: string) => void;
  onResponseStart?: () => void;
  onError?: (error: Error) => void;
  onToolCall?: (callId: string, name: string, args: any) => void;
  
  // Audio Activity Callbacks
  onMicrophoneLevel?: (level: number) => void;
  onMicrophoneSpectrum?: (spectrum: Float32Array) => void;
  onPlaybackLevel?: (level: number) => void;
  onPlaybackSpectrum?: (spectrum: Float32Array) => void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export class RealtimeVoiceClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private microphoneMuted = false;
  private playbackMuted = false;
  private audioContext: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private config: RealtimeVoiceConfig;
  private conversationId?: string;

  constructor(config: RealtimeVoiceConfig = {}) {
    this.config = {
      voice: config.voice || 'cedar',
      language: config.language || 'en',
      systemPrompt: config.systemPrompt || 'You are a helpful, conversational assistant.',
      initialInstructions: config.initialInstructions || null,
      tools: config.tools || [],
      ...config,
    };
  }

  /**
   * Establishes a WebRTC connection with OpenAI's Realtime API
   */
  async connect(conversationId?: string): Promise<void> {
    try {
      this.conversationId = conversationId;
      this.updateConnectionState('connecting');
      
      // Get ephemeral token from backend
      const tokenData = await this.fetchToken();
      const token = tokenData.client_secret?.value || tokenData.value;
      
      // Get user's microphone
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Setup audio analysis if callbacks are provided
      if (this.config.onMicrophoneSpectrum || this.config.onMicrophoneLevel || 
          this.config.onPlaybackSpectrum || this.config.onPlaybackLevel) {
        this.setupAudioAnalysis();
      }
      
      // Create peer connection
      this.peerConnection = new RTCPeerConnection();
      
      // Add microphone tracks
      this.localStream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });
      
      // Handle incoming audio
      this.peerConnection.ontrack = (event) => {
        if (!this.audioElement) {
          this.audioElement = new Audio();
          this.audioElement.autoplay = true;
        }
        this.audioElement.srcObject = event.streams[0];
        this.audioElement.muted = this.playbackMuted;
        
        // Setup playback analysis if needed
        if (this.audioContext && (this.config.onPlaybackLevel || this.config.onPlaybackSpectrum)) {
          this.setupPlaybackAnalysis(event.streams[0]);
        }
      };
      
      // Monitor connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        if (this.peerConnection?.iceConnectionState === 'connected') {
          this.updateConnectionState('connected');
        } else if (this.peerConnection?.iceConnectionState === 'failed') {
          this.updateConnectionState('error');
          this.handleError(new Error('ICE connection failed'));
        }
      };
      
      // Setup data channel
      this.setupDataChannel();
      
      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Send offer to OpenAI Realtime API
      // The token response should include the proxy URL if configured
      const baseUrl = tokenData.proxy_url || 'https://api.openai.com';
      const apiUrl = baseUrl.replace(/\/v1\/?$/, '') + '/v1/realtime/calls';
      const model = 'gpt-realtime';
      
      console.log('Connecting to realtime API at:', apiUrl);
      
      const response = await fetch(`${apiUrl}?model=${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });
      
      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status}`);
      }
      
      const answerSdp = await response.text();
      await this.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });
      
    } catch (error) {
      this.handleError(error as Error);
      this.disconnect();
      throw error;
    }
  }

  /**
   * Disconnects from the OpenAI Realtime API and cleans up resources
   */
  disconnect(): void {
    // Stop audio analysis
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.inputAnalyser = null;
      this.outputAnalyser = null;
    }
    
    // Stop microphone tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // Stop sender tracks
    if (this.peerConnection) {
      const senders = this.peerConnection.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    // Clean up audio element
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }
    
    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    this.updateConnectionState('disconnected');
  }

  /**
   * Toggles the microphone on or off
   */
  toggleMicrophone(enabled: boolean): void {
    this.microphoneMuted = !enabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  /**
   * Toggles audio playback on or off
   */
  togglePlayback(enabled: boolean): void {
    this.playbackMuted = !enabled;
    if (this.audioElement) {
      this.audioElement.muted = !enabled;
    }
  }

  /**
   * Gets the current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Sends a text message to the assistant
   */
  sendText(text: string): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    
    const message = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: text
        }]
      }
    };
    
    this.sendJson(message);
    this.sendJson({ type: 'response.create' });
    
    // Emit user transcript
    if (this.config.onTranscript) {
      this.config.onTranscript(text, 'user');
    }
  }

  /**
   * Sends a tool result back to the assistant
   */
  sendToolResult(callId: string, result: any): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    
    const message = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result)
      }
    };
    
    this.dataChannel.send(JSON.stringify(message));
    
    // Trigger response to continue the conversation
    this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }

  // Private methods
  
  private sendJson(data: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  private async fetchToken(): Promise<any> {
    // Build session configuration for token request
    const sessionConfig = {
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        instructions: this.config.systemPrompt,
        audio: {
          input: {
            turn_detection: {
              type: 'semantic_vad',
              create_response: true,
              interrupt_response: true
            }
          },
          output: {
            voice: this.config.voice
          }
        }
      },
      conversationId: this.conversationId
    };
    
    // Add tools if provided
    if (this.config.tools && this.config.tools.length > 0) {
      sessionConfig.session.tools = this.config.tools;
    }
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    
    // Add auth token if provided
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
      console.log('Using auth token for realtime API:', this.config.authToken.substring(0, 20) + '...');
    } else {
      console.warn('No auth token provided for realtime API');
    }
    
    const response = await fetch('/api/realtime/client-secret', {
      method: 'POST',
      headers,
      credentials: 'include', // Include cookies for authentication
      body: JSON.stringify(sessionConfig)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.status}`);
    }
    
    return await response.json();
  }

  private setupDataChannel(): void {
    this.dataChannel = this.peerConnection!.createDataChannel('oai-events');
    
    this.dataChannel.onopen = () => {
      // Send initial greeting if configured
      if (this.config.initialInstructions) {
        setTimeout(() => {
          const responseCreate = {
            type: 'response.create',
            response: {
              instructions: this.config.initialInstructions
            }
          };
          this.sendJson(responseCreate);
        }, 500);
      }
    };
    
    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleRealtimeMessage(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
    
    this.dataChannel.onerror = (error) => {
      this.handleError(error as Error);
    };
  }

  private handleRealtimeMessage(message: any): void {
    switch(message.type) {
      case 'session.created':
      case 'session.updated':
        if (this.connectionState === 'connecting') {
          this.updateConnectionState('connected');
        }
        break;
        
      case 'conversation.item.created':
        // New conversation item - could be user or assistant
        if (message.item && message.item.role === 'assistant' && this.config.onResponseStart) {
          this.config.onResponseStart();
        }
        // Handle user transcript if available
        if (message.item && message.item.role === 'user' && message.item.formatted?.transcript) {
          if (this.config.onUserTranscript) {
            this.config.onUserTranscript(message.item.formatted.transcript);
          }
          if (this.config.onTranscript) {
            this.config.onTranscript(message.item.formatted.transcript, 'user');
          }
        }
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        // User's speech was transcribed
        if (message.transcript) {
          if (this.config.onUserTranscript) {
            this.config.onUserTranscript(message.transcript);
          }
          if (this.config.onTranscript) {
            this.config.onTranscript(message.transcript, 'user');
          }
        }
        break;
        
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
        if (this.config.onTranscriptChunk && message.delta) {
          this.config.onTranscriptChunk(message.delta);
        }
        break;
        
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        // Complete transcript for this response
        if (this.config.onTranscript && message.transcript) {
          this.config.onTranscript(message.transcript, 'assistant');
        }
        break;
        
      case 'response.function_call_arguments.done':
        // Tool call requested by the assistant
        if (this.config.onToolCall && message.call_id && message.name) {
          let args = {};
          try {
            args = message.arguments ? JSON.parse(message.arguments) : {};
          } catch (e) {
            console.error('Failed to parse tool arguments:', e);
          }
          this.config.onToolCall(message.call_id, message.name, args);
        }
        break;
        
      case 'input_audio_buffer.speech_started':
        // User started speaking
        break;
        
      case 'input_audio_buffer.speech_stopped':
        // User stopped speaking
        break;
        
      case 'response.cancelled':
      case 'response.interrupted':
        // Response was interrupted by user speech (VAD)
        this.stopPlayback();
        break;
        
      case 'error':
        this.handleError(new Error(message.error?.message || 'Unknown error'));
        break;
    }
  }

  private stopPlayback(): void {
    // Stop/clear audio playback when interrupted
    if (this.audioElement) {
      this.audioElement.pause();
      // Clear the current audio to stop playback immediately
      const srcObject = this.audioElement.srcObject;
      if (srcObject) {
        // Keep the stream but clear current audio buffer
        this.audioElement.srcObject = null;
        this.audioElement.srcObject = srcObject;
      }
    }
  }

  private setupAudioAnalysis(): void {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Setup microphone analysis
    if (this.localStream && (this.config.onMicrophoneLevel || this.config.onMicrophoneSpectrum)) {
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.inputAnalyser = this.audioContext.createAnalyser();
      this.inputAnalyser.fftSize = 128; // 64 frequency bins
      source.connect(this.inputAnalyser);
      
      this.startAudioAnalysis();
    }
  }

  private setupPlaybackAnalysis(stream: MediaStream): void {
    if (!this.audioContext || (!this.config.onPlaybackLevel && !this.config.onPlaybackSpectrum)) return;
    
    // Ensure we have audio tracks
    if (!stream.getAudioTracks().length) return;
    
    const source = this.audioContext.createMediaStreamSource(stream);
    this.outputAnalyser = this.audioContext.createAnalyser();
    this.outputAnalyser.fftSize = 128;
    this.outputAnalyser.smoothingTimeConstant = 0.8;
    source.connect(this.outputAnalyser);
    
    // Start analysis if not already running
    if (!this.animationFrameId) {
      this.startAudioAnalysis();
    }
  }

  private startAudioAnalysis(): void {
    const analyze = () => {
      // Microphone analysis
      if (this.inputAnalyser) {
        if (this.config.onMicrophoneSpectrum) {
          const dataArray = new Float32Array(this.inputAnalyser.frequencyBinCount);
          this.inputAnalyser.getFloatFrequencyData(dataArray);
          this.config.onMicrophoneSpectrum(dataArray);
        }
        
        if (this.config.onMicrophoneLevel) {
          const dataArray = new Uint8Array(this.inputAnalyser.frequencyBinCount);
          this.inputAnalyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          this.config.onMicrophoneLevel(average / 255);
        }
      }
      
      // Playback analysis
      if (this.outputAnalyser) {
        if (this.config.onPlaybackSpectrum) {
          const dataArray = new Float32Array(this.outputAnalyser.frequencyBinCount);
          this.outputAnalyser.getFloatFrequencyData(dataArray);
          this.config.onPlaybackSpectrum(dataArray);
        }
        
        if (this.config.onPlaybackLevel) {
          const dataArray = new Uint8Array(this.outputAnalyser.frequencyBinCount);
          this.outputAnalyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          this.config.onPlaybackLevel(average / 255);
        }
      }
      
      this.animationFrameId = requestAnimationFrame(analyze);
    };
    analyze();
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    if (this.config.onConnectionStateChange) {
      this.config.onConnectionStateChange(state);
    }
  }

  private handleError(error: Error): void {
    console.error('RealtimeVoiceClient error:', error);
    if (this.config.onError) {
      this.config.onError(error);
    }
  }
}