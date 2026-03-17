import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSidebar } from '../contexts/SidebarContext';
import { Search, FlaskConical, KeyRound, Activity, Bot } from 'lucide-react';
import { QUICK_ACTIONS } from '../lib/quick-actions';
import type { CmdItem } from '../lib/quick-actions';
import './CommandPalette.css';

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

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { agents, omniboxActiveRef } = useSidebar();

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

  const allItems = useMemo(() => [...agentItems, ...QUICK_ACTIONS], [agentItems]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.sublabel && item.sublabel.toLowerCase().includes(q)),
    );
  }, [query, allItems]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: CmdItem[] }[] = [];
    const seen = new Set<string>();
    for (const item of filtered) {
      if (!seen.has(item.group)) {
        seen.add(item.group);
        groups.push({ label: item.group, items: [] });
      }
      const group = groups.find((g) => g.label === item.group);
      if (group) group.items.push(item);
    }
    return groups;
  }, [filtered]);

  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const selectItem = useCallback(
    (item: CmdItem) => {
      closeAndReset();
      navigate(item.route);
    },
    [closeAndReset, navigate],
  );

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        if (omniboxActiveRef.current) return;
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Keyboard navigation within palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          closeAndReset();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(flatItems.length, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + flatItems.length) % Math.max(flatItems.length, 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatItems[selectedIndex]) {
            selectItem(flatItems[selectedIndex]);
          }
          break;
      }
    },
    [closeAndReset, flatItems, selectedIndex, selectItem],
  );

  // Click outside to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        closeAndReset();
      }
    },
    [closeAndReset],
  );

  if (!open) return null;

  let itemCounter = 0;

  return (
    <div className="cmd-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="cmd-dialog" onKeyDown={handleKeyDown}>
        <div className="cmd-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search agents, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="cmd-results">
          {flatItems.length === 0 ? (
            <div className="cmd-empty">No results found</div>
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                <div className="cmd-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const idx = itemCounter++;
                  return (
                    <div
                      key={item.id}
                      className={`cmd-item${idx === selectedIndex ? ' cmd-item--selected' : ''}`}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="cmd-item-icon">{renderIcon(item.icon)}</span>
                      <span className="cmd-item-text">
                        <span className="cmd-item-label">{item.label}</span>
                        {item.sublabel && <span className="cmd-item-sublabel">{item.sublabel}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-footer">
          <span><kbd>&uarr;&darr;</kbd> Navigate</span>
          <span><kbd>&crarr;</kbd> Open</span>
          <span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
