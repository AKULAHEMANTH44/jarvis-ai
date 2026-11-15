import { describe, it, expect, vi } from 'vitest';
import { speechService } from '../src/services/speechService';
import { VoiceCommand } from '../src/types/assistant';

describe('SpeechService Voice Command Engine', () => {
  it('matches recognized voice commands and executes actions', () => {
    let executedAction = '';

    const testCommands: VoiceCommand[] = [
      {
        patterns: ['hello jarvis', 'hey jarvis'],
        description: 'Greeting',
        category: 'SYSTEM',
        action: () => { executedAction = 'GREETING'; },
        feedbackText: 'Good evening, sir.'
      },
      {
        patterns: ['rotate the object', 'rotate object'],
        description: 'Rotation',
        category: 'MANIPULATION',
        action: () => { executedAction = 'ROTATE'; },
        feedbackText: 'Rotating object.'
      },
      {
        patterns: ['trigger shockwave', 'cinematic pulse'],
        description: 'Shockwave',
        category: 'CINEMATIC',
        action: () => { executedAction = 'SHOCKWAVE'; },
        feedbackText: 'Discharging shockwave.'
      }
    ];

    speechService.registerCommands(testCommands);

    // Test 1: User says "Hello JARVIS"
    speechService.handleTranscript('Hello JARVIS');
    expect(executedAction).toBe('GREETING');

    // Test 2: User says "Can you rotate the object please"
    speechService.handleTranscript('Can you rotate the object please');
    expect(executedAction).toBe('ROTATE');

    // Test 3: User says "trigger shockwave now"
    speechService.handleTranscript('trigger shockwave now');
    expect(executedAction).toBe('SHOCKWAVE');
  });

  it('notifies message callbacks for user and jarvis utterances', () => {
    const receivedMessages: string[] = [];
    speechService.setMessageCallback((msg) => {
      receivedMessages.push(`${msg.sender}: ${msg.text}`);
    });

    speechService.handleTranscript('hello jarvis');
    expect(receivedMessages.length).toBe(2);
    expect(receivedMessages[0]).toContain('USER: hello jarvis');
    expect(receivedMessages[1]).toContain('JARVIS: Good evening, sir.');
  });
});
