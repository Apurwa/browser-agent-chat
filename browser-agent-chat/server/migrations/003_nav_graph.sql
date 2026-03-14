-- Navigation nodes (pages/routes the agent has visited)
CREATE TABLE nav_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url_pattern TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, url_pattern)
);

-- Navigation edges (transitions between pages)
CREATE TABLE nav_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  action_label TEXT NOT NULL DEFAULT '',
  selector TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, from_node_id, to_node_id, action_label)
);

-- Feature-to-node many-to-many
CREATE TABLE nav_node_features (
  nav_node_id UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES memory_features(id) ON DELETE CASCADE,
  PRIMARY KEY (nav_node_id, feature_id)
);

-- Indexes for common queries
CREATE INDEX idx_nav_nodes_project ON nav_nodes(project_id);
CREATE INDEX idx_nav_edges_project ON nav_edges(project_id);
CREATE INDEX idx_nav_edges_from ON nav_edges(from_node_id);
CREATE INDEX idx_nav_edges_to ON nav_edges(to_node_id);
CREATE INDEX idx_nav_node_features_feature ON nav_node_features(feature_id);

-- RLS policies (match existing project-level access pattern)
ALTER TABLE nav_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nav_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE nav_node_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage nav_nodes for their projects"
  ON nav_nodes FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_edges for their projects"
  ON nav_edges FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage nav_node_features for their projects"
  ON nav_node_features FOR ALL
  USING (nav_node_id IN (
    SELECT id FROM nav_nodes WHERE project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  ));
