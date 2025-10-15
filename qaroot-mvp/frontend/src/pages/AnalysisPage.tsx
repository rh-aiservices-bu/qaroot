import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Title,
  Card,
  CardBody,
  Button,
  Spinner,
  List,
  ListItem,
  Badge,
} from '@patternfly/react-core';
import { sessionsAPI } from '../services/api';

interface Question {
  id: string;
  question_text: string;
  participant_nickname?: string;
  submitted_at: string;
  iteration: number;
}

interface Cluster {
  id: string;
  cluster_label?: string;
  representative_question?: string;
  question_count: number;
  questions?: Question[];
  iteration: number;
}

interface IterationGroup {
  iteration: number;
  question_text?: string;
  questions: Question[];
  clusters: Cluster[];
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [iterations, setIterations] = useState<IterationGroup[]>([]);
  const [sessionTitle, setSessionTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [analyzingIterations, setAnalyzingIterations] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      try {
        const [sessionResponse, clustersResponse, questionsResponse, iterationQuestionsResponse] = await Promise.all([
          sessionsAPI.get(id),
          sessionsAPI.getClusters(id),
          sessionsAPI.getQuestions(id),
          sessionsAPI.getIterationQuestions(id)
        ]);
        const clusterData = clustersResponse.data.clusters || [];
        const questionData = questionsResponse.data.questions || [];
        const session = sessionResponse.data.session;
        const iterationQuestionsData = iterationQuestionsResponse.data.iteration_questions || [];

        setSessionTitle(session.title || '');

        // Create map of iteration questions
        const iterationQuestionsMap = new Map<number, string>();
        iterationQuestionsData.forEach((iq: any) => {
          iterationQuestionsMap.set(iq.iteration, iq.question_text);
        });

        // Group by iteration
        const iterationMap = new Map<number, IterationGroup>();

        questionData.forEach((q: Question) => {
          const iter = q.iteration || 1;
          if (!iterationMap.has(iter)) {
            iterationMap.set(iter, {
              iteration: iter,
              question_text: iterationQuestionsMap.get(iter),
              questions: [],
              clusters: []
            });
          }
          iterationMap.get(iter)!.questions.push(q);
        });

        clusterData.forEach((c: Cluster) => {
          const iter = c.iteration || 1;
          if (!iterationMap.has(iter)) {
            iterationMap.set(iter, {
              iteration: iter,
              question_text: iterationQuestionsMap.get(iter),
              questions: [],
              clusters: []
            });
          }
          iterationMap.get(iter)!.clusters.push(c);
        });

        const sortedIterations = Array.from(iterationMap.values()).sort((a, b) => a.iteration - b.iteration);
        setIterations(sortedIterations);
      } catch (err: any) {
        console.error('Failed to fetch analysis data:', err);
        setError('Failed to load analysis results');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleAnalyzeIteration = async (iteration: number) => {
    if (!id) return;

    setAnalyzingIterations(prev => new Set(prev).add(iteration));
    setError('');

    try {
      await sessionsAPI.analyze(id, iteration);

      let pollCount = 0;
      const maxPolls = 30;

      const pollInterval = setInterval(async () => {
        pollCount++;

        try {
          const [clustersResponse, questionsResponse, iterationQuestionsResponse] = await Promise.all([
            sessionsAPI.getClusters(id),
            sessionsAPI.getQuestions(id),
            sessionsAPI.getIterationQuestions(id)
          ]);

          const clusterData = clustersResponse.data.clusters || [];
          const questionData = questionsResponse.data.questions || [];
          const iterationQuestionsData = iterationQuestionsResponse.data.iteration_questions || [];

          const iterationQuestionsMap = new Map<number, string>();
          iterationQuestionsData.forEach((iq: any) => {
            iterationQuestionsMap.set(iq.iteration, iq.question_text);
          });

          const iterationMap = new Map<number, IterationGroup>();
          questionData.forEach((q: Question) => {
            const iter = q.iteration || 1;
            if (!iterationMap.has(iter)) {
              iterationMap.set(iter, {
                iteration: iter,
                question_text: iterationQuestionsMap.get(iter),
                questions: [],
                clusters: []
              });
            }
            iterationMap.get(iter)!.questions.push(q);
          });
          clusterData.forEach((c: Cluster) => {
            const iter = c.iteration || 1;
            if (!iterationMap.has(iter)) {
              iterationMap.set(iter, {
                iteration: iter,
                question_text: iterationQuestionsMap.get(iter),
                questions: [],
                clusters: []
              });
            }
            iterationMap.get(iter)!.clusters.push(c);
          });
          const sortedIterations = Array.from(iterationMap.values()).sort((a, b) => a.iteration - b.iteration);
          setIterations(sortedIterations);

          const iterationClusters = clusterData.filter((c: Cluster) => (c.iteration || 1) === iteration);

          if (iterationClusters.length > 0 || pollCount >= maxPolls) {
            clearInterval(pollInterval);
            setAnalyzingIterations(prev => {
              const next = new Set(prev);
              next.delete(iteration);
              return next;
            });

            if (pollCount >= maxPolls && iterationClusters.length === 0) {
              setError(`Analysis for Round ${iteration} is taking longer than expected. Please try again or check the worker logs.`);
            }
          }
        } catch (err) {
          console.error('Failed to fetch clusters:', err);
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            setAnalyzingIterations(prev => {
              const next = new Set(prev);
              next.delete(iteration);
              return next;
            });
            setError('Failed to fetch analysis results');
          }
        }
      }, 2000);

    } catch (err: any) {
      console.error('Failed to start analysis:', err);
      setError('Failed to start analysis');
      setAnalyzingIterations(prev => {
        const next = new Set(prev);
        next.delete(iteration);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
      }}>
        <Spinner size="xl" />
      </div>
    );
  }

  const currentRound = iterations[currentRoundIndex];
  const hasPrevious = currentRoundIndex > 0;
  const hasNext = currentRoundIndex < iterations.length - 1;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f0f0f0',
    }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #d2d2d2', padding: '1rem 2rem' }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
        }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
            <span
              onClick={() => navigate('/dashboard')}
              style={{ cursor: 'pointer', color: '#0066cc' }}
            >
              All Sessions
            </span>
            {' '}/{' '}
            <span
              onClick={() => navigate(`/session/${id}`)}
              style={{ cursor: 'pointer', color: '#0066cc' }}
            >
              Session
            </span>
            {' '}/{' '}
            <span>Analysis</span>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ flex: 1 }}>
              <Title headingLevel="h1" size="xl">{sessionTitle}</Title>
              {iterations.length > 1 && currentRound && (
                <div style={{ fontSize: '1rem', color: '#666', marginTop: '0.5rem' }}>
                  Round {currentRound.iteration} of {iterations.length}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <Button variant="secondary" onClick={() => navigate(`/session/${id}`)}>
                ← Back to Session
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem 2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <Card style={{ backgroundColor: '#fef0ee' }}>
            <CardBody>{error}</CardBody>
          </Card>
        </div>
      )}

      {/* Navigation Controls */}
      {iterations.length > 1 && (
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'center',
          gap: '1rem'
        }}>
          <Button
            variant="secondary"
            onClick={() => setCurrentRoundIndex(currentRoundIndex - 1)}
            isDisabled={!hasPrevious}
          >
            ← Previous Round
          </Button>
          <Button
            variant="secondary"
            onClick={() => setCurrentRoundIndex(currentRoundIndex + 1)}
            isDisabled={!hasNext}
          >
            Next Round →
          </Button>
        </div>
      )}

      {!currentRound ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
          <p>No rounds available</p>
        </div>
      ) : (
        <>
          {/* Question Header */}
          <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 2rem 1rem' }}>
            <div style={{
              padding: '1rem 1.5rem',
              backgroundColor: '#e7f1fa',
              borderLeft: '4px solid #0066cc',
              borderRadius: '4px',
              fontSize: '1.1rem',
              color: '#151515'
            }}>
              <strong>Question:</strong> {currentRound.question_text || `Round ${currentRound.iteration} responses`}
            </div>
          </div>

          {/* Split Screen Layout for Current Round */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            height: 'calc(100vh - 240px)',
            maxWidth: '1400px',
            margin: '0 auto',
            gap: '0'
          }}>
            {/* Left: Raw Answers */}
            <div style={{
              backgroundColor: '#fff',
              borderRight: '1px solid #d2d2d2',
              overflowY: 'auto',
              padding: '2rem'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem'
              }}>
                <Title headingLevel="h2" size="lg">
                  All Responses ({currentRound.questions.length})
                </Title>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAnalyzeIteration(currentRound.iteration)}
                  isDisabled={analyzingIterations.has(currentRound.iteration) || currentRound.questions.length === 0 || currentRound.clusters.length > 0}
                >
                  {analyzingIterations.has(currentRound.iteration) ? 'Analyzing...' : currentRound.clusters.length > 0 ? 'Analyzed' : 'Analyze Responses'}
                </Button>
              </div>
              {currentRound.questions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
                  <p>No responses submitted yet</p>
                </div>
              ) : (
                <List isPlain>
                  {currentRound.questions.map((q, index) => (
                    <ListItem key={q.id} style={{
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      backgroundColor: '#f5f5f5',
                      borderRadius: '4px',
                    }}>
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <div style={{
                          fontWeight: 'bold',
                          color: '#666',
                          minWidth: '30px'
                        }}>
                          #{index + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                            {q.question_text}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#666' }}>
                            {q.participant_nickname || 'Anonymous'} • {new Date(q.submitted_at).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    </ListItem>
                  ))}
                </List>
              )}
            </div>

            {/* Right: Clustered Responses */}
            <div style={{
              backgroundColor: '#fff',
              overflowY: 'auto',
              padding: '2rem'
            }}>
              <Title headingLevel="h2" size="lg" style={{ marginBottom: '1.5rem' }}>
                Clustered Responses ({currentRound.clusters.length} {currentRound.clusters.length === 1 ? 'cluster' : 'clusters'})
              </Title>
              {analyzingIterations.has(currentRound.iteration) ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
                  <Spinner size="xl" style={{ marginBottom: '1rem' }} />
                  <Title headingLevel="h4" size="md" style={{ marginBottom: '0.5rem' }}>
                    Analyzing responses...
                  </Title>
                  <p>Clustering similar responses using AI</p>
                </div>
              ) : currentRound.clusters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
                  <Title headingLevel="h3" size="md" style={{ marginBottom: '0.5rem' }}>
                    No analysis yet
                  </Title>
                  <p>Click "Analyze Responses" button to cluster similar responses</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {currentRound.clusters.map((cluster) => (
                    <div key={cluster.id} style={{
                      padding: '1.5rem',
                      backgroundColor: '#f0f9ff',
                      borderLeft: '4px solid #0066cc',
                      borderRadius: '4px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <Badge>{cluster.question_count}</Badge>
                        <Title headingLevel="h3" size="md">
                          {cluster.cluster_label || 'Topic'}
                        </Title>
                      </div>
                      {cluster.representative_question && (
                        <p style={{
                          fontSize: '1.125rem',
                          fontWeight: 500,
                          color: '#151515',
                          marginBottom: '1rem',
                        }}>
                          "{cluster.representative_question}"
                        </p>
                      )}
                      {cluster.questions && cluster.questions.length > 0 && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #d2d2d2' }}>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#666' }}>
                            Responses in this cluster:
                          </div>
                          <List isPlain>
                            {cluster.questions.map((q) => (
                              <ListItem key={q.id} style={{
                                padding: '0.5rem 0',
                                fontSize: '0.9rem',
                                color: '#151515',
                              }}>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <span style={{ color: '#666' }}>•</span>
                                  <div>
                                    <div>{q.question_text}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                                      — {q.participant_nickname || 'Anonymous'}
                                    </div>
                                  </div>
                                </div>
                              </ListItem>
                            ))}
                          </List>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
