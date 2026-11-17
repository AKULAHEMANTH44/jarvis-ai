import { Router, Request, Response } from 'express';
import { llmService } from './llmService.js';
import { LLMChatRequest, LLMMode } from './types.js';
import { desktopAutomationService } from './desktopAutomation.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'jarvis-ai-brain-backend',
    phase: 7,
    timestamp: Date.now()
  });
});

apiRouter.post('/llm/chat', async (req: Request, res: Response) => {
  try {
    const chatRequest: LLMChatRequest = req.body || {};
    const result = await llmService.chat(chatRequest);
    const statusCode = result.ok ? 200 : result.error?.includes('Neither') ? 503 : 502;
    res.status(statusCode).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      ok: false,
      text: '',
      provider: 'NONE',
      model: 'unknown',
      mode: req.body?.mode || 'AUTO',
      fallbackTriggered: false,
      error: `Server internal LLM routing exception: ${message}`,
      durationMs: 0
    });
  }
});

apiRouter.get('/llm/status', async (req: Request, res: Response) => {
  try {
    const mode = (req.query.mode as LLMMode) || undefined;
    const status = await llmService.getStatus(mode);
    res.json(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      ok: false,
      error: `Failed to retrieve LLM status: ${message}`
    });
  }
});

apiRouter.post('/llm/mode', (req: Request, res: Response) => {
  const { mode } = req.body || {};
  if (mode === 'AUTO' || mode === 'GEMINI_ONLY' || mode === 'GROQ_ONLY') {
    llmService.setDefaultMode(mode);
    res.json({ ok: true, currentMode: llmService.getDefaultMode() });
  } else {
    res.status(400).json({
      ok: false,
      error: 'Invalid mode. Supported modes: AUTO | GEMINI_ONLY | GROQ_ONLY'
    });
  }
});

// =============================================================================
// Phase 7 — Windows Desktop Automation Endpoints
// =============================================================================

// List approved applications
apiRouter.get('/desktop/apps', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    applications: desktopAutomationService.getAllowedApplications().map((app) => ({
      id: app.id,
      displayName: app.displayName,
      description: app.description,
      category: app.category || 'APP'
    }))
  });
});

// Register a user-selected/approved folder or file path
apiRouter.post('/desktop/paths/approve', (req: Request, res: Response) => {
  const { path: rawPath } = req.body || {};
  if (!rawPath || typeof rawPath !== 'string') {
    res.status(400).json({ ok: false, error: 'MISSING_PATH' });
    return;
  }
  const approved = desktopAutomationService.approvePath(rawPath);
  res.status(approved.ok ? 200 : 400).json(approved);
});

apiRouter.get('/desktop/paths', (_req: Request, res: Response) => {
  res.json({ ok: true, approvedPaths: desktopAutomationService.getApprovedPaths() });
});

apiRouter.get('/desktop/audit', (_req: Request, res: Response) => {
  res.json({ ok: true, auditLog: desktopAutomationService.getAuditLog(40) });
});

// Launch approved application
apiRouter.post('/desktop/launch', async (req: Request, res: Response) => {
  const { applicationId, args } = req.body || {};
  if (!applicationId) {
    res.status(400).json({
      ok: false,
      summary: 'Missing applicationId in request body.',
      error: 'MISSING_APPLICATION_ID'
    });
    return;
  }

  const result = await desktopAutomationService.launchApprovedApplication(
    String(applicationId),
    Array.isArray(args) ? args : []
  );
  res.status(result.ok ? 200 : 403).json(result);
});

// Open approved file
apiRouter.post('/desktop/file/open', async (req: Request, res: Response) => {
  const { filePath } = req.body || {};
  if (!filePath) {
    res.status(400).json({
      ok: false,
      summary: 'Missing filePath in request body.',
      error: 'MISSING_FILE_PATH'
    });
    return;
  }

  const result = await desktopAutomationService.openApprovedFile(String(filePath));
  res.status(result.ok ? 200 : 403).json(result);
});

// Open approved folder
apiRouter.post('/desktop/folder/open', async (req: Request, res: Response) => {
  const { folderPath } = req.body || {};
  if (!folderPath) {
    res.status(400).json({
      ok: false,
      summary: 'Missing folderPath in request body.',
      error: 'MISSING_FOLDER_PATH'
    });
    return;
  }

  const result = await desktopAutomationService.openApprovedFolder(String(folderPath));
  res.status(result.ok ? 200 : 403).json(result);
});

// Open default browser
apiRouter.post('/desktop/browser/open', async (req: Request, res: Response) => {
  const { url } = req.body || {};
  const result = await desktopAutomationService.openApprovedBrowser(url ? String(url) : undefined);
  res.status(result.ok ? 200 : 400).json(result);
});

// Search web in browser
apiRouter.post('/desktop/search', async (req: Request, res: Response) => {
  const { query, engine } = req.body || {};
  const result = await desktopAutomationService.searchWeb(
    String(query || ''),
    engine ? String(engine) : 'google'
  );
  res.status(result.ok ? 200 : 400).json(result);
});

// Launch music app
apiRouter.post('/desktop/music', async (req: Request, res: Response) => {
  const { musicTarget } = req.body || {};
  const result = await desktopAutomationService.launchMusicApp(
    musicTarget ? String(musicTarget) : 'SPOTIFY'
  );
  res.status(result.ok ? 200 : 403).json(result);
});

// Find files in folder
apiRouter.post('/desktop/folder/find', (req: Request, res: Response) => {
  const { folderPath, filterPattern } = req.body || {};
  if (!folderPath) {
    res.status(400).json({
      ok: false,
      summary: 'Missing folderPath in request body.',
      error: 'MISSING_FOLDER_PATH'
    });
    return;
  }

  const result = desktopAutomationService.findFilesInFolder(
    String(folderPath),
    filterPattern ? String(filterPattern) : undefined
  );
  res.status(result.ok ? 200 : 400).json(result);
});

