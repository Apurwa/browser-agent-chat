import { Langfuse } from 'langfuse';

export interface TraceSummary {
  id: string;
  name: string;
  input: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  observationCount: number;
  timestamp: string;
  sessionId: string | null;
}

export interface TraceObservation {
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
}

export interface TraceDetail {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  timestamp: string;
  observations: TraceObservation[];
}

export interface TracePaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface ObservabilitySummary {
  totalTraces: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
}

export interface ObservabilityTrends {
  cost: Record<string, string | number>[];
  traces: Record<string, string | number>[];
  agents: string[];
}

export interface ObservabilityAgentRow {
  agentId: string;
  agentName: string;
  traceCount: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
}

function deriveStatus(output: unknown): 'success' | 'error' {
  if (output && typeof output === 'object' && 'success' in output) {
    return (output as { success: boolean }).success ? 'success' : 'error';
  }
  return 'success';
}

let langfuse: Langfuse | null = null;

export function isLangfuseEnabled(): boolean {
  return langfuse !== null;
}

export function getLangfuse(): Langfuse | null {
  return langfuse;
}

export function initLangfuse(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log('[LANGFUSE] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY — tracing disabled');
    return;
  }

  langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3000',
  });

  console.log('[LANGFUSE] Tracing enabled');
}

export async function shutdownLangfuse(): Promise<void> {
  if (langfuse) {
    await langfuse.shutdownAsync();
    console.log('[LANGFUSE] Flushed and shut down');
  }
}

export async function fetchAgentTraces(
  agentId: string,
  page = 1,
  limit = 50
): Promise<{ traces: TraceSummary[]; meta: TracePaginationMeta }> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const result = await langfuse.api.traceList({
    tags: [`agent:${agentId}`],
    page,
    limit,
    orderBy: 'timestamp.desc',
  });

  const traces: TraceSummary[] = result.data.map(t => ({
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    observationCount: t.observations?.length ?? 0,
    timestamp: t.timestamp,
    sessionId: t.sessionId ?? null,
  }));

  return {
    traces,
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      totalItems: result.meta.totalItems,
      totalPages: result.meta.totalPages,
    },
  };
}

export async function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const t = await langfuse.api.traceGet(traceId);

  const observations: TraceObservation[] = (t.observations ?? []).map(obs => {
    const startMs = new Date(obs.startTime).getTime();
    const endMs = obs.endTime ? new Date(obs.endTime).getTime() : null;
    const duration = endMs !== null ? (endMs - startMs) / 1000 : null;

    let tokenCount: number | null = null;
    if (obs.usage) {
      const u = obs.usage as { total?: number; input?: number; output?: number };
      tokenCount = u.total ?? (((u.input ?? 0) + (u.output ?? 0)) || null);
    }

    return {
      name: obs.name ?? null,
      startTime: obs.startTime,
      endTime: obs.endTime ?? null,
      duration,
      model: obs.model ?? null,
      tokenCount,
      level: obs.level ?? 'DEFAULT',
    };
  });

  // Sort observations by startTime
  observations.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return {
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    output: t.output,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    timestamp: t.timestamp,
    observations,
  };
}

/**
 * Fetch all traces in the date range (paginated, max 1000).
 * Used as the data source for summary, trends, and agent metrics
 * since Langfuse v2 OSS does not support the metricsMetrics API.
 */
async function fetchAllTraces(
  from: string,
  to: string,
  tags?: string[],
): Promise<Array<{ latency: number | null; totalCost: number | null; output: unknown; timestamp: string; tags: string[] }>> {
  if (!langfuse) return [];
  const traces: Array<{ latency: number | null; totalCost: number | null; output: unknown; timestamp: string; tags: string[] }> = [];
  let page = 1;
  const MAX_PAGES = 10;

  while (page <= MAX_PAGES) {
    const batch = await langfuse.api.traceList({
      page,
      limit: 100,
      fromTimestamp: from,
      toTimestamp: to,
      orderBy: 'timestamp.desc',
      ...(tags ? { tags } : {}),
    });

    for (const t of batch.data) {
      traces.push({
        latency: t.latency ?? null,
        totalCost: t.totalCost ?? null,
        output: t.output,
        timestamp: t.timestamp,
        tags: (t.tags ?? []) as string[],
      });
    }

    if (batch.data.length < 100) break;
    page++;
  }

  return traces;
}

