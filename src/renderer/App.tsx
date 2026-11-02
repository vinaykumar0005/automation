// src/renderer/App.tsx
import { useAutomationBootstrap } from './hooks/useAutomationApi';
import { ControlPanel } from './components/ControlPanel';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { ProxyPanel } from './components/ProxyPanel';
import { AdvancedPanel } from './components/AdvancedPanel';
import { TaskPanel } from './components/TaskPanel';
import { ProfilePanel } from './components/ProfilePanel';
import { TabGrid } from './components/TabGrid';
import { LogConsole } from './components/LogConsole';

export default function App() {
  useAutomationBootstrap();
  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-white">
      <ControlPanel />
      <AnalyticsPanel />
      <ProxyPanel />
      <AdvancedPanel />
      <ProfilePanel />
      <TaskPanel />
      <div className="flex-1 overflow-y-auto">
        <TabGrid />
      </div>
      <LogConsole />
    </div>
  );
}