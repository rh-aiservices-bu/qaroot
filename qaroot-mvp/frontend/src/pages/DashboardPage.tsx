import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title,
  Button,
  Modal,
  ModalVariant,
  Card,
  CardBody,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Badge,
  List,
  ListItem,
  Spinner,
} from '@patternfly/react-core';
import { sessionsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { Session } from '../types';

export default function DashboardPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timerDuration, setTimerDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      console.log('[Dashboard] Loading sessions...');
      const response = await sessionsAPI.list();
      console.log('[Dashboard] Sessions loaded:', response.data.sessions);
      setSessions(response.data.sessions);
    } catch (error: any) {
      console.error('[Dashboard] Failed to load sessions:', error);
      console.error('[Dashboard] Error details:', error.response?.data || error.message);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleCreateSession = async () => {
    if (!title.trim()) return;

    setLoading(true);
    try {
      const response = await sessionsAPI.create(title.trim(), description.trim(), timerDuration);
      navigate(`/session/${response.data.session.id}`);
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!deleteSessionId) return;

    setDeleting(true);
    try {
      await sessionsAPI.delete(deleteSessionId);
      setSessions(sessions.filter(s => s.id !== deleteSessionId));
      setDeleteSessionId(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f0f0f0', padding: '2rem' }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        <Toolbar style={{ padding: 0, marginBottom: '2rem', backgroundColor: 'transparent' }}>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1" size="2xl">
                Welcome, {user?.full_name || user?.username}
              </Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button variant="secondary" onClick={logout}>
                Logout
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        <Card style={{ marginBottom: '2rem' }}>
          <CardBody>
            <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
              Quick Actions
            </Title>
            <Button variant="primary" size="lg" onClick={() => setIsModalOpen(true)}>
              Create New Session
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <Title headingLevel="h2" size="lg">
                Your Sessions
              </Title>
              <Button variant="link" onClick={loadSessions}>Refresh</Button>
            </div>

            {sessionsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <Spinner size="lg" />
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                <p>No sessions yet. Create one to get started!</p>
              </div>
            ) : (
              <List isPlain>
                {sessions.map((session) => (
                  <ListItem key={session.id}>
                    <div
                      onClick={() => navigate(`/session/${session.id}`)}
                      style={{
                        padding: '1rem',
                        marginBottom: '0.5rem',
                        backgroundColor: '#f5f5f5',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        border: '2px solid transparent',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#0066cc';
                        e.currentTarget.style.backgroundColor = '#e7f3ff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'transparent';
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div style={{ flex: 1 }}>
                          <Title headingLevel="h3" size="md" style={{ marginBottom: '0.5rem' }}>
                            {session.title}
                          </Title>
                          <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
                            Created: {new Date(session.created_at).toLocaleDateString()} {new Date(session.created_at).toLocaleTimeString()}
                          </div>
                          {session.iterations && session.iterations.length > 0 && (
                            <div style={{ fontSize: '0.875rem', color: '#444', marginTop: '0.5rem' }}>
                              <strong>{session.iteration_count || 0} rounds:</strong>{' '}
                              {session.iterations.map((iter, idx) => (
                                <span key={iter.iteration}>
                                  Round {iter.iteration} ({iter.count} {iter.count === 1 ? 'response' : 'responses'})
                                  {idx < session.iterations!.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <Badge isRead>{session.question_count || 0} total responses</Badge>
                          <Button
                            variant="danger"
                            isDanger
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteSessionId(session.id);
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </ListItem>
                ))}
              </List>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        variant={ModalVariant.small}
        title="Create New Session"
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div style={{ padding: '1rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="session-title" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Session Title <span style={{ color: 'red' }}>*</span>
            </label>
            <input
              id="session-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., CS101 Lecture Q&A"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem'
              }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="session-description" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Topic
            </label>
            <textarea
              id="session-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Ask questions about the new features in Release 2.0"
              rows={3}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="timer-duration" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Collection Timer (seconds)
            </label>
            <input
              id="timer-duration"
              type="number"
              value={timerDuration}
              onChange={(e) => setTimerDuration(parseInt(e.target.value, 10) || 60)}
              min={30}
              max={300}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              variant="primary"
              onClick={handleCreateSession}
              isLoading={loading}
              isDisabled={loading || !title.trim()}
            >
              Create
            </Button>
            <Button variant="link" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        variant={ModalVariant.small}
        title="Delete Session"
        isOpen={deleteSessionId !== null}
        onClose={() => setDeleteSessionId(null)}
      >
        <div style={{ padding: '1rem' }}>
          <p style={{ marginBottom: '1.5rem' }}>
            Are you sure you want to delete this session? This action cannot be undone and will delete all questions, analysis, and related data.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button variant="link" onClick={() => setDeleteSessionId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isDanger
              onClick={handleDeleteSession}
              isLoading={deleting}
              isDisabled={deleting}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
