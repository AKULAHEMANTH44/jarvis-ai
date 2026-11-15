export interface VoiceCommand {
  patterns: string[];
  description: string;
  category: 'NAVIGATION' | 'MANIPULATION' | 'CINEMATIC' | 'SYSTEM' | 'AI';
  action: (args?: string) => void;
  feedbackText: string;
}

export interface AssistantMessage {
  id: string;
  sender: 'USER' | 'JARVIS';
  text: string;
  timestamp: string;
  type?: 'COMMAND' | 'RESPONSE' | 'ALERT' | 'INFO';
}

export interface SystemStatusTelemetry {
  cpuLoad: number;
  memoryUsage: number;
  powerOutputGigaWatts: number;
  coreTemperatureKelvin: number;
  containmentStability: number;
  fps: number;
  uptimeSeconds: number;
}
