/**
 * @openapi
 * /api/agents/{id}/findings:
 *   get:
 *     tags: [Findings]
 *     summary: List findings for an agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Findings list
 *
 * /api/agents/{id}/findings/{findingId}:
 *   put:
 *     tags: [Findings]
 *     summary: Update finding status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: findingId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Updated finding }
 *
 * /api/agents/{id}/memory/features:
 *   get:
 *     tags: [Memory]
 *     summary: List learned features
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Feature list }
 *   post:
 *     tags: [Memory]
 *     summary: Create a feature
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Created feature }
 *
 * /api/agents/{id}/memory/features/{featureId}:
 *   put:
 *     tags: [Memory]
 *     summary: Update feature
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     tags: [Memory]
 *     summary: Delete feature
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deleted }
 *
 * /api/agents/{id}/memory/features/{featureId}/flows:
 *   get:
 *     tags: [Memory]
 *     summary: List flows for a feature
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Flow list }
 *   post:
 *     tags: [Memory]
 *     summary: Create a flow
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Created flow }
 *
 * /api/agents/{id}/suggestions:
 *   get:
 *     tags: [Suggestions]
 *     summary: List pending suggestions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Suggestion list }
 *
 * /api/agents/{id}/suggestions/count:
 *   get:
 *     tags: [Suggestions]
 *     summary: Count pending suggestions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Count }
 *
 * /api/agents/{id}/suggestions/{suggestionId}/accept:
 *   put:
 *     tags: [Suggestions]
 *     summary: Accept a suggestion
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: suggestionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Accepted }
 *
 * /api/agents/{id}/suggestions/{suggestionId}/dismiss:
 *   put:
 *     tags: [Suggestions]
 *     summary: Dismiss a suggestion
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: suggestionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Dismissed }
 *
 * /api/agents/{id}/evals/cases:
 *   get:
 *     tags: [Evals]
 *     summary: List eval cases
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Eval case list }
 *   post:
 *     tags: [Evals]
 *     summary: Create eval case
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Created }
 *
 * /api/agents/{id}/evals/run:
 *   post:
 *     tags: [Evals]
 *     summary: Start an eval run
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Run started }
 *
 * /api/agents/{id}/evals/runs:
 *   get:
 *     tags: [Evals]
 *     summary: List eval runs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Run list }
 *
 * /api/agents/{id}/feedback:
 *   post:
 *     tags: [Feedback]
 *     summary: Submit task feedback
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Feedback recorded }
 *   get:
 *     tags: [Feedback]
 *     summary: List feedback entries
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Feedback list }
 *
 * /api/agents/{id}/map:
 *   get:
 *     tags: [App Map]
 *     summary: Get navigation graph (nodes + edges)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Navigation graph data }
 *
 * /api/agents/{id}/traces:
 *   get:
 *     tags: [Traces]
 *     summary: List Langfuse traces for an agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Trace list with pagination }
 *
 * /api/agents/{id}/traces/{traceId}:
 *   get:
 *     tags: [Traces]
 *     summary: Get trace detail with observations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: traceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Trace detail }
 *
 * /api/observability/summary:
 *   get:
 *     tags: [Observability]
 *     summary: Metrics summary (traces, cost, error rate, latency)
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Summary metrics }
 *
 * /api/observability/trends:
 *   get:
 *     tags: [Observability]
 *     summary: Cost and trace trends over time
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Trend data }
 *
 * /api/observability/agents:
 *   get:
 *     tags: [Observability]
 *     summary: Per-agent metrics
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Agent metrics table }
 *
 * /api/vault:
 *   get:
 *     tags: [Vault]
 *     summary: List credentials
 *     responses:
 *       200: { description: Credential list (no secrets) }
 *   post:
 *     tags: [Vault]
 *     summary: Create credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, type, secret, domains]
 *             properties:
 *               label: { type: string }
 *               type: { type: string, enum: [username_password, api_key] }
 *               secret: { type: object }
 *               metadata: { type: object }
 *               domains: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Created credential }
 *
 * /api/vault/{id}:
 *   get:
 *     tags: [Vault]
 *     summary: Get credential metadata
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Credential metadata }
 *   put:
 *     tags: [Vault]
 *     summary: Update credential
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     tags: [Vault]
 *     summary: Soft-delete credential
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deleted }
 *
 * /api/vault/{id}/bind/{agentId}:
 *   post:
 *     tags: [Vault]
 *     summary: Bind credential to agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Bound }
 *   delete:
 *     tags: [Vault]
 *     summary: Unbind credential from agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Unbound }
 */
