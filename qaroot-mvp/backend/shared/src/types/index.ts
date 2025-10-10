export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  full_name?: string;
  role: 'host' | 'admin';
  institution?: string;
  created_at: Date;
  last_login?: Date;
  is_active: boolean;
}

export type SessionStatus = 'waiting' | 'active' | 'paused' | 'completed';

export interface Session {
  id: string;
  host_id: string;
  title: string;
  description?: string;
  session_pin: string;
  session_status: SessionStatus;
  collection_timer_duration: number;
  collection_started_at?: Date;
  collection_ended_at?: Date;
  actual_start?: Date;
  ended_at?: Date;
  settings?: Record<string, unknown>;
  participant_count: number;
  question_count: number;
  current_iteration: number;
  created_at: Date;
  updated_at: Date;
}

export interface Participant {
  id: string;
  session_id: string;
  nickname: string;
  device_fingerprint?: string;
  joined_at: Date;
  last_seen: Date;
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
  submitted_at: Date;
}

export interface QuestionCluster {
  id: string;
  session_id: string;
  cluster_label?: string;
  representative_question?: string;
  question_count: number;
  centroid_embedding?: number[];
  iteration: number;
  created_at: Date;
}

export interface HostChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

export interface PresentationCollection {
  id: string;
  owner_id: string;
  title: string;
  description?: string;
  tags?: string[];
  created_at: Date;
  updated_at: Date;
}

// API Request/Response types
export interface CreateSessionRequest {
  title: string;
  description?: string;
  collection_timer_duration?: number;
}

export interface CreateSessionResponse {
  session: Session;
  qr_code_url: string;
}

export interface SubmitQuestionRequest {
  session_id: string;
  question_text: string;
  participant_id?: string;
}

export interface AnalyzeQuestionsRequest {
  session_id: string;
}

export interface ChatRequest {
  session_id: string;
  message: string;
}

export interface ChatResponse {
  role: 'assistant';
  content: string;
}

// WebSocket event types
export interface WebSocketEvents {
  'question:submit': SubmitQuestionRequest;
  'question:new': Question;
  'participant:join': { session_id: string; nickname?: string };
  'participant:joined': Participant;
  'session:update': Session;
  'collection:start': { session_id: string };
  'collection:end': { session_id: string };
  'analysis:complete': { session_id: string; cluster_count: number };
}
