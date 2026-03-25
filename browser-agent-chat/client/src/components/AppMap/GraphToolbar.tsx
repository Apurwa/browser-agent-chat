import { useCallback, useEffect, useRef } from 'react'
import { useGraphStore } from './GraphStore'

export default function GraphToolbar() {
  const searchQuery = useGraphStore(s => s.searchQuery)
  const setSearchQuery = useGraphStore(s => s.setSearchQuery)
  const mode = useGraphStore(s => s.mode)
  const setMode = useGraphStore(s => s.setMode)
  const nodes = useGraphStore(s => s.nodes)
  const inputRef = useRef<HTMLInputElement>(null)

  const nodeCount = nodes.length
  const featureCount = nodes.reduce((sum, n) => sum + (n.featureCount ?? 0), 0)

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [setSearchQuery])

  const handleNavMode = useCallback(() => {
    setMode('navigation')
  }, [setMode])

  const handleCapMode = useCallback(() => {
    setMode('capabilities')
  }, [setMode])

  // Cmd+K / Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="graph-toolbar">
      <div className="graph-toolbar-search">
        <input
          ref={inputRef}
          type="text"
          className="graph-toolbar-search-input"
          placeholder="Search nodes... (Cmd+K)"
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="Search graph nodes"
        />
      </div>
      <div className="graph-toolbar-stats">
        <span>{nodeCount} pages</span>
        <span className="graph-toolbar-stats-sep">{'\u00B7'}</span>
        <span>{featureCount} features</span>
      </div>
      <div className="graph-toolbar-mode-toggle" role="group" aria-label="Graph view mode">
        <button
          className={`graph-toolbar-mode-btn ${mode === 'navigation' ? 'graph-toolbar-mode-btn--active' : ''}`}
          onClick={handleNavMode}
          aria-pressed={mode === 'navigation'}
        >
          Navigation
        </button>
        <button
          className={`graph-toolbar-mode-btn ${mode === 'capabilities' ? 'graph-toolbar-mode-btn--active' : ''}`}
          onClick={handleCapMode}
          aria-pressed={mode === 'capabilities'}
        >
          Capabilities
        </button>
      </div>
    </div>
  )
}
