import { AssistantMessage, VoiceCommand } from '../types/assistant';
import { audioService } from './soundFx';
import { permissionPolicy } from './permissionPolicy';

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

export interface VoiceStartResult {
  started: boolean;
  micGranted: boolean;
  recognitionSupported: boolean;
  error?: string;
}

class SpeechService {
  private recognition: ISpeechRecognition | null = null;
  private isListening: boolean = false;
  private commands: VoiceCommand[] = [];
  private onMessageCallback: ((msg: AssistantMessage) => void) | null = null;
  private onStatusChangeCallback: ((active: boolean, error?: string) => void) | null = null;
  private unmatchedTranscriptHandler:
    | ((rawTranscript: string, source: 'VOICE' | 'CONSOLE') => Promise<string | null> | string | null)
    | null = null;
  private onCommandExecutedCallback: ((cmd: VoiceCommand, rawTranscript: string) => void) | null = null;
  private onCancelCallback: (() => void) | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private isSpeaking: boolean = false;
  private lastSpeakEndedAt: number = 0;
  private restartTimeout: number | null = null;
  private lastError: string | null = null;
  private lastVoiceTranscript: string = '';
  private lastVoiceTranscriptAt: number = 0;

  constructor() {
    this.initSpeechSynthesis();
  }

  private initSpeechSynthesis() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        const voices = window.speechSynthesis.getVoices();
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

  public setStatusChangeCallback(cb: (active: boolean, error?: string) => void) {
    this.onStatusChangeCallback = cb;
  }

  public setUnmatchedTranscriptHandler(
    handler:
      | ((rawTranscript: string, source: 'VOICE' | 'CONSOLE') => Promise<string | null> | string | null)
      | null
  ) {
    this.unmatchedTranscriptHandler = handler;
  }

  public setCommandExecutedCallback(cb: ((cmd: VoiceCommand, rawTranscript: string) => void) | null) {
    this.onCommandExecutedCallback = cb;
  }

  public setCancelCallback(cb: (() => void) | null) {
    this.onCancelCallback = cb;
  }

  public interruptAndCancel() {
    this.stopSpeaking();
    this.onCancelCallback?.();
  }

