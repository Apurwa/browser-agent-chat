import { Outlet } from 'react-router-dom';
import { SidebarProvider } from '../contexts/SidebarContext';
import Sidebar from './Sidebar';

export default function SidebarLayout() {
  return (
    <SidebarProvider>
      <div className="app-layout">
        <Sidebar />
        <Outlet />
      </div>
    </SidebarProvider>
  );
}
