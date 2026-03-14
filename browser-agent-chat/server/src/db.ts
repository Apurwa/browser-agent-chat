import { supabase, isSupabaseEnabled } from './supabase.js';
import { normalizeUrl } from './nav-graph.js';
import type {
  Project, Feature, Flow, Finding, Session, Message,
  EncryptedCredentials, Criticality, FindingType, FindingStatus, ReproStep,
  Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData, FlowStep, Checkpoint,
  ChatMessage
} from './types.js';

// === Projects ===

export async function createProject(
  userId: string, name: string, url: string,
  credentials: EncryptedCredentials | null, context: string | null
): Promise<Project | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('projects')
    .insert({ user_id: userId, name, url, credentials, context })
    .select()
    .single();
  if (error) { console.error('createProject error:', error); return null; }
  return data;
}

export async function getProject(projectId: string): Promise<Project | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  if (error) return null;
  return data;
}

export async function listProjects(userId: string): Promise<Project[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('listProjects error:', error); return []; }
  return data ?? [];
}

export async function updateProject(
  projectId: string, updates: Partial<Pick<Project, 'name' | 'url' | 'credentials' | 'context'>>
): Promise<Project | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select()
    .single();
  if (error) { console.error('updateProject error:', error); return null; }
  return data;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!.from('projects').delete().eq('id', projectId);
  return !error;
}

export async function getProjectListStats(projectIds: string[]): Promise<Map<string, { findingsCount: number; lastSessionAt: string | null }>> {
  const result = new Map<string, { findingsCount: number; lastSessionAt: string | null }>();
  projectIds.forEach(id => result.set(id, { findingsCount: 0, lastSessionAt: null }));

  if (!isSupabaseEnabled() || projectIds.length === 0) return result;

  // Fetch findings counts (parallel queries — Supabase JS doesn't support GROUP BY natively)
  await Promise.all(projectIds.map(async id => {
    const { count } = await supabase!
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', id)
      .neq('status', 'dismissed');
    const entry = result.get(id);
    if (entry) entry.findingsCount = count ?? 0;
  }));

  // Fetch last session timestamps (single query for all projects)
  const { data: sessionData } = await supabase!
    .from('sessions')
    .select('project_id, started_at')
    .in('project_id', projectIds)
    .order('started_at', { ascending: false });
  if (sessionData) {
    for (const row of sessionData) {
      const entry = result.get(row.project_id);
      // First row per project_id is the most recent (ordered desc)
      if (entry && entry.lastSessionAt === null) {
        entry.lastSessionAt = row.started_at;
      }
    }
  }

  return result;
}

// === Memory Features ===

export async function listFeatures(projectId: string): Promise<Feature[]> {
  if (!isSupabaseEnabled()) return [];
  const { data: features, error } = await supabase!
    .from('memory_features')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error || !features) return [];

  // Attach flows to each feature
  const { data: flows } = await supabase!
    .from('memory_flows')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  return features.map(f => ({
    ...f,
    flows: (flows ?? []).filter(fl => fl.feature_id === f.id),
  }));
}

export async function createFeature(
  projectId: string, name: string, description: string | null,
  criticality: Criticality, expectedBehaviors: string[]
): Promise<Feature | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('memory_features')
    .insert({ project_id: projectId, name, description, criticality, expected_behaviors: expectedBehaviors })
    .select()
    .single();
  if (error) { console.error('createFeature error:', error); return null; }
  return { ...data, flows: [] };
}

export async function updateFeature(
  featureId: string, updates: Partial<Pick<Feature, 'name' | 'description' | 'criticality' | 'expected_behaviors'>>
): Promise<Feature | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('memory_features')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', featureId)
    .select()
    .single();
  if (error) { console.error('updateFeature error:', error); return null; }
  return data;
}

export async function deleteFeature(featureId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!.from('memory_features').delete().eq('id', featureId);
  return !error;
}

export async function findFeatureByName(
  projectId: string,
  name: string
): Promise<Feature | null> {
  if (!isSupabaseEnabled()) return null;
  // Escape SQL wildcards for ilike (case-insensitive exact match)
  const escaped = name.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const { data, error } = await supabase!
    .from('memory_features')
    .select('*')
    .eq('project_id', projectId)
    .ilike('name', escaped)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// === Memory Flows ===

export async function createFlow(
  featureId: string, projectId: string, name: string,
  steps: Flow['steps'], checkpoints: Flow['checkpoints'], criticality: Criticality
): Promise<Flow | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('memory_flows')
    .insert({ feature_id: featureId, project_id: projectId, name, steps, checkpoints, criticality })
    .select()
    .single();
  if (error) { console.error('createFlow error:', error); return null; }
  return data;
}

