import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceInputState } from '../types/assistant';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface UseVoiceInputOptions {
  language?: string;
  continuous?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  state: VoiceInputState;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  error: string | null;
}

function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useVoiceInput({
  language = 'en-US',
  continuous = true,
  onResult,
  onError,
}: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isListeningRef = useRef(false);
  const shouldRestartRef = useRef(false);

  const SpeechRecognitionClass = getSpeechRecognition();
  const isSupported = Boolean(SpeechRecognitionClass);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setState('error');
    onError?.(errorMessage);
  }, [onError]);

  const startListening = useCallback(() => {
    console.log('startListening called, SpeechRecognitionClass:', !!SpeechRecognitionClass);

    if (!SpeechRecognitionClass) {
      handleError('Speech recognition is not supported in this browser');
      return;
    }

    if (isListeningRef.current) {
      console.log('Already listening, ignoring');
      return;
    }

    console.log('Starting speech recognition...');
    setError(null);
    setTranscript('');
    setInterimTranscript('');
    shouldRestartRef.current = true;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onstart = () => {
      console.log('Speech recognition started');
      isListeningRef.current = true;
      setState('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log('Speech recognition result received');
      let finalTranscript = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        console.log('Transcript:', text, 'isFinal:', result.isFinal);

        if (result.isFinal) {
          finalTranscript += text;
        } else {
          interimText += text;
        }
      }

      if (finalTranscript) {
        console.log('Final transcript:', finalTranscript);
        setTranscript((prev) => prev + finalTranscript);
        onResult?.(finalTranscript, true);
      }

      setInterimTranscript(interimText);
      if (interimText) {
        onResult?.(interimText, false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      isListeningRef.current = false;

      // For no-speech, don't stop - just let it auto-restart
      if (event.error === 'no-speech') {
        return;
      }

      if (event.error === 'aborted') {
        shouldRestartRef.current = false;
        setState('idle');
        return;
      }

      shouldRestartRef.current = false;
      const errorMessages: Record<string, string> = {
        'not-allowed': 'Microphone access denied. Please allow microphone access.',
        'network': 'Network error. Please check your connection.',
        'audio-capture': 'No microphone found. Please connect a microphone.',
        'service-not-allowed': 'Speech recognition service not available.',
      };

      handleError(errorMessages[event.error] || `Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setInterimTranscript('');

      // Auto-restart if user hasn't explicitly stopped
      if (shouldRestartRef.current && state !== 'error') {
        console.log('Auto-restarting speech recognition...');
        setTimeout(() => {
          if (shouldRestartRef.current) {
            try {
              recognition.start();
            } catch (err) {
              console.error('Failed to restart speech recognition:', err);
              shouldRestartRef.current = false;
              setState('idle');
            }
          }
        }, 100);
      } else if (state !== 'error') {
        setState('idle');
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      handleError('Failed to start speech recognition');
    }
  }, [SpeechRecognitionClass, continuous, language, handleError, onResult, state]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return {
    state,
    transcript,
    interimTranscript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
    error,
  };
}
