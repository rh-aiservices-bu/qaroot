import { useState, useEffect } from 'react';
import { Title, Spinner, Button, Modal, ModalVariant } from '@patternfly/react-core';
import { usersAPI } from '../services/api';
import type { User } from '../types';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    full_name: '',
    role: 'host' as 'host' | 'admin',
    institution: ''
  });

  const loadUsers = () => {
    usersAPI.list()
      .then((response) => {
        setUsers(response.data.users);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load users:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        email: user.email,
        username: user.username,
        password: '',
        full_name: user.full_name || '',
        role: user.role,
        institution: ''
      });
    } else {
      setEditingUser(null);
      setFormData({
        email: '',
        username: '',
        password: '',
        full_name: '',
        role: 'host',
        institution: ''
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
  };

  const handleSubmit = async () => {
    try {
      if (editingUser) {
        // Update user
        const updateData: any = {};
        if (formData.email !== editingUser.email) updateData.email = formData.email;
        if (formData.username !== editingUser.username) updateData.username = formData.username;
        if (formData.password) updateData.password = formData.password;
        if (formData.full_name !== editingUser.full_name) updateData.full_name = formData.full_name;
        if (formData.role !== editingUser.role) updateData.role = formData.role;
        if (formData.institution) updateData.institution = formData.institution;

        await usersAPI.update(editingUser.id, updateData);
      } else {
        // Create user
        await usersAPI.create(formData);
      }
      handleCloseModal();
      loadUsers();
    } catch (err: any) {
      console.error('Failed to save user:', err);
      alert(err.response?.data?.error || 'Failed to save user');
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to delete ${user.username}?`)) return;

    try {
      await usersAPI.delete(user.id);
      loadUsers();
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem', height: '100%', backgroundColor: '#f0f0f0' }}>
        <Spinner size="xl" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <Title headingLevel="h1" size="2xl">
          Users
        </Title>
        <Button variant="primary" onClick={() => handleOpenModal()}>
          Add User
        </Button>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #d2d2d2' }}>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#151515' }}>Username</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#151515' }}>Email</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#151515' }}>Full Name</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#151515' }}>Role</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#151515' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '1rem', color: '#151515' }}>{user.username}</td>
                <td style={{ padding: '1rem', color: '#151515' }}>{user.email}</td>
                <td style={{ padding: '1rem', color: '#151515' }}>{user.full_name || '-'}</td>
                <td style={{ padding: '1rem' }}>
                  <span style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    backgroundColor: user.role === 'admin' ? '#e7f1fa' : '#f0f0f0',
                    color: user.role === 'admin' ? '#0066cc' : '#151515'
                  }}>
                    {user.role}
                  </span>
                </td>
                <td style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button variant="secondary" onClick={() => handleOpenModal(user)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(user)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#666' }}>
            No users found
          </div>
        )}
      </div>

      {/* Add/Edit User Modal */}
      <Modal
        variant={ModalVariant.small}
        title={editingUser ? 'Edit User' : 'Add User'}
        isOpen={showModal}
        onClose={handleCloseModal}
      >
        <div style={{ padding: '1rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Email *
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="username" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Username *
            </label>
            <input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Password {!editingUser && '*'}
            </label>
            <input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder={editingUser ? 'Leave blank to keep current password' : ''}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="full_name" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Full Name
            </label>
            <input
              id="full_name"
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="role" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Role *
            </label>
            <select
              id="role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'host' | 'admin' })}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d2d2d2',
                borderRadius: '4px',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            >
              <option value="host">Host</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <Button variant="link" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isDisabled={!formData.email || !formData.username || (!editingUser && !formData.password)}
            >
              {editingUser ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
