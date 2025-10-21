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
  Tooltip,
} from '@patternfly/react-core';
import { CopyIcon, AngleLeftIcon, AngleRightIcon } from '@patternfly/react-icons';
import QRCode from 'qrcode';
import { sessionsAPI } from '../services/api';
import { connectSocket } from '../services/socket';
import type { Session, Question } from '../types';

export default function SessionLobbyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [iterationQuestions, setIterationQuestions] = useState<Map<number, string>>(new Map());
  const [participants, setParticipants] = useState(0);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showNewQuestionModal, setShowNewQuestionModal] = useState(false);
  const [newQuestionDescription, setNewQuestionDescription] = useState('');
  const [newQuestionTimerDuration, setNewQuestionTimerDuration] = useState(60);
  const [urlCopied, setUrlCopied] = useState(false);
  const [viewingIteration, setViewingIteration] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;

    // Fetch session details, questions, and iteration questions
    Promise.all([
      sessionsAPI.get(id),
      sessionsAPI.getQuestions(id),
      sessionsAPI.getIterationQuestions(id)
    ]).then(([sessionResponse, questionsResponse, iterationQuestionsResponse]) => {
      const sessionData = sessionResponse.data.session;
      setSession(sessionData);
      setQuestions(questionsResponse.data.questions);

      // Build map of iteration -> question_text
      const iterQuestionsMap = new Map<number, string>();
      iterationQuestionsResponse.data.iteration_questions.forEach(iq => {
        iterQuestionsMap.set(iq.iteration, iq.question_text);
      });
      setIterationQuestions(iterQuestionsMap);

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

    // Rejoin on reconnect
    const handleReconnect = () => {
      console.log('Socket reconnected, rejoining as host...');
      socket.emit('host:join', { session_id: id, token });
    };

    socket.on('connect', handleReconnect);
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
      socket.off('connect', handleReconnect);
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
          // Timer expired - poll API to get updated session status
          if (prev === 0 && id) {
            sessionsAPI.get(id).then((response) => {
              setSession(response.data.session);
            }).catch((err) => {
              console.error('Failed to refresh session after timer expired:', err);
            });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.session_status, session?.collection_started_at, session?.collection_timer_duration, id]);

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
      const response = await sessionsAPI.newQuestion(id, newQuestionDescription, newQuestionTimerDuration);
      setSession(response.data.session);
      setShowNewQuestionModal(false);
      setNewQuestionDescription('');
      setNewQuestionTimerDuration(60); // Reset to default

      // Refetch iteration questions to update the count
      const iterationQuestionsResponse = await sessionsAPI.getIterationQuestions(id);
      const iterQuestionsMap = new Map<number, string>();
      iterationQuestionsResponse.data.iteration_questions.forEach(iq => {
        iterQuestionsMap.set(iq.iteration, iq.question_text);
      });
      setIterationQuestions(iterQuestionsMap);

      // Broadcast topic update to participants (but don't start collection)
      const socket = connectSocket();
      socket.emit('session:update', {
        session_id: id,
        description: response.data.session.description,
        session_status: 'waiting'
      });
    } catch (err) {
      console.error('Failed to create new topic:', err);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(qrCodeUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem', height: '100%', backgroundColor: '#f0f0f0' }}>
        <Spinner size="xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', height: '100%', backgroundColor: '#f0f0f0' }}>
        <Title headingLevel="h1">Session not found</Title>
      </div>
    );
  }

  const isWaiting = session.session_status === 'waiting';
  const isActive = session.session_status === 'active';
  const isPaused = session.session_status === 'paused';
  const isCompleted = session.session_status === 'completed';

  // Get all iterations from iterationQuestions (includes topics without responses)
  const iterations = Array.from(iterationQuestions.keys()).sort((a, b) => a - b);
  const currentIterationForDisplay = viewingIteration ?? session.current_iteration;
  const currentIterationIndex = iterations.indexOf(currentIterationForDisplay);
  const canGoToPrevious = currentIterationIndex > 0;
  const canGoToNext = currentIterationIndex < iterations.length - 1;

  const handlePreviousTopic = () => {
    if (canGoToPrevious) {
      setViewingIteration(iterations[currentIterationIndex - 1]);
    }
  };

  const handleNextTopic = () => {
    if (canGoToNext) {
      setViewingIteration(iterations[currentIterationIndex + 1]);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem', height: '100%' }}>
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
          <Badge isRead>{questions.length} Responses</Badge>
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
                  <div style={{
                    marginTop: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}>
                    <p style={{ color: '#666', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {qrCodeUrl}
                    </p>
                    <Tooltip content={urlCopied ? 'Copied!' : 'Copy URL'}>
                      <Button
                        variant="plain"
                        onClick={handleCopyUrl}
                        icon={<CopyIcon />}
                        style={{ minWidth: 'auto', padding: '0.25rem', flexShrink: 0 }}
                        aria-label="Copy URL"
                      />
                    </Tooltip>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Controls */}
          <Card style={{ marginTop: '1rem' }}>
            <CardBody>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <Title headingLevel="h2" size="lg" style={{ margin: 0 }}>
                  Controls
                </Title>
                {iterations.length > 1 && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Button
                      variant="plain"
                      onClick={handlePreviousTopic}
                      isDisabled={!canGoToPrevious}
                      icon={<AngleLeftIcon />}
                      aria-label="Previous topic"
                      style={{ minWidth: 'auto', padding: '0.25rem' }}
                    />
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#151515',
                      fontWeight: 400,
                      minWidth: '80px',
                      textAlign: 'center'
                    }}>
                      Topic {currentIterationForDisplay} of {iterations.length}
                    </div>
                    <Button
                      variant="plain"
                      onClick={handleNextTopic}
                      isDisabled={!canGoToNext}
                      icon={<AngleRightIcon />}
                      aria-label="Next topic"
                      style={{ minWidth: 'auto', padding: '0.25rem' }}
                    />
                  </div>
                )}
              </div>

              {/* Topic Text Display */}
              {iterationQuestions.get(currentIterationForDisplay) && (
                <div style={{
                  padding: '1rem',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  borderLeft: '4px solid #0066cc'
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Topic
                  </div>
                  <div style={{ fontSize: '1rem', color: '#151515', lineHeight: '1.5' }}>
                    {iterationQuestions.get(currentIterationForDisplay)}
                  </div>
                </div>
              )}

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
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.5rem'
                  }}>
                    {/* Minutes */}
                    {String(Math.floor(timeRemaining / 60)).padStart(2, '0').split('').map((digit, idx) => (
                      <div
                        key={`min-${idx}`}
                        style={{
                          width: '60px',
                          height: '80px',
                          background: timeRemaining <= 10 ? 'linear-gradient(to bottom, #c9190b 50%, #a30000 50%)' : 'linear-gradient(to bottom, #151515 50%, #252525 50%)',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '3rem',
                          fontWeight: 'bold',
                          color: '#fff',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                          position: 'relative',
                          overflow: 'hidden',
                          fontVariantNumeric: 'tabular-nums'
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: '50%',
                            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)',
                            borderRadius: '8px 8px 0 0'
                          }}
                        />
                        <span style={{ position: 'relative', zIndex: 1 }}>{digit}</span>
                        <div
                          style={{
                            position: 'absolute',
                            top: '50%',
                            left: 0,
                            right: 0,
                            height: '1px',
                            background: 'rgba(0,0,0,0.3)'
                          }}
                        />
                      </div>
                    ))}
                    <span style={{ fontSize: '2rem', fontWeight: 'bold', color: timeRemaining <= 10 ? '#c9190b' : '#151515' }}>:</span>
                    {/* Seconds */}
                    {String(timeRemaining % 60).padStart(2, '0').split('').map((digit, idx) => (
                      <div
                        key={`sec-${idx}`}
                        style={{
                          width: '60px',
                          height: '80px',
                          background: timeRemaining <= 10 ? 'linear-gradient(to bottom, #c9190b 50%, #a30000 50%)' : 'linear-gradient(to bottom, #151515 50%, #252525 50%)',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '3rem',
                          fontWeight: 'bold',
                          color: '#fff',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                          position: 'relative',
                          overflow: 'hidden',
                          fontVariantNumeric: 'tabular-nums'
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: '50%',
                            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)',
                            borderRadius: '8px 8px 0 0'
                          }}
                        />
                        <span style={{ position: 'relative', zIndex: 1 }}>{digit}</span>
                        <div
                          style={{
                            position: 'absolute',
                            top: '50%',
                            left: 0,
                            right: 0,
                            height: '1px',
                            background: 'rgba(0,0,0,0.3)'
                          }}
                        />
                      </div>
                    ))}
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
                    onClick={() => navigate(`/session/${id}/analysis?iteration=${currentIterationForDisplay}`)}
                    isDisabled={questions.filter(q => q.iteration === currentIterationForDisplay).length === 0}
                  >
                    View Analysis ({questions.filter(q => q.iteration === currentIterationForDisplay).length} responses)
                  </Button>
                  <Button
                    variant="secondary"
                    isBlock
                    onClick={() => {
                      setViewingIteration(null);
                      setShowNewQuestionModal(true);
                    }}
                    style={{ marginTop: '0.5rem' }}
                  >
                    New Topic
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Response Counter */}
        <div>
          <Card style={{ minHeight: '500px' }}>
            <CardBody>
              <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
                Responses Submitted
              </Title>
              <div style={{ textAlign: 'center', padding: '2rem 2rem' }}>
                {/* Current Topic Responses */}
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>
                    {viewingIteration !== null ? `Topic ${currentIterationForDisplay}` : 'Current Topic'}
                  </div>
                  <div style={{ fontSize: '4rem', fontWeight: 'bold', color: '#151515', lineHeight: 1 }}>
                    {questions.filter(q => q.iteration === currentIterationForDisplay).length}
                  </div>
                  <div style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
                    {questions.filter(q => q.iteration === currentIterationForDisplay).length === 1 ? 'response' : 'responses'}
                  </div>
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px solid #d2d2d2', margin: '1.5rem 0' }} />

                {/* Total Session Responses */}
                <div>
                  <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>
                    Total Session
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#151515', lineHeight: 1 }}>
                    {questions.length}
                  </div>
                  <div style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
                    {questions.length === 1 ? 'response' : 'responses'} collected
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* New Question Modal */}
      <Modal
        variant={ModalVariant.small}
        title="New Topic"
        isOpen={showNewQuestionModal}
        onClose={() => setShowNewQuestionModal(false)}
      >
        <div style={{ padding: '1rem' }}>
          <label htmlFor="new-question-description" style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600 }}>
            Topic
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
          <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <label htmlFor="new-timer-duration" style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600 }}>
              Collection Timer (seconds)
            </label>
            <input
              id="new-timer-duration"
              type="number"
              value={newQuestionTimerDuration}
              onChange={(e) => setNewQuestionTimerDuration(parseInt(e.target.value, 10) || 60)}
              min={30}
              max={300}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6a6e73', marginBottom: '1.5rem', lineHeight: '1.4' }}>
            This will create a new topic for collection. Previous responses will be preserved.
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
              Create Topic
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
