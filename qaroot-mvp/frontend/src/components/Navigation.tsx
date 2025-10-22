import { useNavigate, useLocation } from 'react-router-dom';
import { Nav, NavList, NavItem } from '@patternfly/react-core';
import { useState, useEffect } from 'react';
import type { User } from '../types';

export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, []);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div style={{
      width: '250px',
      backgroundColor: '#151515',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      padding: '2rem 0',
      color: '#fff'
    }}>
      <div style={{ padding: '0 1.5rem', marginBottom: '2rem', cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0, color: '#fff' }}>
          QARoot
        </h1>
      </div>

      <Nav>
        <NavList>
          <NavItem
            isActive={isActive('/dashboard')}
            onClick={() => navigate('/dashboard')}
            style={{
              cursor: 'pointer',
              padding: '0.75rem 1.5rem',
              color: isActive('/dashboard') ? '#fff' : '#d2d2d2',
              backgroundColor: isActive('/dashboard') ? '#0066cc' : 'transparent',
              borderLeft: isActive('/dashboard') ? '4px solid #fff' : '4px solid transparent'
            }}
          >
            All Sessions
          </NavItem>
          {user?.role === 'admin' && (
            <NavItem
              isActive={isActive('/users')}
              onClick={() => navigate('/users')}
              style={{
                cursor: 'pointer',
                padding: '0.75rem 1.5rem',
                color: isActive('/users') ? '#fff' : '#d2d2d2',
                backgroundColor: isActive('/users') ? '#0066cc' : 'transparent',
                borderLeft: isActive('/users') ? '4px solid #fff' : '4px solid transparent'
              }}
            >
              Users
            </NavItem>
          )}
        </NavList>
      </Nav>

      <div style={{
        position: 'absolute',
        bottom: '2rem',
        left: 0,
        right: 0,
        padding: '0 1.5rem',
        fontSize: '0.875rem',
        color: '#8a8d90'
      }}>
        <div style={{ marginBottom: '1rem' }}>Logged in as {user?.username || 'user'}</div>
        <button
          onClick={() => {
            localStorage.removeItem('auth_token');
            navigate('/login');
          }}
          style={{
            background: 'transparent',
            border: '1px solid #8a8d90',
            color: '#8a8d90',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            borderRadius: '4px',
            width: '100%',
            fontSize: '0.875rem'
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
