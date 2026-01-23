import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, AgentStatus } from '../types';
import { VoiceInputButton } from './VoiceInput/VoiceInputButton';
import { useAssistant } from '../contexts/AssistantContext';

interface ChatPanelProps {
  messages: ChatMessage[];
  status: AgentStatus;
  onSendTask: (task: string) => void;
  onStartAgent: (url: string) => void;
  onStopAgent: () => void;
  currentUrl: string | null;
}

export function ChatPanel({
  messages,
  status,
  onSendTask,
  onStartAgent,
  onStopAgent,
  currentUrl
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [urlInput, setUrlInput] = useState('https://magnitodo.com');
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

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    onStartAgent(urlInput.trim());
  };

  const isAgentReady = status === 'idle';
  const isAgentWorking = status === 'working';
  const hasActiveSession = currentUrl !== null;

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
      // Have avatar acknowledge the task
      if (isAvatarReady) {
        await speakText(`Got it! I'll ${transcript.toLowerCase().startsWith('create') || transcript.toLowerCase().startsWith('add') ? 'do that for you' : 'help you with that'}.`);
      }
      onSendTask(transcript.trim());
    } else if (!hasActiveSession) {
      // No agent running - start it automatically
      if (isAvatarReady) {
        await speakText("Let me start the browser for you.");
      }
      // Store the task to execute after agent starts
      pendingTaskRef.current = transcript.trim();
      // Start agent with default URL
      onStartAgent(urlInput.trim() || 'https://magnitodo.com');
    } else if (isAvatarReady) {
      // Agent is starting/working
      await speakText("I'm currently working on something. Please wait a moment.");
    }
  }, [onSendTask, onStartAgent, isAgentReady, isAvatarReady, hasActiveSession, speakText, urlInput]);

  // Voice input is enabled when avatar is ready OR agent is ready
  const isVoiceEnabled = isAvatarReady || isAgentReady;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Browser Agent Chat</h2>
        <div className="status-indicator">
          <span className={`status-dot ${status}`} />
          <span>{status}</span>
        </div>
      </div>

      {!hasActiveSession ? (
        <form className="url-form" onSubmit={handleStart}>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL to start..."
            required
          />
          <button type="submit" disabled={status === 'working'}>
            Start Agent
          </button>
        </form>
      ) : (
        <div className="session-controls">
          <span className="current-url">{currentUrl}</span>
          <button onClick={onStopAgent} disabled={isAgentWorking}>
            Stop
          </button>
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
          placeholder={
            isAgentReady
              ? "Enter a task for the agent..."
              : isAgentWorking
              ? "Agent is working..."
              : "Start an agent first..."
          }
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
