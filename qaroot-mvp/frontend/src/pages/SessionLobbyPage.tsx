import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Title,
  Card,
  CardBody,
  Button,
  Badge,
  Spinner,
  Modal,
  ModalVariant,
} from '@patternfly/react-core';
import QRCode from 'qrcode';
import { sessionsAPI } from '../services/api';
import { connectSocket } from '../services/socket';
import type { Session, Question } from '../types';

export default function SessionLobbyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participants, setParticipants] = useState(0);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showNewQuestionModal, setShowNewQuestionModal] = useState(false);
  const [newQuestionDescription, setNewQuestionDescription] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;

    // Fetch session details and questions
    Promise.all([
      sessionsAPI.get(id),
      sessionsAPI.getQuestions(id)
    ]).then(([sessionResponse, questionsResponse]) => {
      const sessionData = sessionResponse.data.session;
      setSession(sessionData);
      setQuestions(questionsResponse.data.questions);
      setLoading(false);

      // Set QR code URL (QR generation happens in separate useEffect)
      const joinUrl = `${window.location.origin}/join/${sessionData.session_pin}`;
      setQrCodeUrl(joinUrl);
    }).catch((err) => {
      console.error('Failed to load session:', err);
      setLoading(false);
    });

    // Connect to WebSocket
    const socket = connectSocket();
    const token = localStorage.getItem('auth_token');

    socket.emit('host:join', { session_id: id, token });

    // Listen for new questions
    socket.on('question:new', (question: Question) => {
      setQuestions((prev) => [...prev, question]);
    });

    // Listen for participant updates
    socket.on('participant:joined', () => {
      setParticipants((prev) => prev + 1);
    });

    socket.on('participant:left', () => {
      setParticipants((prev) => Math.max(0, prev - 1));
    });

    // Listen for session updates
    socket.on('session:update', (update: Partial<Session>) => {
      setSession((prev) => (prev ? { ...prev, ...update } : null));
    });

    return () => {
      socket.off('question:new');
      socket.off('participant:joined');
      socket.off('participant:left');
      socket.off('session:update');
    };
  }, [id]);

  // QR code generation effect
  useEffect(() => {
    console.log('QR code effect triggered:', { qrCodeUrl, hasCanvas: !!canvasRef.current });
    if (qrCodeUrl && canvasRef.current) {
      console.log('Generating QR code for:', qrCodeUrl);
      QRCode.toCanvas(canvasRef.current, qrCodeUrl, {
        width: 256,
        margin: 2,
      })
        .then(() => console.log('QR code generated successfully'))
        .catch((err) => console.error('QR code generation error:', err));
    }
  }, [qrCodeUrl]);

  // Timer countdown effect
  useEffect(() => {
    if (!session || session.session_status !== 'active' || !session.collection_started_at) {
      setTimeRemaining(null);
      return;
    }

    // Calculate remaining time based on when collection started
    const startedAt = new Date(session.collection_started_at).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startedAt) / 1000);
    const duration = session.collection_timer_duration || 60;
    const remaining = Math.max(0, duration - elapsed);

    console.log('[Timer] collection_started_at:', session.collection_started_at);
    console.log('[Timer] startedAt (ms):', startedAt);
    console.log('[Timer] now (ms):', now);
    console.log('[Timer] elapsed (seconds):', elapsed);
    console.log('[Timer] duration (seconds):', duration);
    console.log('[Timer] remaining (seconds):', remaining);

    setTimeRemaining(remaining);

    // Count down every second
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 0) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.session_status, session?.collection_started_at, session?.collection_timer_duration]);

  const handleStartCollection = async () => {
    if (!id) return;
    try {
      console.log('[Start Collection] Current session state before API call:', session);
      const response = await sessionsAPI.start(id);
      console.log('[Start Collection] API response:', response.data.session);
      console.log('[Start Collection] collection_started_at from API:', response.data.session.collection_started_at);
      console.log('[Start Collection] Current time:', new Date().toISOString());
      setSession(response.data.session);
      const socket = connectSocket();
      socket.emit('collection:start', { session_id: id });
    } catch (err) {
      console.error('Failed to start collection:', err);
    }
  };

  const handleEndCollection = async () => {
    if (!id) return;
    try {
      const response = await sessionsAPI.end(id);
      setSession(response.data.session);
      const socket = connectSocket();
      socket.emit('collection:end', { session_id: id });
    } catch (err) {
      console.error('Failed to end collection:', err);
    }
  };

  const handleNewQuestion = async () => {
    if (!id || !newQuestionDescription.trim()) return;
    try {
      const response = await sessionsAPI.newQuestion(id, newQuestionDescription);
      setSession(response.data.session);
      setShowNewQuestionModal(false);
      setNewQuestionDescription('');
      const socket = connectSocket();
      socket.emit('collection:start', { session_id: id });
    } catch (err) {
      console.error('Failed to start new question:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spinner size="xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Title headingLevel="h1">Session not found</Title>
      </div>
    );
  }

  const isWaiting = session.session_status === 'waiting';
  const isActive = session.session_status === 'active';
  const isPaused = session.session_status === 'paused';
  const isCompleted = session.session_status === 'completed';

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
          <span
            onClick={() => navigate('/dashboard')}
            style={{ cursor: 'pointer', color: '#0066cc' }}
          >
            All Sessions
          </span>
          {' '}/{' '}
          <span>{session.title}</span>
        </div>

        <Title headingLevel="h1" size="2xl">{session.title}</Title>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <Badge isRead>{participants} Participants</Badge>
          <Badge isRead>{questions.length} Questions</Badge>
          <Badge isRead>Status: {session.session_status}</Badge>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Left Column: QR Code and Join Info */}
        <div>
          <Card>
            <CardBody>
              <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
                Join Session
              </Title>
              <div style={{ textAlign: 'center' }}>
                <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
                <div style={{ marginTop: '1rem' }}>
                  <Title headingLevel="h3" size="xl">
                    PIN: {session.session_pin}
                  </Title>
                  <p style={{ marginTop: '0.5rem', color: '#666' }}>
                    {qrCodeUrl}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Controls */}
          <Card style={{ marginTop: '1rem' }}>
            <CardBody>
              <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
                Controls
              </Title>

              {/* Timer Display */}
              {isActive && timeRemaining !== null && (
                <div style={{
                  textAlign: 'center',
                  padding: '1.5rem',
                  backgroundColor: timeRemaining <= 10 ? '#fef0ee' : '#f0f0f0',
                  borderRadius: '8px',
                  marginBottom: '1rem'
                }}>
                  <div style={{
                    fontSize: '3rem',
                    fontWeight: 'bold',
                    color: timeRemaining <= 10 ? '#c9190b' : '#151515',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
                    {timeRemaining <= 0 ? 'Time expired' : 'Time remaining'}
                  </div>
                </div>
              )}

              {isWaiting && (
                <Button variant="primary" isBlock onClick={handleStartCollection}>
                  Start Collection
                </Button>
              )}
              {isActive && (
                <Button variant="danger" isBlock onClick={handleEndCollection}>
                  End Collection
                </Button>
              )}
              {(isPaused || isCompleted) && (
                <>
                  <Button
                    variant="primary"
                    isBlock
                    onClick={() => navigate(`/session/${id}/analysis`)}
                    isDisabled={questions.length === 0}
                  >
                    View Analysis ({questions.length} questions)
                  </Button>
                  <Button
                    variant="secondary"
                    isBlock
                    onClick={() => setShowNewQuestionModal(true)}
                    style={{ marginTop: '0.5rem' }}
                  >
                    Ask New Question
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Question Counter */}
        <div>
          <Card style={{ minHeight: '500px' }}>
            <CardBody>
              <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
                Questions Submitted
              </Title>
              <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <div style={{ fontSize: '6rem', fontWeight: 'bold', color: '#151515', lineHeight: 1 }}>
                  {questions.length}
                </div>
                <div style={{ fontSize: '1.25rem', color: '#666', marginTop: '1rem' }}>
                  {questions.length === 1 ? 'question' : 'questions'} collected
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* New Question Modal */}
      <Modal
        variant={ModalVariant.small}
        title="Ask a New Question"
        isOpen={showNewQuestionModal}
        onClose={() => setShowNewQuestionModal(false)}
      >
        <div style={{ padding: '1rem' }}>
          <label htmlFor="new-question-description" style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600 }}>
            Question Prompt
          </label>
          <textarea
            id="new-question-description"
            value={newQuestionDescription}
            onChange={(e) => setNewQuestionDescription(e.target.value)}
            placeholder="e.g., What features would you like to see in the next release?"
            rows={4}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '1px solid #d2d2d2',
              borderRadius: '4px',
              fontSize: '1rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
              lineHeight: '1.5'
            }}
          />
          <p style={{ fontSize: '0.875rem', color: '#6a6e73', marginTop: '0.75rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
            This will start a new round of question collection. Previous questions will be preserved.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button variant="link" onClick={() => setShowNewQuestionModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleNewQuestion}
              isDisabled={!newQuestionDescription.trim()}
            >
              Start Collection
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
