import { describe, it, expect, vi, afterEach } from 'vitest';
import { speechService } from '../src/services/speechService';
import { ContextualAIService } from '../src/services/contextualAI';
import { VoiceCommand } from '../src/types/assistant';

describe('SpeechService Voice Command Engine', () => {
  afterEach(() => {
    speechService.setUnmatchedTranscriptHandler(null);
    vi.restoreAllMocks();
  });

  it('matches recognized voice commands and prioritizes longest specific patterns', () => {
    let executedAction = '';

    const testCommands: VoiceCommand[] = [
      {
        patterns: ['hello jarvis', 'hey jarvis', 'jarvis'],
        description: 'Greeting',
        category: 'SYSTEM',
        action: () => { executedAction = 'GREETING'; },
        feedbackText: 'Good evening, sir.'
      },
      {
        patterns: ['open holographic workspace'],
        description: 'Workspace',
        category: 'NAVIGATION',
        action: () => { executedAction = 'WORKSPACE'; },
        feedbackText: 'Opening holographic workspace.'
      },
      {
        patterns: ['show me the vehicle', 'show vehicle'],
        description: 'Load Vehicle',
        category: 'NAVIGATION',
        action: () => { executedAction = 'VEHICLE'; },
        feedbackText: 'Projecting hypercar chassis.'
      },
      {
        patterns: ['rotate it 360 degrees', 'rotate 360'],
        description: 'Rotate 360',
        category: 'MANIPULATION',
        action: () => { executedAction = 'ROTATE_360'; },
        feedbackText: 'Executing 360-degree rotation.'
      },
      {
        patterns: ['rotate the object', 'rotate object'],
        description: 'Rotation',
        category: 'MANIPULATION',
        action: () => { executedAction = 'ROTATE'; },
        feedbackText: 'Rotating object.'
      },
      {
        patterns: ['explode the model', 'show internal components'],
        description: 'Explode Model',
        category: 'MANIPULATION',
        action: () => { executedAction = 'EXPLODE'; },
        feedbackText: 'Expanding assembly layers.'
      },
      {
        patterns: ['disintegrate'],
        description: 'Disintegrate',
        category: 'CINEMATIC',
        action: () => { executedAction = 'DISINTEGRATE'; },
        feedbackText: 'Disintegrating active hologram.'
      },
      {
        patterns: ['reconstruct the object', 'reconstruct'],
        description: 'Reconstruct',
        category: 'MANIPULATION',
        action: () => { executedAction = 'RECONSTRUCT'; },
        feedbackText: 'Reconstructing model.'
      },
      {
        patterns: ['return to normal view'],
        description: 'Normal View',
        category: 'NAVIGATION',
        action: () => { executedAction = 'NORMAL_VIEW'; },
        feedbackText: 'Restoring normal assembled view.'
      },
      {
        patterns: ['activate diagnostics'],
        description: 'Diagnostics',
        category: 'AUTOMATION',
        action: () => { executedAction = 'DIAGNOSTICS'; },
        feedbackText: 'Activating diagnostics.'
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

    speechService.handleTranscript('Hello JARVIS');
    expect(executedAction).toBe('GREETING');

    // Compound wake word + specific command must resolve to the longer command
    speechService.handleTranscript('JARVIS, open holographic workspace');
    expect(executedAction).toBe('WORKSPACE');

    speechService.handleTranscript('Hey JARVIS, show me the vehicle');
    expect(executedAction).toBe('VEHICLE');

    speechService.handleTranscript('Can you rotate the object please');
    expect(executedAction).toBe('ROTATE');

    speechService.handleTranscript('Rotate it 360 degrees');
    expect(executedAction).toBe('ROTATE_360');

    speechService.handleTranscript('Explode the model');
    expect(executedAction).toBe('EXPLODE');

    speechService.handleTranscript('Disintegrate');
    expect(executedAction).toBe('DISINTEGRATE');

    speechService.handleTranscript('Reconstruct the object');
    expect(executedAction).toBe('RECONSTRUCT');

    speechService.handleTranscript('Return to normal view');
    expect(executedAction).toBe('NORMAL_VIEW');

    speechService.handleTranscript('Activate diagnostics');
    expect(executedAction).toBe('DIAGNOSTICS');

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

  it('recognizes VISION 1.2 interface, directional rotation, dispersion, laboratory, and diagnostics commands', () => {
    let executed = '';
    speechService.registerCommands([
      { patterns: ['jarvis'], description: 'Wake', category: 'SYSTEM', action: () => { executed = 'WAKE'; }, feedbackText: 'Yes sir.' },
      { patterns: ['jarvis activate vision', 'activate vision'], description: 'Vision', category: 'NAVIGATION', action: () => { executed = 'VISION'; }, feedbackText: 'Vision active.' },
      { patterns: ['rotate the interface'], description: 'Rotate', category: 'MANIPULATION', action: () => { executed = 'ROTATE_IFACE'; }, feedbackText: 'Rotating.' },
      { patterns: ['turn right'], description: 'Turn right', category: 'MANIPULATION', action: () => { executed = 'RIGHT'; }, feedbackText: 'Right.' },
      { patterns: ['turn left'], description: 'Turn left', category: 'MANIPULATION', action: () => { executed = 'LEFT'; }, feedbackText: 'Left.' },
      { patterns: ['increase dispersion'], description: 'Increase dispersion', category: 'CINEMATIC', action: () => { executed = 'INC_DISP'; }, feedbackText: 'Increasing dispersion.' },
      { patterns: ['disperse the sphere'], description: 'Disperse', category: 'CINEMATIC', action: () => { executed = 'DISPERSE'; }, feedbackText: 'Dispersing.' },
      { patterns: ['reconstruct the interface'], description: 'Reconstruct', category: 'MANIPULATION', action: () => { executed = 'RECON_IFACE'; }, feedbackText: 'Reconstructing.' },
      { patterns: ['return to normal'], description: 'Normal', category: 'NAVIGATION', action: () => { executed = 'NORMAL'; }, feedbackText: 'Normal view.' },
      { patterns: ['open the object laboratory'], description: 'Lab', category: 'NAVIGATION', action: () => { executed = 'LAB'; }, feedbackText: 'Lab open.' },
      { patterns: ['show diagnostics'], description: 'Diagnostics', category: 'NAVIGATION', action: () => { executed = 'DIAG'; }, feedbackText: 'Diagnostics.' },
      { patterns: ['reset hologram'], description: 'Reset', category: 'MANIPULATION', action: () => { executed = 'RESET'; }, feedbackText: 'Reset.' }
    ]);

    const pairs: [string, string][] = [
      ['JARVIS, activate Vision', 'VISION'],
      ['Rotate the interface', 'ROTATE_IFACE'],
      ['Turn right', 'RIGHT'],
      ['Turn left', 'LEFT'],
      ['Increase dispersion', 'INC_DISP'],
      ['Disperse the sphere', 'DISPERSE'],
      ['Reconstruct the interface', 'RECON_IFACE'],
      ['Return to normal', 'NORMAL'],
      ['Open the object laboratory', 'LAB'],
      ['Show diagnostics', 'DIAG'],
      ['Reset hologram', 'RESET']
    ];

    for (const [phrase, expected] of pairs) {
      speechService.handleTranscript(phrase);
      expect(executed).toBe(expected);
    }
  });

  it('reports failure ALERT instead of falsely claiming success when a command action returns false', () => {
    const logged: { text: string; type?: string }[] = [];
    speechService.setMessageCallback((msg) => {
      if (msg.sender === 'JARVIS') logged.push({ text: msg.text, type: msg.type });
    });

    speechService.registerCommands([
      {
        patterns: ['capture optical scan'],
        description: 'Optical scan',
        category: 'MANIPULATION',
        action: () => false,
        feedbackText: 'Optical scan captured successfully.',
        failureText: 'Optical sensor is offline. Enable the camera first.'
      }
    ]);

    speechService.handleTranscript('capture optical scan');
    expect(logged.length).toBe(1);
    expect(logged[0].type).toBe('ALERT');
    expect(logged[0].text).toBe('Optical sensor is offline. Enable the camera first.');
  });

  it('prioritizes local voice commands before falling back to external AI or local intent', async () => {
    const ai = new ContextualAIService();
    ai.saveConfig({ provider: 'OPENAI', apiKey: 'sk-volatile-test', modelName: 'gpt-4o-mini' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Titanium alloy recommended, sir.' } }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    let exploded = false;
    const replies: string[] = [];
    speechService.setMessageCallback((msg) => {
      if (msg.sender === 'JARVIS') replies.push(msg.text);
    });
    speechService.registerCommands([
      {
        patterns: ['explode the model'],
        description: 'Explode model',
        category: 'MANIPULATION',
        action: () => { exploded = true; return true; },
        feedbackText: 'Expanding assembly layers.'
      }
    ]);
    speechService.setUnmatchedTranscriptHandler(async (transcript) => ai.queryExternalAI(transcript));

    // Matched local command runs locally without calling external LLM API
    speechService.handleTranscript('Explode the model');
    expect(exploded).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    // Unmatched conversational question routes to external AI & logs assistant turn
    speechService.handleTranscript('What alloy best resists arc thermal stress?');
    await new Promise((r) => setTimeout(r, 15));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replies[replies.length - 1]).toBe('Titanium alloy recommended, sir.');
    expect(ai.getHistory().some((m) => m.role === 'assistant' && m.content.includes('Titanium'))).toBe(true);
    ai.clearApiKey();
  });

  it('supports Gemini and Anthropic external AI endpoints while keeping API keys in volatile RAM only', async () => {
    const ai = new ContextualAIService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Gemini analysis online, sir.' }] } }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Claude analysis complete, sir.' }]
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    ai.saveConfig({ provider: 'GEMINI', apiKey: 'AIza-volatile-test', modelName: 'gemini-2.5-flash' });
    const geminiReply = await ai.queryExternalAI('Evaluate containment stability');
    expect(geminiReply).toBe('Gemini analysis online, sir.');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({ method: 'POST' })
    );

    ai.saveConfig({ provider: 'ANTHROPIC', apiKey: 'sk-ant-volatile-test', modelName: 'claude-3-5-sonnet-latest' });
    const claudeReply = await ai.queryExternalAI('Summarize orbital diagnostics');
    expect(claudeReply).toBe('Claude analysis complete, sir.');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' })
    );

    ai.clearApiKey();
  });
});
