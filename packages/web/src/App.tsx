import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { BindingsPage } from './pages/BindingsPage';
import { EvolutionPage } from './pages/EvolutionPage';
import { FilesPage } from './pages/FilesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimelinePage } from './pages/TimelinePage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TimelinePage />} />
        <Route path="agenda" element={<EvolutionPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="bindings" element={<BindingsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
