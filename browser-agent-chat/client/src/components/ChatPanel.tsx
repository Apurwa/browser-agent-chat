import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, AgentStatus } from '../types';
import { VoiceInputButton } from './VoiceInput/VoiceInputButton';
import { useAssistant } from '../contexts/AssistantContext';

interface ChatPanelProps {
  messages: ChatMessage[];
  status: AgentStatus;
  onSendTask: (task: string) => void;
  currentUrl: string | null;
}

export function ChatPanel({
  messages,
  status,
  onSendTask,
  currentUrl
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { speakText, isAvatarReady } = useAssistant();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    onSendTask(input.trim());
    setInput('');
  };

  const isAgentReady = status === 'idle';
  const isAgentWorking = status === 'working';

  const pendingTaskRef = useRef<string | null>(null);

  // Execute pending task when agent becomes ready
  useEffect(() => {
    if (isAgentReady && pendingTaskRef.current) {
      const task = pendingTaskRef.current;
      pendingTaskRef.current = null;
      onSendTask(task);
    }
  }, [isAgentReady, onSendTask]);

  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;

    // If browser agent is ready, send task to it
    if (isAgentReady) {
      // Don't speak here - let the agent's thoughts narrate the plan
      onSendTask(transcript.trim());
    } else if (isAgentWorking) {
      // Agent is working - this is worth mentioning
      if (isAvatarReady) {
        await speakText("Give me a moment, I'm still working on the previous task.");
      }
    } else {
      // Agent not ready yet - queue the task, don't speak to avoid blocking thoughts
      pendingTaskRef.current = transcript.trim();
    }
  }, [onSendTask, isAgentReady, isAgentWorking, isAvatarReady, speakText]);

  // Voice input is enabled when avatar is ready
  const isVoiceEnabled = isAvatarReady;

  const getPlaceholder = () => {
    if (isAgentReady) return "Enter a task for the agent...";
    if (isAgentWorking) return "Agent is working...";
    if (isAvatarReady) return "Browser is starting...";
    return "Start the assistant first...";
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Browser Agent Chat</h2>
        <div className="status-indicator">
          <span className={`status-dot ${status}`} />
          <span>{status}</span>
        </div>
      </div>

      {currentUrl && (
        <div className="session-info">
          <span className="current-url">{currentUrl}</span>
        </div>
      )}

      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`}>
            <span className="message-type">{msg.type}</span>
            <span className="message-content">{msg.content}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={getPlaceholder()}
          disabled={!isAgentReady}
        />
        <VoiceInputButton
          onTranscriptComplete={handleVoiceTranscript}
          disabled={!isVoiceEnabled}
        />
        <button type="submit" disabled={!isAgentReady || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
