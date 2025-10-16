import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  CardBody,
  Button,
  Alert,
  Title,
} from '@patternfly/react-core';
import { connectSocket } from '../services/socket';

export default function JoinPage() {
  const { pin } = useParams<{ pin: string }>();
  const [nickname, setNickname] = useState('');
  const [question, setQuestion] = useState('');
  const [joined, setJoined] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');
  const [collectionStartedAt, setCollectionStartedAt] = useState<string | null>(null);
  const [timerDuration, setTimerDuration] = useState(60);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const socket = connectSocket();

    socket.on('collection:started', (data: any) => {
      setSessionStatus('active');
      setCollectionStartedAt(data.started_at || new Date().toISOString());
      if (data.description) {
        setSessionDescription(data.description);
        setSuccess('New topic: ' + data.description);
      } else {
        setSuccess('Collection started! You can now submit your response.');
      }
    });

    socket.on('collection:ended', () => {
      setSessionStatus('paused');
      setCollectionStartedAt(null);
      setSuccess('Question collection ended. Thank you for participating!');
    });

    socket.on('session:update', (update: any) => {
      if (update.description !== undefined) {
        setSessionDescription(update.description);
        setSuccess('New topic: ' + update.description);
      }
      if (update.session_status !== undefined) {
        setSessionStatus(update.session_status);
      }
      if (update.collection_started_at !== undefined) {
        setCollectionStartedAt(update.collection_started_at);
      }
    });

    return () => {
      socket.off('collection:started');
      socket.off('collection:ended');
      socket.off('session:update');
    };
  }, []);

  // Timer countdown effect
  useEffect(() => {
    if (sessionStatus !== 'active' || !collectionStartedAt) {
      setTimeRemaining(null);
      return;
    }

    // Calculate initial time remaining
    const startedAt = new Date(collectionStartedAt).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startedAt) / 1000);
    const remaining = Math.max(0, timerDuration - elapsed);

    setTimeRemaining(remaining);

    // Update timer every second
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 0) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionStatus, collectionStartedAt, timerDuration]);

  const handleJoin = () => {
    if (submitting) return;

    setSubmitting(true);
    setError('');

    const socket = connectSocket();

    socket.emit('participant:join', { session_pin: pin, nickname: nickname.trim() || 'Anonymous' }, (response: any) => {
      setSubmitting(false);

      if (response.error) {
        setError(response.error);
      } else {
        setJoined(true);
        setSessionId(response.session.id);
        setParticipantId(response.participant?.id || null);
        setSessionTitle(response.session.title);
        setSessionDescription(response.session.description || '');
        setSessionStatus(response.session.session_status);
        setCollectionStartedAt(response.session.collection_started_at);
        setTimerDuration(response.session.collection_timer_duration || 60);
      }
    });
  };

  const handleSubmitQuestion = () => {
    if (!question.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    const socket = connectSocket();

    socket.emit(
      'question:submit',
      { session_id: sessionId, participant_id: participantId, question_text: question.trim() },
      (response: any) => {
        setSubmitting(false);

        if (response.error) {
          setError(response.error);
        } else {
          setSuccess('Question submitted successfully!');
          setQuestion('');
          setTimeout(() => setSuccess(''), 3000);
        }
      }
    );
  };

  if (!joined) {
    return (
      <div style={{
        backgroundColor: '#f0f0f0',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '2rem',
        height: '100%'
      }}>
        <Card style={{ width: '100%', maxWidth: '450px' }}>
          <CardBody style={{ padding: '1.5rem' }}>
            <Title headingLevel="h1" size="2xl" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              Join Session
            </Title>

            <div style={{
              textAlign: 'center',
              padding: '1rem',
              backgroundColor: '#f5f5f5',
              borderRadius: '8px',
              marginBottom: '1.5rem'
            }}>
              <Title headingLevel="h2" size="3xl">
                PIN: {pin}
              </Title>
            </div>

            {error && <Alert variant="danger" title={error} isInline style={{ marginBottom: '1rem' }} />}

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="nickname" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                Nickname (optional)
              </label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Anonymous"
                maxLength={50}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
                onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
              />
            </div>

            <Button
              variant="primary"
              isBlock
              size="lg"
              onClick={handleJoin}
              isLoading={submitting}
              isDisabled={submitting}
            >
              {submitting ? 'Joining...' : 'Join Session'}
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const canSubmit = sessionStatus === 'active';

  return (
    <div style={{
      backgroundColor: '#f0f0f0',
      padding: '1rem',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      paddingTop: '2rem',
      height: '100%'
    }}>
      <Card style={{ width: '100%', maxWidth: '600px' }}>
        <CardBody style={{ padding: '1.5rem' }}>
          <Title headingLevel="h1" size="xl" style={{ marginBottom: '0.5rem' }}>
            {sessionTitle}
          </Title>
          <p style={{ color: '#666', marginBottom: sessionDescription ? '0.5rem' : '1.5rem' }}>
            {nickname || 'Anonymous'} • PIN: {pin}
          </p>

          {sessionDescription && (
            <div style={{
              padding: '1rem',
              backgroundColor: '#f0f9ff',
              borderLeft: '3px solid #0066cc',
              borderRadius: '4px',
              marginBottom: '1.5rem'
            }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0066cc', marginBottom: '0.25rem' }}>
                Topic
              </div>
              <div style={{ fontSize: '0.9375rem', color: '#333' }}>
                {sessionDescription}
              </div>
            </div>
          )}

          {error && <Alert variant="danger" title={error} isInline style={{ marginBottom: '1rem' }} />}
          {success && <Alert variant="success" title={success} isInline style={{ marginBottom: '1rem' }} />}

          {!canSubmit && (
            <Alert
              variant="info"
              title="Collection is not active"
              isInline
              style={{ marginBottom: '1rem' }}
            >
              Please wait for the host to start collection.
            </Alert>
          )}

          {/* Timer Display */}
          {canSubmit && timeRemaining !== null && (
            <div style={{
              textAlign: 'center',
              padding: '1.5rem',
              backgroundColor: timeRemaining <= 10 ? '#fef0ee' : '#f0f0f0',
              borderRadius: '8px',
              marginBottom: '1rem'
            }}>
              <div style={{
                fontSize: '2.5rem',
                fontWeight: 'bold',
                color: timeRemaining <= 10 ? '#c9190b' : '#151515',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
                {timeRemaining <= 0 ? 'Time expired' : 'Time remaining to submit'}
              </div>
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="question" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Your Response <span style={{ color: 'red' }}>*</span>
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={5}
              maxLength={500}
              placeholder="Enter your response here..."
              disabled={!canSubmit}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ textAlign: 'right', fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
              {question.length}/500 characters
            </div>
          </div>

          <Button
            variant="primary"
            isBlock
            size="lg"
            onClick={handleSubmitQuestion}
            isLoading={submitting}
            isDisabled={!canSubmit || !question.trim() || submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Question'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
