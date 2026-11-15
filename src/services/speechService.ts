import { AssistantMessage, VoiceCommand } from '../types/assistant';

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
    length: number;
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface IWindowWithSpeech extends Window {
  SpeechRecognition?: {
    new (): ISpeechRecognition;
  };
  webkitSpeechRecognition?: {
    new (): ISpeechRecognition;
  };
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

class SpeechService {
  private recognition: ISpeechRecognition | null = null;
  private isListening: boolean = false;
  private commands: VoiceCommand[] = [];
  private onMessageCallback: ((msg: AssistantMessage) => void) | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private isSpeaking: boolean = false;

  constructor() {
    this.initSpeechSynthesis();
  }

  private initSpeechSynthesis() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        // Look for British male / English voice (JARVIS style)
        this.selectedVoice =
          voices.find(v => v.lang.includes('en-GB') && (v.name.includes('Male') || v.name.includes('George') || v.name.includes('Oliver') || v.name.includes('Daniel'))) ||
          voices.find(v => v.lang.includes('en-GB')) ||
          voices.find(v => v.name.includes('Google UK English Male')) ||
          voices.find(v => v.lang.startsWith('en')) ||
          null;
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  public registerCommands(commands: VoiceCommand[]) {
    this.commands = commands;
  }

  public setMessageCallback(cb: (msg: AssistantMessage) => void) {
    this.onMessageCallback = cb;
  }

  public speak(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 0.95; // Slightly lower, calm British AI pitch
      utterance.volume = 1.0;

      utterance.onstart = () => {
        this.isSpeaking = true;
      };
      utterance.onend = () => {
        this.isSpeaking = false;
        if (onEnd) onEnd();
      };
      utterance.onerror = () => {
        this.isSpeaking = false;
        if (onEnd) onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      this.isSpeaking = false;
      if (onEnd) onEnd();
    }
  }

  public stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
    }
  }

  public isCurrentlySpeaking(): boolean {
    return this.isSpeaking;
  }

  public startListening(): boolean {
    const customWindow = window as unknown as IWindowWithSpeech;
    const SpeechRecognitionClass = customWindow.SpeechRecognition || customWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      console.warn('Speech Recognition API not supported in this browser environment.');
      return false;
    }

    if (this.isListening) return true;

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const rawTranscript = lastResult[0].transcript.trim();
          this.handleTranscript(rawTranscript);
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Speech recognition status/event:', event.error);
        if (event.error === 'not-allowed') {
          this.isListening = false;
        }
      };

      this.recognition.onend = () => {
        // Automatically restart listening if still enabled
        if (this.isListening) {
          try {
            this.recognition?.start();
          } catch {
            // ignore
          }
        }
      };

      this.recognition.start();
      this.isListening = true;
      return true;
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      this.isListening = false;
      return false;
    }
  }

  public stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  public isListeningActive(): boolean {
    return this.isListening;
  }

  public handleTranscript(rawTranscript: string) {
    if (!rawTranscript) return;
    const clean = rawTranscript.toLowerCase().replace(/[.,!?;:]/g, '');

    // Post user utterance to message stream
    if (this.onMessageCallback) {
      this.onMessageCallback({
        id: Math.random().toString(36).substring(7),
        sender: 'USER',
        text: rawTranscript,
        timestamp: new Date().toLocaleTimeString(),
        type: 'COMMAND'
      });
    }

    // Match against registered commands
    let matched = false;
    for (const cmd of this.commands) {
      for (const pattern of cmd.patterns) {
        if (clean.includes(pattern.toLowerCase())) {
          matched = true;
          cmd.action(clean);
          
          const responseText = cmd.feedbackText;
          if (this.onMessageCallback) {
            this.onMessageCallback({
              id: Math.random().toString(36).substring(7),
              sender: 'JARVIS',
              text: responseText,
              timestamp: new Date().toLocaleTimeString(),
              type: 'RESPONSE'
            });
          }
          this.speak(responseText);
          return;
        }
      }
    }

    // Default conversational fallback
    if (!matched) {
      let fallback = "I heard you, sir, but that command is not recognized in current security protocols.";
      if (clean.includes('hello') || clean.includes('hey jarvis') || clean.includes('jarvis')) {
        fallback = "Good day, sir. Systems are at your disposal.";
      } else if (clean.includes('who are you') || clean.includes('what are you')) {
        fallback = "I am JARVIS: Just A Rather Very Intelligent System. Operating Stark Industries holographic laboratory interface.";
      } else if (clean.includes('thank')) {
        fallback = "At your service, sir. Always a pleasure.";
      }

      if (this.onMessageCallback) {
        this.onMessageCallback({
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: fallback,
          timestamp: new Date().toLocaleTimeString(),
          type: 'RESPONSE'
        });
      }
      this.speak(fallback);
    }
  }
}

export const speechService = new SpeechService();
