export interface CmdItem {
  id: string;
  label: string;
  sublabel?: string;
  route: string;
  icon: 'agent' | 'vault' | 'observability' | 'action';
  group: string;
}

export const QUICK_ACTIONS: CmdItem[] = [
  { id: 'qa-vault', label: 'Open Vault', route: '/vault', icon: 'vault', group: 'Quick Actions' },
  { id: 'qa-observability', label: 'View Observability', route: '/observability', icon: 'observability', group: 'Quick Actions' },
  { id: 'qa-home', label: 'Go Home', route: '/', icon: 'action', group: 'Quick Actions' },
];
