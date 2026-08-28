import React, { useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SnapshotPage from './pages/SnapshotPage';
import { useSummary } from './hooks/useSummary';
import { MOCK_SUMMARY } from './data/mockData';
import './App.css';

function App() {
  const mountTime = useRef(new Date().toISOString());
  const { summary } = useSummary(mountTime);
  const snap = summary || MOCK_SUMMARY;

  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/snapshot" element={<SnapshotPage snap={snap} />} />
    </Routes>
  );
}

export default App;
