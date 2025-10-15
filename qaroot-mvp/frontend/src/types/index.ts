export type SessionStatus = 'waiting' | 'active' | 'paused' | 'completed';

export interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  role: 'host' | 'admin';
}

export interface Session {
  id: string;
  host_id: string;
  title: string;
  description?: string;
  session_pin: string;
  session_status: SessionStatus;
  collection_timer_duration: number;
  collection_started_at?: string;
  collection_ended_at?: string;
  actual_start?: string;
  ended_at?: string;
  settings?: Record<string, unknown>;
  participant_count: number;
  question_count: number;
  current_iteration: number;
  iteration_count?: number;
  iterations?: Array<{ iteration: number; count: number }>;
  created_at: string;
  updated_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  nickname: string;
  device_fingerprint?: string;
  joined_at: string;
  last_seen: string;
  is_active: boolean;
}

export interface Question {
  id: string;
  session_id: string;
  participant_id?: string;
  question_text: string;
  embedding?: number[];
  cluster_id?: string;
  iteration: number;
  submitted_at: string;
  participant_nickname?: string;
}

export interface QuestionCluster {
  id: string;
  session_id: string;
  cluster_label?: string;
  representative_question?: string;
  question_count: number;
  centroid_embedding?: number[];
  iteration: number;
  created_at: string;
  questions?: Question[];
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface CreateSessionResponse {
  session: Session;
  qr_code_url: string;
  join_url: string;
}
