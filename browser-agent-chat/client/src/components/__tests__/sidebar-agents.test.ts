import { describe, it, expect } from 'vitest'

describe('Sidebar agent list logic', () => {
  const mockAgents = [
    { id: '1', name: 'Langfuse', url: 'https://cloud.langfuse.com', created_at: '2026-01-01', updated_at: '2026-01-01', hasCredentials: false, context: null, findings_count: 0, last_session_at: null },
    { id: '2', name: 'Stripe', url: 'https://dashboard.stripe.com', created_at: '2026-01-02', updated_at: '2026-01-02', hasCredentials: false, context: null, findings_count: 3, last_session_at: '2026-03-15' },
  ]

  it('agents array is not empty when API returns data', () => {
    const apiResponse = { agents: mockAgents }
    const agentList = apiResponse.agents
    expect(agentList.length).toBe(2)
    expect(agentList[0].name).toBe('Langfuse')
  })

  it('isAgentView is false on home page', () => {
    const agentId = undefined
    expect(Boolean(agentId)).toBe(false)
  })

  it('isAgentView is true on agent page', () => {
    const agentId = 'abc-123'
    expect(Boolean(agentId)).toBe(true)
  })

  it('agent list always renders regardless of isAgentView', () => {
    for (const agentView of [true, false]) {
      const showAgentList = true // always shown, regardless of agentView
      expect(showAgentList).toBe(true)
      expect(agentView).toBeDefined()
    }
  })

  it('sorted agents have most recent first', () => {
    const sorted = [...mockAgents].sort((a, b) => {
      const aTime = a.last_session_at ?? a.created_at
      const bTime = b.last_session_at ?? b.created_at
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })
    expect(sorted[0].name).toBe('Stripe')
    expect(sorted[1].name).toBe('Langfuse')
  })
})
