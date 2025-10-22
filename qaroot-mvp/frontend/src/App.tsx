import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SessionLobbyPage from './pages/SessionLobbyPage';
import JoinPage from './pages/JoinPage';
import AnalysisPage from './pages/AnalysisPage';
import UsersPage from './pages/UsersPage';

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Check if current route should show navigation (authenticated pages only, excluding /join)
  const showNavigation = isAuthenticated && !location.pathname.startsWith('/join') && location.pathname !== '/login';

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {showNavigation && <Navigation />}
      <div style={{
        flex: 1,
        marginLeft: showNavigation ? '250px' : '0',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh'
      }}>
        <div style={{ flex: 1 }}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/join/:pin" element={<JoinPage />} />

            {/* Protected routes */}
            <Route
              path="/dashboard"
              element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
            />
            <Route
              path="/session/:id"
              element={isAuthenticated ? <SessionLobbyPage /> : <Navigate to="/login" />}
            />
            <Route
              path="/session/:id/analysis"
              element={isAuthenticated ? <AnalysisPage /> : <Navigate to="/login" />}
            />
            <Route
              path="/users"
              element={isAuthenticated ? <UsersPage /> : <Navigate to="/login" />}
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
