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
  const abortController = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  req.on('aborted', onClose);
  res.on('close', onClose);

  try {
    const chatRequest: LLMChatRequest = req.body || {};
    const result = await llmService.chat(chatRequest, abortController.signal);
    if (res.writableEnded) return;
    const statusCode = result.ok ? 200 : result.error?.includes('Neither') ? 503 : 502;
    res.status(statusCode).json(result);
  } catch (err: unknown) {
    if (res.writableEnded) return;
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
  } finally {
    req.off('aborted', onClose);
    res.off('close', onClose);
  }
});

apiRouter.post('/llm/chat/stream', async (req: Request, res: Response) => {
  const abortController = new AbortController();
  let clientClosed = false;
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  };
  req.on('aborted', onClose);
  res.on('close', onClose);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeEvent = (ev: unknown) => {
    if (clientClosed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      clientClosed = true;
      abortController.abort();
    }
  };

  try {
    const chatRequest: LLMChatRequest = req.body || {};
    await llmService.chatStream(chatRequest, writeEvent, abortController.signal);
  } catch (err: unknown) {
    if (!clientClosed && !res.writableEnded) {
      const message = err instanceof Error ? err.message : String(err);
      writeEvent({
        type: 'error',
        provider: 'NONE',
        mode: req.body?.mode || 'AUTO',
        error: `Server internal LLM streaming exception: ${message}`
      });
    }
  } finally {
    req.off('aborted', onClose);
    res.off('close', onClose);
    if (!res.writableEnded) {
      res.end();
    }
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

apiRouter.post('/desktop/paths/revoke', (req: Request, res: Response) => {
  const { path: rawPath } = req.body || {};
  if (!rawPath || typeof rawPath !== 'string') {
    res.status(400).json({ ok: false, error: 'MISSING_PATH' });
    return;
  }
  const revoked = desktopAutomationService.revokeApprovedPath(rawPath);
  res.json(revoked);
});

apiRouter.get('/desktop/permissions', (_req: Request, res: Response) => {
  res.json({ ok: true, config: desktopAutomationService.getPermissionPolicy() });
});

apiRouter.post('/desktop/permissions', (req: Request, res: Response) => {
  const updated = desktopAutomationService.updatePermissionPolicy(req.body);
  res.json({ ok: true, config: updated });
});

apiRouter.post('/desktop/permissions/reset', (req: Request, res: Response) => {
  const clearSetupCompleted = Boolean(req.body?.clearSetupCompleted);
  const reset = desktopAutomationService.resetPermissionPolicy(clearSetupCompleted);
  res.json({ ok: true, config: reset });
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

// Discover installed applications
apiRouter.get('/desktop/apps/discover', async (_req: Request, res: Response) => {
  try {
    const apps = await desktopAutomationService.discoverApplications();
    res.json({ ok: true, applications: apps });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// List files and directories with metadata
apiRouter.post('/desktop/folder/list', (req: Request, res: Response) => {
  const { folderPath } = req.body || {};
  if (!folderPath) {
    res.status(400).json({ ok: false, summary: 'Missing folderPath.', error: 'MISSING_FOLDER_PATH' });
    return;
  }
  const result = desktopAutomationService.listApprovedFolder(String(folderPath));
  res.status(result.ok ? 200 : 400).json(result);
});

// Read safe text or document content
apiRouter.post('/desktop/file/read', (req: Request, res: Response) => {
  const { filePath } = req.body || {};
  if (!filePath) {
    res.status(400).json({ ok: false, summary: 'Missing filePath.', error: 'MISSING_FILE_PATH' });
    return;
  }
  const result = desktopAutomationService.readApprovedFile(String(filePath));
  res.status(result.ok ? 200 : 400).json(result);
});

// Create text file with approval
apiRouter.post('/desktop/file/create', (req: Request, res: Response) => {
  const { filePath, content, overwrite } = req.body || {};
  if (!filePath) {
    res.status(400).json({ ok: false, summary: 'Missing filePath.', error: 'MISSING_FILE_PATH' });
    return;
  }
  const result = desktopAutomationService.createApprovedFile(
    String(filePath),
    typeof content === 'string' ? content : '',
    Boolean(overwrite)
  );
  res.status(result.ok ? 200 : 400).json(result);
});

// Inspect web page title and description
apiRouter.post('/desktop/browser/inspect', async (req: Request, res: Response) => {
  const { url } = req.body || {};
  if (!url) {
    res.status(400).json({ ok: false, error: 'MISSING_URL' });
    return;
  }
  const result = await desktopAutomationService.inspectWebPage(String(url));
  res.status(result.ok ? 200 : 400).json(result);
});