export async function updateFlow(
  flowId: string, updates: Partial<Pick<Flow, 'name' | 'steps' | 'checkpoints' | 'criticality'>>
): Promise<Flow | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('memory_flows')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', flowId)
    .select()
    .single();
  if (error) { console.error('updateFlow error:', error); return null; }
  return data;
}

export async function deleteFlow(flowId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!.from('memory_flows').delete().eq('id', flowId);
  return !error;
}

// === Sessions ===

export async function createSession(projectId: string): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('sessions')
    .insert({ project_id: projectId })
    .select('id')
    .single();
  if (error) { console.error('createSession error:', error); return null; }
  return data.id;
}

export async function endSession(sessionId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;
  await supabase!
    .from('sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

// === Messages ===

export async function saveMessage(
  sessionId: string, role: Message['role'], content: string
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  await supabase!.from('messages').insert({ session_id: sessionId, role, content });
}

export async function getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
  if (!isSupabaseEnabled()) return [];
  try {
    const { data, error } = await supabase!
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error || !data) return [];

    return data.map(m => ({
      id: m.id,
      type: (m.role === 'thought' || m.role === 'action') ? 'agent' as const : m.role as ChatMessage['type'],
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

// === Findings ===

export async function createFinding(finding: Omit<Finding, 'id' | 'created_at'>): Promise<Finding | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('findings')
    .insert(finding)
    .select()
    .single();
  if (error) { console.error('createFinding error:', error); return null; }

  // Increment findings_count on session
  try {
    await supabase!.rpc('increment_findings_count', { sid: finding.session_id });
  } catch {
    // Best effort
  }

  return data;
}

export async function listFindings(
  projectId: string,
  filters: { type?: FindingType; severity?: Criticality; status?: FindingStatus },
  limit = 50, offset = 0
): Promise<{ findings: Finding[]; total: number }> {
  if (!isSupabaseEnabled()) return { findings: [], total: 0 };

  let query = supabase!.from('findings').select('*', { count: 'exact' }).eq('project_id', projectId);

  if (filters.type) query = query.eq('type', filters.type);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) { console.error('listFindings error:', error); return { findings: [], total: 0 }; }
  return { findings: data ?? [], total: count ?? 0 };
}

export async function updateFindingStatus(
  findingId: string, status: FindingStatus
): Promise<Finding | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('findings')
    .update({ status })
    .eq('id', findingId)
    .select()
    .single();
  if (error) { console.error('updateFindingStatus error:', error); return null; }
  return data;
}

// === Screenshot Upload ===

export async function uploadScreenshot(
  projectId: string, base64Data: string
): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `${projectId}/${Date.now()}.png`;

  const { error } = await supabase!.storage
    .from('screenshots')
    .upload(filename, buffer, { contentType: 'image/png' });
  if (error) { console.error('uploadScreenshot error:', error); return null; }

  const { data } = supabase!.storage.from('screenshots').getPublicUrl(filename);
  return data.publicUrl;
}

// === Memory Suggestions ===

export async function createSuggestion(
  projectId: string,
  type: Suggestion['type'],
  data: Suggestion['data'],
  sessionId: string | null
): Promise<Suggestion | null> {
  if (!isSupabaseEnabled()) return null;

  // --- Deduplication ---
  const name = 'name' in data ? (data as any).name : ('feature_name' in data ? (data as any).feature_name : null);

  if (name) {
    // Check for existing pending suggestion with same type and matching identity
    const { data: pendingDupes } = await supabase!
      .from('memory_suggestions')
      .select('id, data')
      .eq('project_id', projectId)
      .eq('type', type)
      .eq('status', 'pending');

    if (pendingDupes) {
      let isDupe = false;
      if (type === 'behavior') {
        // For behaviors, check both feature_name AND behavior text
        const bd = data as BehaviorSuggestionData;
        isDupe = pendingDupes.some((s: any) =>
          s.data?.feature_name?.toLowerCase() === bd.feature_name.toLowerCase()
          && s.data?.behavior === bd.behavior
        );
      } else {
        // For features/flows, check by name
        isDupe = pendingDupes.some((s: any) => {
          const sName = s.data?.name;
          return sName && sName.toLowerCase() === name.toLowerCase();
        });
      }
      if (isDupe) return null;
    }

    // Check for already-accepted entities
    if (type === 'feature') {
      const existing = await findFeatureByName(projectId, name);
      if (existing) return null;
    }

    if (type === 'flow') {
      // Check if a flow with this name already exists under the parent feature
      const fd = data as FlowSuggestionData;
      const feature = await findFeatureByName(projectId, fd.feature_name);
      if (feature) {
        const escaped = fd.name.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const { data: existingFlow } = await supabase!
          .from('memory_flows')
          .select('id')
          .eq('feature_id', feature.id)
          .ilike('name', escaped)
          .limit(1)
          .maybeSingle();
        if (existingFlow) return null;
      }
    }

    if (type === 'behavior') {
      const bd = data as BehaviorSuggestionData;
      const feature = await findFeatureByName(projectId, bd.feature_name);
      if (feature && feature.expected_behaviors?.includes(bd.behavior)) {
        return null; // Identical behavior already accepted
      }
    }
  }

  // --- Insert ---
  const { data: inserted, error } = await supabase!
    .from('memory_suggestions')
    .insert({
      project_id: projectId,
      type,
      data,
      source_session: sessionId,
    })
    .select()
    .single();

  if (error) { console.error('createSuggestion error:', error); return null; }
  return inserted;
}

export async function listPendingSuggestions(projectId: string): Promise<Suggestion[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('memory_suggestions')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) { console.error('listPendingSuggestions error:', error); return []; }
  return data ?? [];
}

