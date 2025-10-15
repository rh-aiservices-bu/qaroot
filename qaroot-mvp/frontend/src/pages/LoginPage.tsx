import { useState } from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  TextInput,
  Button,
  Alert,
  ActionGroup,
} from '@patternfly/react-core';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      // Force a full page reload to ensure auth state is updated
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100vw',
      backgroundColor: '#f0f0f0'
    }}>
      <Card style={{ width: '400px', maxWidth: '90%' }}>
          <CardTitle style={{
            textAlign: 'center',
            fontSize: '1.75rem',
            fontWeight: 600,
            padding: '2rem 1.5rem 1rem'
          }}>
            QARoot Login
          </CardTitle>
          <CardBody style={{ padding: '1rem 2rem 2rem' }}>
            {error && (
              <Alert
                variant="danger"
                title={error}
                isInline
                style={{ marginBottom: '1.5rem' }}
              />
            )}
            <Form onSubmit={handleSubmit}>
              <FormGroup
                label="Username"
                isRequired
                fieldId="username"
                style={{ marginBottom: '1rem' }}
              >
                <TextInput
                  id="username"
                  name="username"
                  value={username}
                  onChange={(_, value) => setUsername(value)}
                  type="text"
                  isRequired
                  autoComplete="username"
                  aria-label="Username"
                />
              </FormGroup>
              <FormGroup
                label="Password"
                isRequired
                fieldId="password"
                style={{ marginBottom: '1.5rem' }}
              >
                <TextInput
                  id="password"
                  name="password"
                  value={password}
                  onChange={(_, value) => setPassword(value)}
                  type="password"
                  isRequired
                  autoComplete="current-password"
                  aria-label="Password"
                />
              </FormGroup>
              <ActionGroup style={{ marginTop: '1.5rem' }}>
                <Button
                  type="submit"
                  variant="primary"
                  isBlock
                  isLoading={loading}
                  isDisabled={loading}
                  size="lg"
                >
                  {loading ? 'Logging in...' : 'Login'}
                </Button>
              </ActionGroup>
            </Form>
          </CardBody>
        </Card>
    </div>
  );
}
