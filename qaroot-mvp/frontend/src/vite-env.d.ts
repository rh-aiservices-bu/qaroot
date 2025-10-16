/// <reference types="vite/client" />

interface Window {
  ENV?: {
    VITE_API_URL?: string;
    VITE_WS_URL?: string;
  };
}