export async function getPendingSuggestionCount(projectId: string): Promise<number> {
  if (!isSupabaseEnabled()) return 0;
  const { count, error } = await supabase!
    .from('memory_suggestions')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending');
  if (error) { console.error('getPendingSuggestionCount error:', error); return 0; }
  return count ?? 0;
}

export async function acceptSuggestion(suggestionId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;

  const { data: suggestion, error: fetchError } = await supabase!
    .from('memory_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single();

  if (fetchError || !suggestion) return false;

  const { type, data: suggData, project_id: projectId } = suggestion;

  // Process by type
  if (type === 'feature') {
    const fd = suggData as FeatureSuggestionData;
    const created = await createFeature(projectId, fd.name, fd.description, fd.criticality, fd.expected_behaviors);

    // Link feature to nav node if discovery URL is known
    if (created && fd.discovered_at_url) {
      try {
        const urlPattern = normalizeUrl(fd.discovered_at_url);
        const { data: node } = await supabase!
          .from('nav_nodes')
          .select('id')
          .eq('project_id', projectId)
          .eq('url_pattern', urlPattern)
          .maybeSingle();

        if (node) {
          await supabase!
            .from('nav_node_features')
            .upsert(
              { nav_node_id: node.id, feature_id: created.id },
              { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
            );
        } else {
          console.warn(`[DB] No nav_node found for URL pattern "${urlPattern}" — skipping feature link`);
        }
      } catch (err) {
        console.warn('[DB] Failed to link feature to nav node:', err);
      }
    }
  } else if (type === 'flow') {
    const fd = suggData as FlowSuggestionData;
    let feature = await findFeatureByName(projectId, fd.feature_name);
    if (!feature) {
      feature = await createFeature(projectId, fd.feature_name, null, fd.criticality, []);
    }
    if (feature) {
      await createFlow(feature.id, projectId, fd.name, fd.steps, fd.checkpoints, fd.criticality);
    }
  } else if (type === 'behavior') {
    const fd = suggData as BehaviorSuggestionData;
    let feature = await findFeatureByName(projectId, fd.feature_name);
    if (!feature) {
      feature = await createFeature(projectId, fd.feature_name, null, 'medium', []);
    }
    if (feature) {
      await supabase!.rpc('append_expected_behavior', {
        feature_uuid: feature.id,
        new_behavior: fd.behavior,
      });
    }
  }

  // Mark as accepted
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString() })
    .eq('id', suggestionId);

  return !error;
}

export async function dismissSuggestion(suggestionId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('id', suggestionId);
  return !error;
}

export async function updateSuggestionData(
  suggestionId: string,
  data: Suggestion['data']
): Promise<Suggestion | null> {
  if (!isSupabaseEnabled()) return null;
  const { data: updated, error } = await supabase!
    .from('memory_suggestions')
    .update({ data })
    .eq('id', suggestionId)
    .select()
    .single();
  if (error) { console.error('updateSuggestionData error:', error); return null; }
  return updated;
}

export async function bulkAcceptSuggestions(projectId: string): Promise<number> {
  if (!isSupabaseEnabled()) return 0;
  const pending = await listPendingSuggestions(projectId);
  if (pending.length === 0) return 0;

  // Process in order: features first, then flows, then behaviors
  const features = pending.filter(s => s.type === 'feature');
  const flows = pending.filter(s => s.type === 'flow');
  const behaviors = pending.filter(s => s.type === 'behavior');

  let accepted = 0;
  for (const s of [...features, ...flows, ...behaviors]) {
    const ok = await acceptSuggestion(s.id);
    if (ok) accepted++;
  }
  return accepted;
}

export async function bulkDismissSuggestions(projectId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;
  const { error } = await supabase!
    .from('memory_suggestions')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('status', 'pending');
  return !error;
}
