import { supabase, isSupabaseEnabled } from './supabase.js';
import type {
  Project, Feature, Flow, Finding, Session, Message,
  EncryptedCredentials, Criticality, FindingType, FindingStatus, ReproStep
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

export async function createSession(projectId: string, userId: string | null = null): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  const { data, error } = await supabase!
    .from('sessions')
    .insert({ project_id: projectId, user_id: userId })
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
