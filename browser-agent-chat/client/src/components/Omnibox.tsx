import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSidebar } from '../contexts/SidebarContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { QUICK_ACTIONS } from '../lib/quick-actions';
import type { CmdItem } from '../lib/quick-actions';
import {
  Plus,
  ArrowUp,
  Mic,
  Upload,
  Clipboard,
  Search,
  Bot,
  KeyRound,
  Activity,
  FlaskConical,
} from 'lucide-react';

interface OmniboxProps {
  onCreateAgent: (url: string) => Promise<void>;
  isCreating: boolean;
  error: string | null;
  onInputChange?: (hasInput: boolean) => void;
}

function detectIntent(input: string): 'url' | 'search' {
  const trimmed = input.trim();
  if (!trimmed) return 'search';
  try {
    new URL(trimmed);
    return 'url';
  } catch {
    // not a full URL, check patterns
  }
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return 'url';
  if (/^localhost(:\d+)?/.test(trimmed)) return 'url';
  return 'search';
}

function extractDomain(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed;
  }
}

function renderIcon(icon: CmdItem['icon']) {
  switch (icon) {
    case 'agent':
      return <Bot size={16} />;
    case 'vault':
      return <KeyRound size={16} />;
    case 'observability':
      return <Activity size={16} />;
    case 'action':
      return <FlaskConical size={16} />;
  }
}

