import { useState, useEffect } from 'react';
import { authAPI } from '../services/api';
import type { User } from '../types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }

    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const response = await authAPI.login(username, password);
    const { token, user } = response.data;

    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));

    setToken(token);
    setUser(user);

    return user;
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      // Ignore logout API errors
      console.error('Logout API error:', error);
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    // Force page reload to trigger redirect to login
    window.location.href = '/login';
  };

  return {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