  public findMatchingCommand(rawTranscript: string): VoiceCommand | null {
    if (!rawTranscript) return null;
    const clean = rawTranscript.toLowerCase().replace(/[.,!?;:]/g, '').trim();
    const wakeOnlyPatterns = new Set(['jarvis', 'hey jarvis', 'hello jarvis']);
    const afterWake = clean.replace(/^(?:hello\s+|hey\s+)?jarvis\b\s*/i, '').trim();
    const hasTrailingRequestAfterWake =
      /^(?:hello\s+|hey\s+)?jarvis\b/i.test(clean) && afterWake.length > 0;

    let bestCmd: VoiceCommand | null = null;
    let bestPatternLen = 0;

    for (const cmd of this.commands) {
      for (const pattern of cmd.patterns) {
        const lowerPat = pattern.toLowerCase();
        // If user spoke "JARVIS, <actual request>", do not consume the request with a bare wake greeting
        if (hasTrailingRequestAfterWake && wakeOnlyPatterns.has(lowerPat)) {
          continue;
        }
        if (clean.includes(lowerPat) && lowerPat.length > bestPatternLen) {
          bestCmd = cmd;
          bestPatternLen = lowerPat.length;
        }
      }
    }
    return bestCmd;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getSpeechStateSnapshot() {
    return {
      isListening: this.isListening,
      isSpeaking: this.isSpeaking,
      lastError: this.lastError,
      lastTranscript: this.lastVoiceTranscript
    };
  }

  public isSpeechRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const customWindow = window as unknown as IWindowWithSpeech;
    return Boolean(customWindow.SpeechRecognition || customWindow.webkitSpeechRecognition);
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
      utterance.rate = 1.02;
      utterance.pitch = 0.95;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        this.isSpeaking = true;
      };
      utterance.onend = () => {
        this.isSpeaking = false;
        this.lastSpeakEndedAt = Date.now();
        if (onEnd) onEnd();
      };
      utterance.onerror = () => {
        this.isSpeaking = false;
        this.lastSpeakEndedAt = Date.now();
        if (onEnd) onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      this.isSpeaking = false;
      this.lastSpeakEndedAt = Date.now();
      if (onEnd) onEnd();
    }
  }

  public stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.isSpeaking) {
      this.lastSpeakEndedAt = Date.now();
    }
    this.isSpeaking = false;
  }

  public isCurrentlySpeaking(): boolean {
    return this.isSpeaking;
  }

  private formatMicError(err: unknown): string {
    if (err instanceof DOMException) {
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return 'Microphone permission denied. Allow microphone access in browser site settings.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return 'No microphone hardware found. You can still type commands in the Vocal Console.';
        case 'NotReadableError':
        case 'TrackStartError':
          return 'Microphone is busy in another application.';
        case 'SecurityError':
          return 'Microphone access requires HTTPS or localhost.';
        default:
          return `Microphone error (${err.name}): ${err.message}`;
      }
    }
    return 'Unable to access microphone.';
  }

  // Requests real microphone permission via getUserMedia, connects live waveform analyser, and starts SpeechRecognition
  public async startListeningWithPermission(): Promise<VoiceStartResult> {
    this.lastError = null;

    if (permissionPolicy.getCapabilityDecision('MICROPHONE_ACCESS') === 'DENIED') {
      const msg =
        'Microphone Access is disabled in JARVIS Permissions. Enable it in the Permissions tab or Setup Wizard to activate voice recognition.';
      this.lastError = msg;
      this.isListening = false;
      this.onStatusChangeCallback?.(false, msg);
      return {
        started: false,
        micGranted: false,
        recognitionSupported: this.isSpeechRecognitionSupported(),
        error: msg
      };
    }

    if (typeof window === 'undefined') {
      return { started: false, micGranted: false, recognitionSupported: false, error: 'Browser window unavailable.' };
    }

    let micStream: MediaStream | null = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        audioService.connectMicrophoneStream(micStream);
      } catch (err) {
        const msg = this.formatMicError(err);
        this.lastError = msg;
        this.isListening = false;
        this.onStatusChangeCallback?.(false, msg);
        return {
          started: false,
          micGranted: false,
          recognitionSupported: this.isSpeechRecognitionSupported(),
          error: msg
        };
      }
    } else {
      const msg = 'MediaDevices audio API unavailable. Ensure HTTPS or localhost.';
      this.lastError = msg;
      this.onStatusChangeCallback?.(false, msg);
      return {
        started: false,
        micGranted: false,
        recognitionSupported: this.isSpeechRecognitionSupported(),
        error: msg
      };
    }

    const recognitionSupported = this.isSpeechRecognitionSupported();
    if (!recognitionSupported) {
      // Keep mic stream disconnected if speech recognition isn't supported, or allow waveform + console
      audioService.disconnectMicrophoneStream();
      const msg = 'Browser Web Speech Recognition API not supported here (try Chrome/Edge). Use the Vocal Console text input below.';
      this.lastError = msg;
      this.isListening = false;
      this.onStatusChangeCallback?.(false, msg);
      return {
        started: false,
        micGranted: true,
        recognitionSupported: false,
        error: msg
      };
    }

    const started = this.startListening();
    if (!started) {
      audioService.disconnectMicrophoneStream();
      return {
        started: false,
        micGranted: true,
        recognitionSupported: true,
        error: this.lastError || 'Failed to initialize Speech Recognition.'
      };
    }

    return {
      started: true,
      micGranted: true,
      recognitionSupported: true
    };
  }

  public startListening(): boolean {
    const customWindow = window as unknown as IWindowWithSpeech;
    const SpeechRecognitionClass = customWindow.SpeechRecognition || customWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      this.lastError = 'Speech Recognition API not supported in this browser environment.';
      console.warn(this.lastError);
      return false;
    }

    if (this.isListening) return true;

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (this.isSpeaking || Date.now() - this.lastSpeakEndedAt < 350) return;

        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const rawTranscript = lastResult[0].transcript.trim();
          const normalized = rawTranscript.toLowerCase();
          const now = Date.now();
          if (normalized && normalized === this.lastVoiceTranscript && now - this.lastVoiceTranscriptAt < 650) {
            return;
          }
          this.lastVoiceTranscript = normalized;
          this.lastVoiceTranscriptAt = now;
          this.handleTranscript(rawTranscript, 'VOICE');
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Speech recognition status/event:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.lastError = 'Microphone / speech recognition permission denied by browser.';
          this.stopListening();
          this.onStatusChangeCallback?.(false, this.lastError);
        } else if (event.error === 'audio-capture') {
          this.lastError = 'No audio capture device detected.';
          this.stopListening();
          this.onStatusChangeCallback?.(false, this.lastError);
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
          if (this.restartTimeout) clearTimeout(this.restartTimeout);
          this.restartTimeout = window.setTimeout(() => {
            if (this.isListening) {
              try {
                this.recognition?.start();
              } catch {
                // Ignore transient busy states
              }
            }
          }, 150);
        }
      };

      this.recognition.start();
      this.isListening = true;
      this.lastError = null;
      this.onStatusChangeCallback?.(true);
      return true;
    } catch (err) {
      console.warn('Speech recognition unavailable:', err);
      this.lastError = 'Failed to start speech recognition engine.';
      this.isListening = false;
      this.onStatusChangeCallback?.(false, this.lastError);
      return false;
    }
  }

  public stopListening() {
    this.isListening = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    audioService.disconnectMicrophoneStream();
    this.onStatusChangeCallback?.(false);
  }

  public isListeningActive(): boolean {
    return this.isListening;
  }

  public handleTranscript(rawTranscript: string, source: 'VOICE' | 'CONSOLE' = 'CONSOLE') {
    if (!rawTranscript || !rawTranscript.trim()) return;
    const clean = rawTranscript.toLowerCase().replace(/[.,!?;:]/g, '');

    if (clean === 'stop speaking' || clean === 'cancel request' || clean === 'stop thinking') {
      this.interruptAndCancel();
    }

    if (this.onMessageCallback) {
      this.onMessageCallback({
        id: Math.random().toString(36).substring(7),
        sender: 'USER',
        text: rawTranscript,
        timestamp: new Date().toLocaleTimeString(),
        type: 'COMMAND'
      });
    }

    const bestCmd = this.findMatchingCommand(rawTranscript);

    if (bestCmd) {
      const emitOutcome = (ok: boolean) => {
        if (ok) {
          this.onCommandExecutedCallback?.(bestCmd, rawTranscript);
        }
        const responseText = ok
          ? bestCmd.feedbackText
          : bestCmd.failureText || 'Unable to execute that command under current conditions, sir.';
        if (this.onMessageCallback) {
          this.onMessageCallback({
            id: Math.random().toString(36).substring(7),
            sender: 'JARVIS',
            text: responseText,
            timestamp: new Date().toLocaleTimeString(),
            type: ok ? 'RESPONSE' : 'ALERT'
          });
        }
        this.speak(responseText);
      };

      try {
        const result = bestCmd.action(clean);
        if (result instanceof Promise) {
          void result
            .then((resolved) => emitOutcome(resolved !== false))
            .catch(() => emitOutcome(false));
        } else {
          emitOutcome(result !== false);
        }
      } catch {
        emitOutcome(false);
      }
      return;
    }

    const emitFallback = (replyText: string) => {
      if (this.onMessageCallback) {
        this.onMessageCallback({
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: replyText,
          timestamp: new Date().toLocaleTimeString(),
          type: 'RESPONSE'
        });
      }
      this.speak(replyText);
    };

    const getBuiltinFallback = (): string => {
      let fallback = "I heard you, sir, but that command is not recognized in current security protocols.";
      if (clean.includes('hello') || clean.includes('hey jarvis') || clean.includes('jarvis')) {
        fallback = "Good day, sir. Systems are at your disposal.";
      } else if (clean.includes('who are you') || clean.includes('what are you')) {
        fallback = "I am JARVIS: Just A Rather Very Intelligent System. Operating Stark Industries holographic laboratory interface.";
      } else if (clean.includes('thank')) {
        fallback = "At your service, sir. Always a pleasure.";
      }
      return fallback;
    };

    if (this.unmatchedTranscriptHandler) {
      try {
        const handled = this.unmatchedTranscriptHandler(rawTranscript, source);
        if (handled instanceof Promise) {
          void handled
            .then((reply) => emitFallback(reply && reply.trim() ? reply : getBuiltinFallback()))
            .catch(() => emitFallback(getBuiltinFallback()));
        } else {
          emitFallback(handled && handled.trim() ? handled : getBuiltinFallback());
        }
        return;
      } catch {
        // fall through to built-in fallback
      }
    }

    emitFallback(getBuiltinFallback());
  }
}

export const speechService = new SpeechService();
