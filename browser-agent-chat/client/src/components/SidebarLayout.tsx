import { Outlet } from 'react-router-dom';
import { SidebarProvider } from '../contexts/SidebarContext';
import Sidebar from './Sidebar';
import CommandPalette from './CommandPalette';

export default function SidebarLayout() {
  return (
    <SidebarProvider>
      <div className="app-layout">
        <Sidebar />
        <Outlet />
      </div>
      <CommandPalette />
    </SidebarProvider>
  );
}
