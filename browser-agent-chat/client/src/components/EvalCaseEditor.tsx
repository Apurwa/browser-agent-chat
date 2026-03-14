import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import { X } from 'lucide-react';

interface EvalCaseEditorProps {
  projectId: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EvalCaseEditor({ projectId, onSaved, onCancel }: EvalCaseEditorProps) {
  const { getAccessToken } = useAuth();
  const [name, setName] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [checksJson, setChecksJson] = useState('[]');
  const [llmCriteria, setLlmCriteria] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [checksError, setChecksError] = useState('');

  const validateChecks = (val: string): any[] | null => {
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        setChecksError('Checks must be a JSON array');
        return null;
      }
      setChecksError('');
      return parsed;
    } catch {
      setChecksError('Invalid JSON');
      return null;
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !taskPrompt.trim()) return;
    const checks = validateChecks(checksJson);
    if (checks === null) return;

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/projects/${projectId}/evals/cases`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          task_prompt: taskPrompt.trim(),
          checks,
          llm_judge_criteria: llmCriteria.trim() || null,
          tags,
        }),
      });
      if (res.ok) {
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="eval-case-editor">
      <div className="eval-case-editor-header">
        <h2>New Eval Case</h2>
        <button className="eval-close-btn" onClick={onCancel} title="Cancel">
          <X size={16} />
        </button>
      </div>

      <div className="eval-case-editor-body">
        <div className="eval-form-field">
          <label className="eval-form-label">Name <span className="eval-required">*</span></label>
          <input
            className="mv-input"
            placeholder="e.g. Login with valid credentials"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div className="eval-form-field">
          <label className="eval-form-label">Task Prompt <span className="eval-required">*</span></label>
          <textarea
            className="eval-textarea"
            placeholder="Describe the task the agent should perform…"
            value={taskPrompt}
            onChange={e => setTaskPrompt(e.target.value)}
            rows={4}
          />
        </div>

        <div className="eval-form-field">
          <label className="eval-form-label">
            Checks
            <span className="eval-form-hint"> (JSON array)</span>
          </label>
          <textarea
            className={`eval-textarea eval-textarea--mono${checksError ? ' eval-textarea--error' : ''}`}
            value={checksJson}
            onChange={e => {
              setChecksJson(e.target.value);
              validateChecks(e.target.value);
            }}
            rows={4}
            spellCheck={false}
          />
          {checksError && <span className="eval-field-error">{checksError}</span>}
          <span className="eval-form-hint">
            Example: <code>{'[{"type": "url_contains", "value": "/dashboard"}]'}</code>
          </span>
        </div>

        <div className="eval-form-field">
          <label className="eval-form-label">LLM Judge Criteria</label>
          <textarea
            className="eval-textarea"
            placeholder="Describe what a successful result looks like (optional)…"
            value={llmCriteria}
            onChange={e => setLlmCriteria(e.target.value)}
            rows={3}
          />
        </div>

        <div className="eval-form-field">
          <label className="eval-form-label">Tags</label>
          <input
            className="mv-input"
            placeholder="login, auth, smoke (comma-separated)"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
          />
        </div>
      </div>

      <div className="eval-case-editor-footer">
        <button
          className="mv-btn mv-btn-accept"
          onClick={handleSave}
          disabled={saving || !name.trim() || !taskPrompt.trim()}
        >
          {saving ? 'Saving…' : 'Save Case'}
        </button>
        <button className="mv-btn mv-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
