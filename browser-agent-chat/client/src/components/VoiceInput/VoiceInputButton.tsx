import { useCallback } from 'react';
import { useAssistant } from '../../contexts/AssistantContext';
import './VoiceInput.css';

interface VoiceInputButtonProps {
  onTranscriptComplete?: (transcript: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({
  onTranscriptComplete,
  disabled = false,
}: VoiceInputButtonProps) {
  const {
    transcript,
    interimTranscript,
    isVoiceSupported,
    startVoiceInput,
    stopVoiceInput,
    resetTranscript,
    isListening,
  } = useAssistant();

  const handleClick = useCallback(() => {
    console.log('Mic button clicked, isListening:', isListening, 'transcript:', transcript);

    // If we have a transcript, send it (regardless of listening state)
    if (transcript.trim()) {
      console.log('Sending transcript:', transcript.trim());
      stopVoiceInput();
      onTranscriptComplete?.(transcript.trim());
      resetTranscript();
      return;
    }

    // If listening but no transcript yet, stop listening
    if (isListening) {
      console.log('Stopping voice input (no transcript)...');
      stopVoiceInput();
      return;
    }

    // Start listening
    console.log('Starting voice input...');
    resetTranscript();
    startVoiceInput();
  }, [isListening, transcript, startVoiceInput, stopVoiceInput, resetTranscript, onTranscriptComplete]);

  if (!isVoiceSupported) {
    return null;
  }

  const buttonClasses = [
    'voice-input-btn',
    isListening ? 'listening' : '',
    disabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="voice-input-wrapper">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={buttonClasses}
        title={isListening ? 'Stop listening' : 'Start voice input'}
        aria-label={isListening ? 'Stop listening' : 'Start voice input'}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          className="mic-icon"
        >
          <path
            d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 19V23"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 23H16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {isListening && <span className="pulse-ring" />}
      </button>

      {(isListening || interimTranscript) && (
        <div className="voice-transcript-preview">
          {interimTranscript || transcript || 'Listening...'}
        </div>
      )}
    </div>
  );
}
