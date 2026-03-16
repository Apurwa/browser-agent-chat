import { useCallback } from 'react'
import { useGraphStore } from './GraphStore'

export default function GraphToolbar() {
  const searchQuery = useGraphStore(s => s.searchQuery)
  const setSearchQuery = useGraphStore(s => s.setSearchQuery)
  const mode = useGraphStore(s => s.mode)
  const setMode = useGraphStore(s => s.setMode)
  const nodes = useGraphStore(s => s.nodes)

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

  return (
    <div className="graph-toolbar">
      <div className="graph-toolbar-search">
        <input
          type="text"
          className="graph-toolbar-search-input"
          placeholder="Search nodes..."
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