export default function Omnibox({ onCreateAgent, isCreating, error, onInputChange }: OmniboxProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const { agents } = useSidebar();

  const {
    isSupported: isVoiceSupported,
    startListening,
    stopListening,
    interimTranscript,
    state: voiceState,
  } = useVoiceInput({
    onResult: (text, isFinal) => {
      if (isFinal) setQuery((prev) => (prev + ' ' + text).trim());
    },
  });

  const isListening = voiceState === 'listening';

  const intent = useMemo(() => detectIntent(query), [query]);
  const domain = useMemo(() => (intent === 'url' ? extractDomain(query) : ''), [intent, query]);
  const hasInput = query.trim().length > 0;

  // Notify parent about input state changes
  useEffect(() => {
    onInputChange?.(hasInput);
  }, [hasInput, onInputChange]);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Build agent items
  const agentItems: CmdItem[] = useMemo(
    () =>
      agents.map((a) => ({
        id: `agent-${a.id}`,
        label: a.name,
        sublabel: a.url,
        route: `/agents/${a.id}/testing`,
        icon: 'agent' as const,
        group: 'Agents',
      })),
    [agents],
  );

  // Build grouped results
  const grouped = useMemo(() => {
    const q = query.toLowerCase().trim();
    const groups: { label: string; items: (CmdItem & { isCreate?: boolean })[] }[] = [];

    if (intent === 'url' && q) {
      // "Create" group first
      groups.push({
        label: 'Create',
        items: [
          {
            id: 'create-agent',
            label: `Start new agent at ${domain}`,
            route: '',
            icon: 'agent' as const,
            group: 'Create',
            isCreate: true,
          },
        ],
      });

      // Also show matching agents
      const matchingAgents = agentItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel && item.sublabel.toLowerCase().includes(q)),
      );
      if (matchingAgents.length > 0) {
        groups.push({ label: 'Agents', items: matchingAgents });
      }
    } else if (q) {
      // Search: matching agents + quick actions
      const matchingAgents = agentItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel && item.sublabel.toLowerCase().includes(q)),
      );
      const matchingActions = QUICK_ACTIONS.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel && item.sublabel.toLowerCase().includes(q)),
      );

      if (matchingAgents.length > 0) {
        groups.push({ label: 'Agents', items: matchingAgents });
      }
      if (matchingActions.length > 0) {
        groups.push({ label: 'Quick Actions', items: matchingActions });
      }
    }

    return groups;
  }, [query, intent, domain, agentItems]);

  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [grouped]);

  // Close plus menu on outside click
  useEffect(() => {
    if (!showPlusMenu) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.home-plus-wrapper')) {
        setShowPlusMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showPlusMenu]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setQuery(text.trim());
    } catch {
      // Clipboard access denied or empty
    }
    setShowPlusMenu(false);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result as string).trim();
      if (text) setQuery(text);
    };
    reader.readAsText(file);
    setShowPlusMenu(false);
    e.target.value = '';
  }, []);

  const handleMicClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      setQuery('');
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const executeItem = useCallback(
    (item: (CmdItem & { isCreate?: boolean }) | undefined) => {
      if (!item) return;
      if (item.isCreate) {
        onCreateAgent(query.trim());
      } else {
        navigate(item.route);
      }
    },
    [navigate, onCreateAgent, query],
  );

  const handleSubmit = useCallback(() => {
    if (isCreating) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    if (flatItems.length > 0) {
      executeItem(flatItems[selectedIndex]);
    } else if (intent === 'url') {
      onCreateAgent(trimmed);
    }
  }, [isCreating, query, flatItems, selectedIndex, executeItem, intent, onCreateAgent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (flatItems.length > 0) {
            setSelectedIndex((prev) => (prev + 1) % flatItems.length);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (flatItems.length > 0) {
            setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
          }
          break;
        case 'Enter':
          e.preventDefault();
          handleSubmit();
          break;
        case 'Escape':
          e.preventDefault();
          setQuery('');
          break;
      }
    },
    [flatItems, handleSubmit],
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selected = resultsRef.current.querySelector('.home-omnibox-item--selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const displayValue = isListening
    ? (query + (interimTranscript ? ' ' + interimTranscript : '')).trim()
    : query;

  // Build preview text
  const previewText = useMemo(() => {
    if (!hasInput) return null;
    if (intent === 'url') {
      return (
        <>
          Press Enter to start new agent at <strong>{domain}</strong>
        </>
      );
    }
    const selected = flatItems[selectedIndex];
    if (selected) {
      return (
        <>
          Press Enter to open <strong>{selected.label}</strong>
        </>
      );
    }
    return null;
  }, [hasInput, intent, domain, flatItems, selectedIndex]);

  let itemCounter = 0;

  return (
    <div className="home-omnibox">
      <div className="home-omnibox-input-row" role="combobox" aria-expanded={hasInput && flatItems.length > 0} aria-haspopup="listbox">
        <div className="home-plus-wrapper">
          <button
            type="button"
            className="home-plus-btn"
            onClick={() => setShowPlusMenu((prev) => !prev)}
            disabled={isCreating}
          >
            <Plus size={20} />
          </button>
          {showPlusMenu && (
            <div className="home-plus-dropdown">
              <button type="button" onClick={handlePasteFromClipboard}>
                <Clipboard size={14} /> Paste from clipboard
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> Upload file
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>

        <input
          ref={inputRef}
          type="text"
          className="home-omnibox-input"
          value={displayValue}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a URL or search anything..."
          disabled={isCreating || isListening}
          aria-activedescendant={flatItems[selectedIndex] ? `omnibox-item-${flatItems[selectedIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-controls="omnibox-results"
        />

        {isVoiceSupported && (
          <button
            type="button"
            className={`home-mic-btn${isListening ? ' listening' : ''}`}
            onClick={handleMicClick}
            disabled={isCreating}
            title={isListening ? 'Stop listening' : 'Voice input'}
          >
            <Mic size={20} />
            {isListening && <span className="home-mic-pulse" />}
          </button>
        )}

        <span className="home-omnibox-badge">
          <Search size={10} /> <kbd>&#8984;K</kbd>
        </span>

        <button
          type="button"
          className="home-url-go"
          disabled={isCreating || !hasInput}
          onClick={handleSubmit}
        >
          {isCreating ? <span className="home-spinner" /> : <ArrowUp size={20} />}
        </button>
      </div>

      {/* Results dropdown */}
      {hasInput && flatItems.length > 0 && (
        <div className="home-omnibox-results" ref={resultsRef} id="omnibox-results" role="listbox">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="home-omnibox-group">{group.label}</div>
              {group.items.map((item) => {
                const idx = itemCounter++;
                return (
                  <div
                    key={item.id}
                    id={`omnibox-item-${item.id}`}
                    className={`home-omnibox-item${idx === selectedIndex ? ' home-omnibox-item--selected' : ''}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="home-omnibox-item-icon">{renderIcon(item.icon)}</span>
                    <span className="home-omnibox-item-label">{item.label}</span>
                    {item.sublabel && <span className="home-omnibox-item-sublabel">{item.sublabel}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Preview hint */}
      {previewText && !isCreating && (
        <div className="home-omnibox-preview">{previewText}</div>
      )}

      {/* Error */}
      {error && <div className="home-omnibox-error">{error}</div>}
    </div>
  );
}