export async function fetchObservabilitySummary(
  from: string,
  to: string
): Promise<ObservabilitySummary> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const traces = await fetchAllTraces(from, to);
  const totalTraces = traces.length;

  if (totalTraces === 0) {
    return { totalTraces: 0, totalCost: 0, errorRate: 0, avgLatency: 0, p95Latency: 0 };
  }

  let totalCost = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let errorCount = 0;
  const latencies: number[] = [];

  for (const t of traces) {
    totalCost += t.totalCost ?? 0;
    if (t.latency != null) {
      totalLatency += t.latency;
      latencyCount++;
      latencies.push(t.latency);
    }
    if (deriveStatus(t.output) === 'error') errorCount++;
  }

  const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies.length > 0 ? latencies[Math.min(p95Index, latencies.length - 1)] : 0;
  const errorRate = errorCount / totalTraces;

  return { totalTraces, totalCost, errorRate, avgLatency, p95Latency };
}

export async function fetchObservabilityTrends(
  from: string,
  to: string,
  agentNames: Map<string, string>
): Promise<ObservabilityTrends> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const traces = await fetchAllTraces(from, to);
  const agentSet = new Set<string>();
  const costDateMap = new Map<string, Record<string, number>>();
  const traceDateMap = new Map<string, Record<string, number>>();

  for (const t of traces) {
    const date = t.timestamp.slice(0, 10);
    const agentTag = t.tags.find(tag => tag.startsWith('agent:'));
    if (!agentTag) continue;

    const agentId = agentTag.replace('agent:', '');
    const name = agentNames.get(agentId) ?? agentId;
    agentSet.add(name);

    if (!costDateMap.has(date)) costDateMap.set(date, {});
    costDateMap.get(date)![name] = (costDateMap.get(date)![name] ?? 0) + (t.totalCost ?? 0);

    if (!traceDateMap.has(date)) traceDateMap.set(date, {});
    traceDateMap.get(date)![name] = (traceDateMap.get(date)![name] ?? 0) + 1;
  }

  const agents = [...agentSet];
  const sortedDates = [...costDateMap.keys()].sort();
  const cost = sortedDates.map(date => ({ date, ...costDateMap.get(date) }));
  const traceData = sortedDates.map(date => ({ date, ...traceDateMap.get(date) }));

  return { cost, traces: traceData, agents };
}

export async function fetchObservabilityAgents(
  from: string,
  to: string,
  agentNames: Map<string, string>
): Promise<ObservabilityAgentRow[]> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const traces = await fetchAllTraces(from, to);
  const agentMap = new Map<string, { traces: typeof traces }>();

  for (const t of traces) {
    const agentTag = t.tags.find(tag => tag.startsWith('agent:'));
    if (!agentTag) continue;
    const agentId = agentTag.replace('agent:', '');
    if (!agentMap.has(agentId)) agentMap.set(agentId, { traces: [] });
    agentMap.get(agentId)!.traces.push(t);
  }

  const rows: ObservabilityAgentRow[] = [];
  for (const [agentId, data] of agentMap) {
    const agentName = agentNames.get(agentId) ?? agentId;
    const traceCount = data.traces.length;
    let totalCost = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let errorCount = 0;

    for (const t of data.traces) {
      totalCost += t.totalCost ?? 0;
      if (t.latency != null) { totalLatency += t.latency; latencyCount++; }
      if (deriveStatus(t.output) === 'error') errorCount++;
    }

    rows.push({
      agentId,
      agentName,
      traceCount,
      totalCost,
      errorRate: traceCount > 0 ? errorCount / traceCount : 0,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
    });
  }

  return rows;
}
