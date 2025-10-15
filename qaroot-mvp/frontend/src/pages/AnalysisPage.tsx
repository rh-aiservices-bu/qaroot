import { useState, useEffect, useRef } from 'react';
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
  TextArea,
  ExpandableSection,
} from '@patternfly/react-core';
import { sessionsAPI, chatAPI } from '../services/api';

interface UIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
  const [chatMessagesByIteration, setChatMessagesByIteration] = useState<Map<number, UIChatMessage[]>>(new Map());
  const [chatInput, setChatInput] = useState('');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  const handleSendChat = async () => {
    if (!id || !chatInput.trim() || chatLoading || !currentRound) return;

    const iteration = currentRound.iteration;
    const userMessage: UIChatMessage = {
      role: 'user',
      content: chatInput.trim(),
    };

    // Add user message to the current iteration's chat history
    setChatMessagesByIteration(prev => {
      const newMap = new Map(prev);
      const messages = newMap.get(iteration) || [];
      newMap.set(iteration, [...messages, userMessage]);
      return newMap;
    });

    setChatInput('');
    setChatLoading(true);

    try {
      const response = await chatAPI.send(id, userMessage.content, iteration);

      // Add assistant response to the current iteration's chat history
      setChatMessagesByIteration(prev => {
        const newMap = new Map(prev);
        const messages = newMap.get(iteration) || [];
        newMap.set(iteration, [...messages, {
          role: response.data.role as 'assistant',
          content: response.data.content
        }]);
        return newMap;
      });
    } catch (err: any) {
      console.error('Failed to send chat message:', err);

      // Add error message to the current iteration's chat history
      setChatMessagesByIteration(prev => {
        const newMap = new Map(prev);
        const messages = newMap.get(iteration) || [];
        newMap.set(iteration, [...messages, {
          role: 'assistant',
          content: 'Error: Failed to get response from LLM'
        }]);
        return newMap;
      });
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessagesByIteration]);

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
              <strong>Topic:</strong> {currentRound.question_text || `Round ${currentRound.iteration} responses`}
            </div>
          </div>

          {/* LLM Chat Interface */}
          <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 2rem 1rem' }}>
            <Card>
              <CardBody>
                <ExpandableSection
                  toggleText={chatExpanded ? "Hide AI Assistant" : "Chat with AI Assistant"}
                  onToggle={() => setChatExpanded(!chatExpanded)}
                  isExpanded={chatExpanded}
                >
                  <div style={{ marginTop: '1rem' }}>
                    {/* Chat Messages */}
                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      marginBottom: '1rem',
                      padding: '1rem',
                      backgroundColor: '#f5f5f5',
                      borderRadius: '4px',
                      minHeight: '200px'
                    }}>
                      {(chatMessagesByIteration.get(currentRound.iteration) || []).length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>
                          <p>Ask the AI assistant about the responses in this topic.</p>
                          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                            The assistant has access to all {currentRound.questions.length} responses with timestamps and participant names.
                          </p>
                        </div>
                      ) : (
                        <>
                          {(chatMessagesByIteration.get(currentRound.iteration) || []).map((msg, idx) => (
                            <div
                              key={idx}
                              style={{
                                marginBottom: '1rem',
                                padding: '0.75rem',
                                backgroundColor: msg.role === 'user' ? '#e7f1fa' : '#fff',
                                borderRadius: '4px',
                                borderLeft: `4px solid ${msg.role === 'user' ? '#0066cc' : '#52c41a'}`
                              }}
                            >
                              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#666' }}>
                                {msg.role === 'user' ? 'You' : 'AI Assistant'}
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                            </div>
                          ))}
                          <div ref={chatEndRef} />
                        </>
                      )}
                    </div>

                    {/* Chat Input */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <TextArea
                        value={chatInput}
                        onChange={(e) => setChatInput((e.target as HTMLTextAreaElement).value)}
                        placeholder="Ask about the responses..."
                        rows={3}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendChat();
                          }
                        }}
                        isDisabled={chatLoading || currentRound.questions.length === 0}
                        style={{ flex: 1 }}
                      />
                      <Button
                        variant="primary"
                        onClick={handleSendChat}
                        isDisabled={!chatInput.trim() || chatLoading || currentRound.questions.length === 0}
                        style={{ alignSelf: 'flex-end' }}
                      >
                        {chatLoading ? <Spinner size="md" /> : 'Send'}
                      </Button>
                    </div>
                  </div>
                </ExpandableSection>
              </CardBody>
            </Card>
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
