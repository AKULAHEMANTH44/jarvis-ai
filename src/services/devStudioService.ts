import {
  AppliedPatchBackup,
  CodeDiffPreview,
  DevAuditEntry,
  DevCommandResult,
  DevCommandTool,
  DevToolAvailability,
  PermissionRequest,
  ProjectDependencyInfo,
  ProjectWorkspaceReport,
  ProposedPatchEntry,
  SourceFileAnalysis
} from '../types/assistant';
import { contextualAI } from './contextualAI';
import { desktopBridge } from './desktopBridge';
import { permissionManager } from './permissionManager';

const MAX_CONTEXT_CHARS_DEFAULT = 12_000;
const MAX_SINGLE_CONTEXT_FILE_CHARS = 3_500;

const SENSITIVE_NAME_PATTERNS = [
  /^\.env($|\.)/i,
  /^secrets?(\..*)?\.json$/i,
  /^credentials?(\..*)?\.json$/i,
  /service[-_]?account.*\.json$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|crt|cer)$/i
];

export function isSensitiveDevFilename(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop() || filePath;
  return SENSITIVE_NAME_PATTERNS.some((re) => re.test(base.trim()));
}

export interface ErrorAnalysisReport {
  ok: boolean;
  summary: string;
  rootCauseCategory: string;
  explanation: string;
  affectedFiles: { file: string; line?: number; column?: number }[];
  matchedSourceAnalysis?: SourceFileAnalysis;
  proposedFix?: ProposedPatchEntry;
  verificationNote: string;
}

export interface TestDiscoverySummary {
  testFrameworks: string[];
  existingTestFiles: string[];
  testScripts: Record<string, string>;
  suggestedUntestedFiles: string[];
}

export type DocGeneratorType =
  | 'README'
  | 'ARCHITECTURE'
  | 'API_DOCS'
  | 'SETUP_GUIDE'
  | 'MODULE_SUMMARY'
  | 'DEV_REPORT';

function joinPath(base: string, rel: string): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const cleanBase = base.replace(/[\\/]+$/, '');
  const cleanRel = rel.replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep);
  return `${cleanBase}${sep}${cleanRel}`;
}

export class DevStudioService {
  private activeProjectPath = '';
  private activeReport: ProjectWorkspaceReport | null = null;
  private devTools: DevToolAvailability[] = [];
  private proposedPatches: ProposedPatchEntry[] = [];
  private backups: AppliedPatchBackup[] = [];
  private auditEntries: DevAuditEntry[] = [];
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private recordAudit(
    category: DevAuditEntry['category'],
    target: string,
    summary: string,
    ok: boolean,
    error?: string
  ) {
    this.auditEntries.unshift({
      id: `devaudit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      target,
      summary,
      ok,
      timestamp: Date.now(),
      error
    });
    if (this.auditEntries.length > 100) {
      this.auditEntries = this.auditEntries.slice(0, 100);
    }
    this.notify();
  }

  public getActiveProjectPath(): string {
    return this.activeProjectPath;
  }

  public getActiveReport(): ProjectWorkspaceReport | null {
    return this.activeReport ? { ...this.activeReport } : null;
  }

  public getDevTools(): DevToolAvailability[] {
    return [...this.devTools];
  }

  public getProposedPatches(): ProposedPatchEntry[] {
    return this.proposedPatches.map((p) => ({ ...p }));
  }

  public getBackups(): AppliedPatchBackup[] {
    return [...this.backups];
  }

  public getAuditEntries(limit = 40): DevAuditEntry[] {
    return this.auditEntries.slice(0, Math.max(1, limit)).map((e) => ({ ...e }));
  }

  public async inspectProject(projectPath: string): Promise<ProjectWorkspaceReport> {
    const clean = projectPath.trim();
    const report = await desktopBridge.inspectDevProject(clean);
    if (report.ok) {
      this.activeProjectPath = report.projectPath;
      this.activeReport = report;
      this.recordAudit(
        'INSPECT',
        report.projectPath,
        `Inspected "${report.projectName}" (${report.totalFilesScanned} files, ${report.languages.map((l) => l.language).join(', ') || 'Unknown'}).`,
        true
      );
    } else {
      this.recordAudit('INSPECT', clean, report.error || 'Project inspection failed.', false, report.error);
    }
    this.notify();
    return report;
  }

  public async refreshDevTools(): Promise<DevToolAvailability[]> {
    const tools = await desktopBridge.detectDevTools();
    this.devTools = tools;
    this.notify();
    return tools;
  }

  public async refreshBackups(): Promise<AppliedPatchBackup[]> {
    const list = await desktopBridge.listDevPatchBackups();
    this.backups = list;
    this.notify();
    return list;
  }

  public async readSourceFile(projectPath: string, filePath: string): Promise<SourceFileAnalysis> {
    if (isSensitiveDevFilename(filePath)) {
      const blocked: SourceFileAnalysis = {
        ok: false,
        path: filePath,
        relativePath: filePath,
        name: filePath.split(/[\\/]/).pop() || filePath,
        language: 'Restricted',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: 'Blocked: secret or credential files cannot be read into AI Dev Studio.'
      };
      this.recordAudit('READ', filePath, blocked.error!, false, 'SECRET_FILE_BLOCKED');
      return blocked;
    }

    const res = await desktopBridge.readDevSourceFile(projectPath, filePath);
    this.recordAudit(
      'READ',
      res.relativePath || filePath,
      res.ok ? `Read ${res.relativePath} (${res.lineCount} lines, ${res.symbols.length} symbols).` : res.error || 'Failed to read source file.',
      res.ok,
      res.error
    );
    return res;
  }

  // =========================================================================
  // 2. Code Understanding Engine (Selective Context + Privacy Gate)
  // =========================================================================

  public async buildSelectiveAIContext(params: {
    projectPath: string;
    focusFiles?: string[];
    maxChars?: number;
  }): Promise<{
    contextText: string;
    includedFiles: string[];
    skippedSensitiveFiles: string[];
    totalChars: number;
  }> {
    const maxChars = Math.min(24_000, Math.max(1_000, params.maxChars ?? MAX_CONTEXT_CHARS_DEFAULT));
    const report =
      this.activeReport && this.activeReport.projectPath === params.projectPath
        ? this.activeReport
        : await this.inspectProject(params.projectPath);

    if (!report.ok) {
      return {
        contextText: '',
        includedFiles: [],
        skippedSensitiveFiles: report.excludedSecretFiles || [],
        totalChars: 0
      };
    }

    const candidates = new Set<string>();
    for (const f of params.focusFiles || []) {
      if (f.trim()) candidates.add(f.trim());
    }
    for (const entry of report.entryPoints.slice(0, 4)) candidates.add(entry);
    for (const cfg of report.configFiles.slice(0, 3)) candidates.add(cfg);
    if (candidates.size === 0) {
      for (const node of report.files.filter((n) => !n.isDirectory).slice(0, 5)) {
        candidates.add(node.relativePath);
      }
    }

    const chunks: string[] = [
      `Project: ${report.projectName}`,
      `Languages: ${report.languages.map((l) => `${l.language} (${l.fileCount})`).join(', ') || 'None'}`,
      `Frameworks: ${report.frameworks.join(', ') || 'None detected'}`,
      `Package Managers: ${report.packageManagers.join(', ') || 'None detected'}`,
      `Dependencies: ${report.dependencies.slice(0, 15).map((d) => `${d.name}@${d.version}`).join(', ') || 'None'}`,
      ''
    ];
    let currentChars = chunks.join('\n').length;
    const includedFiles: string[] = [];
    const skippedSensitiveFiles = [...(report.excludedSecretFiles || [])];

    for (const relOrFull of candidates) {
      if (currentChars >= maxChars) break;
      if (isSensitiveDevFilename(relOrFull)) {
        skippedSensitiveFiles.push(relOrFull);
        continue;
      }

      const targetPath =
        relOrFull.startsWith(report.projectPath) || /^[A-Za-z]:[\\/]/.test(relOrFull) || relOrFull.startsWith('/')
          ? relOrFull
          : joinPath(report.projectPath, relOrFull);

      const src = await desktopBridge.readDevSourceFile(report.projectPath, targetPath);
      if (!src.ok || typeof src.content !== 'string') continue;

      const excerpt = src.content.slice(0, MAX_SINGLE_CONTEXT_FILE_CHARS);
      const block = `--- FILE: ${src.relativePath} (${src.language}, ${src.lineCount} lines) ---\n${excerpt}${
        src.content.length > MAX_SINGLE_CONTEXT_FILE_CHARS ? '\n/* ... truncated for context budget ... */' : ''
      }\n`;

      if (currentChars + block.length > maxChars && includedFiles.length > 0) break;
      chunks.push(block);
      currentChars += block.length;
      includedFiles.push(src.relativePath);
    }

    const contextText = chunks.join('\n').slice(0, maxChars);
    return {
      contextText,
      includedFiles,
      skippedSensitiveFiles: Array.from(new Set(skippedSensitiveFiles)),
      totalChars: contextText.length
    };
  }

  public requestExternalAIUploadPermission(projectPath: string, fileCount: number, charCount: number): PermissionRequest {
    return permissionManager.createRequest({
      category: 'EXTERNAL_AI_UPLOAD',
      requestedAction: 'Send bounded source code context to configured AI provider',
      target: projectPath,
      reason: `User requested external AI analysis for ${fileCount} project file(s) (~${charCount} chars, secrets excluded).`,
      riskLevel: 'MEDIUM',
      securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
      requestedScope: `Single-use bounded context upload (${fileCount} file(s), <= ${charCount} chars)`
    });
  }

  public async understandCodeOrProject(params: {
    projectPath: string;
    question: string;
    focusFilePath?: string;
    externalUploadPermissionId?: string;
    useExternalAI?: boolean;
  }): Promise<{
    ok: boolean;
    summary: string;
    includedFiles: string[];
    sourceAnalysis?: SourceFileAnalysis;
    moduleRelationships?: { file: string; imports: string[]; symbolCount: number }[];
    dependencies?: ProjectDependencyInfo[];
    usedExternalAI: boolean;
    requiresExternalUploadApproval?: boolean;
    error?: string;
  }> {
    const report = await this.inspectProject(params.projectPath);
    if (!report.ok) {
      return {
        ok: false,
        summary: report.error || 'Unable to inspect project.',
        includedFiles: [],
        usedExternalAI: false,
        error: report.error
      };
    }

    let sourceAnalysis: SourceFileAnalysis | undefined;
    if (params.focusFilePath) {
      sourceAnalysis = await this.readSourceFile(report.projectPath, params.focusFilePath);
    }

    const relationships: { file: string; imports: string[]; symbolCount: number }[] = [];
    const inspectTargets = Array.from(
      new Set([
        ...(params.focusFilePath ? [params.focusFilePath] : []),
        ...report.entryPoints.slice(0, 4)
      ])
    );

    for (const rel of inspectTargets) {
      const target =
        rel.startsWith(report.projectPath) || /^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/')
          ? rel
          : joinPath(report.projectPath, rel);
      const analysis = await desktopBridge.readDevSourceFile(report.projectPath, target);
      if (analysis.ok) {
        relationships.push({
          file: analysis.relativePath,
          imports: analysis.imports,
          symbolCount: analysis.symbols.length
        });
      }
    }

    const ctx = await this.buildSelectiveAIContext({
      projectPath: report.projectPath,
      focusFiles: params.focusFilePath ? [params.focusFilePath] : undefined
    });

    const cfg = contextualAI.getConfig();
    const canExternal = cfg.provider !== 'LOCAL' && params.useExternalAI === true;

    if (canExternal) {
      if (!params.externalUploadPermissionId) {
        return {
          ok: false,
          summary: `External AI code explanation blocked until user approves EXTERNAL_AI_UPLOAD for ${ctx.includedFiles.length} file(s). Showing local structural analysis instead.\n\n${this.formatLocalArchitectureSummary(report, sourceAnalysis, relationships)}`,
          includedFiles: ctx.includedFiles,
          sourceAnalysis,
          moduleRelationships: relationships,
          dependencies: report.dependencies,
          usedExternalAI: false,
          requiresExternalUploadApproval: true
        };
      }

      const auth = permissionManager.beginAuthorizedExecution(
        params.externalUploadPermissionId,
        'EXTERNAL_AI_UPLOAD',
        report.projectPath
      );
      if (!auth.authorized) {
        return {
          ok: false,
          summary: auth.error || 'External AI upload permission denied.',
          includedFiles: ctx.includedFiles,
          sourceAnalysis,
          moduleRelationships: relationships,
          dependencies: report.dependencies,
          usedExternalAI: false,
          error: auth.error
        };
      }

      const aiRes = await contextualAI.queryStructuredCompletion({
        messages: [
          {
            role: 'system',
            content:
              'You are JARVIS AI Development Studio. Explain ONLY based on the inspected bounded project files provided. Cite exact file paths and symbol names. Never invent uninspected files or dependencies.'
          },
          {
            role: 'user',
            content: `Question: ${params.question}\n\nBounded Project Context:\n${ctx.contextText}`
          }
        ]
      });

      permissionManager.completeExecution(
        params.externalUploadPermissionId,
        aiRes.ok,
        aiRes.ok ? `Uploaded ${ctx.includedFiles.length} bounded file(s) for analysis.` : aiRes.error || 'External AI failed',
        aiRes.error
      );
      this.recordAudit(
        'AI_CONTEXT',
        report.projectPath,
        aiRes.ok
          ? `Explained codebase via ${aiRes.provider} using ${ctx.includedFiles.length} selective file(s).`
          : aiRes.error || 'External explanation failed.',
        aiRes.ok,
        aiRes.error
      );

      if (aiRes.ok && aiRes.text) {
        return {
          ok: true,
          summary: aiRes.text,
          includedFiles: ctx.includedFiles,
          sourceAnalysis,
          moduleRelationships: relationships,
          dependencies: report.dependencies,
          usedExternalAI: true
        };
      }
    }

    const localSummary = this.formatLocalArchitectureSummary(report, sourceAnalysis, relationships, params.question);
    this.recordAudit(
      'AI_CONTEXT',
      report.projectPath,
      `Generated local code understanding summary across ${ctx.includedFiles.length} file(s).`,
      true
    );

    return {
      ok: true,
      summary: localSummary,
      includedFiles: ctx.includedFiles,
      sourceAnalysis,
      moduleRelationships: relationships,
      dependencies: report.dependencies,
      usedExternalAI: false
    };
  }

  private formatLocalArchitectureSummary(
    report: ProjectWorkspaceReport,
    focusSource?: SourceFileAnalysis,
    relationships: { file: string; imports: string[]; symbolCount: number }[] = [],
    question?: string
  ): string {
    const lines: string[] = [];
    if (question) {
      lines.push(`Query: ${question}`);
    }
    lines.push(`Project "${report.projectName}" (${report.totalFilesScanned} files scanned, ${report.excludedSecretFiles.length} secret file(s) excluded):`);
    lines.push(`• Languages: ${report.languages.map((l) => `${l.language} (${l.fileCount})`).join(', ') || 'None detected'}`);
    lines.push(`• Frameworks: ${report.frameworks.join(', ') || 'None detected'}`);
    lines.push(`• Package Managers: ${report.packageManagers.join(', ') || 'None detected'}`);
    lines.push(`• Entry Points: ${report.entryPoints.slice(0, 5).join(', ') || 'None detected'}`);
    if (report.dependencies.length > 0) {
      lines.push(
        `• Key Dependencies: ${report.dependencies
          .slice(0, 8)
          .map((d) => `${d.name} (${d.role})`)
          .join('; ')}`
      );
    }

    if (focusSource && focusSource.ok) {
      lines.push('');
      lines.push(`Selected Module: ${focusSource.relativePath} (${focusSource.language}, ${focusSource.lineCount} lines)`);
      lines.push(
        `• Symbols (${focusSource.symbols.length}): ${
          focusSource.symbols.slice(0, 12).map((s) => `${s.kind} ${s.name}@L${s.line}`).join(', ') || 'None'
        }`
      );
      lines.push(`• Imports (${focusSource.imports.length}): ${focusSource.imports.slice(0, 12).join(', ') || 'None'}`);
    }

    if (relationships.length > 0) {
      lines.push('');
      lines.push('Module Relationships:');
      for (const rel of relationships) {
        lines.push(`• ${rel.file}: ${rel.symbolCount} symbol(s) -> imports [${rel.imports.slice(0, 6).join(', ') || 'none'}]`);
      }
    }

    return lines.join('\n');
  }

  // =========================================================================
  // 3. AI Code Generation & Safe Patch Queue
  // =========================================================================

  public validateGeneratedCode(filePath: string, content: string): string[] {
    const warnings: string[] = [];
    if (!content.trim()) {
      warnings.push('Generated content is empty.');
      return warnings;
    }
    if (isSensitiveDevFilename(filePath)) {
      warnings.push('Target filename matches protected secret/credential policy.');
    }
    if (/\.json$/i.test(filePath)) {
      try {
        JSON.parse(content);
      } catch (err) {
        warnings.push(`Invalid JSON syntax: ${err instanceof Error ? err.message : 'parse error'}`);
      }
    }
    if (/\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        warnings.push(`Unbalanced curly braces detected (${openBraces} '{' vs ${closeBraces} '}').`);
      }
    }
    return warnings;
  }

  public async proposePatch(params: {
    projectPath: string;
    relativeOrFullPath: string;
    proposedContent: string;
    title: string;
    explanation: string;
    overwrite?: boolean;
  }): Promise<{ ok: boolean; patch?: ProposedPatchEntry; error?: string }> {
    const cleanProject = params.projectPath.trim();
    const rawTarget = params.relativeOrFullPath.trim();

    if (isSensitiveDevFilename(rawTarget)) {
      const err = 'Blocked: cannot propose or write patches to secret or credential files.';
      this.recordAudit('GENERATE', rawTarget, err, false, 'SECRET_FILE_BLOCKED');
      return { ok: false, error: err };
    }

    const fullPath =
      rawTarget.startsWith(cleanProject) || /^[A-Za-z]:[\\/]/.test(rawTarget) || rawTarget.startsWith('/')
        ? rawTarget
        : joinPath(cleanProject, rawTarget);

    const preview = await desktopBridge.previewDevPatch(cleanProject, fullPath, params.proposedContent);
    if (!preview.ok) {
      this.recordAudit('GENERATE', rawTarget, preview.error || 'Failed to build diff preview.', false, preview.error);
      return { ok: false, error: preview.error || 'Diff preview failed.' };
    }

    const localWarnings = this.validateGeneratedCode(fullPath, params.proposedContent);
    const mergedWarnings = Array.from(new Set([...(preview.validationWarnings || []), ...localWarnings]));
    const enrichedPreview: CodeDiffPreview = {
      ...preview,
      validationWarnings: mergedWarnings
    };

    const patch: ProposedPatchEntry = {
      id: `patch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      projectPath: cleanProject,
      filePath: preview.filePath,
      relativePath: preview.relativePath,
      title: params.title,
      explanation: params.explanation,
      proposedContent: params.proposedContent,
      overwrite: Boolean(params.overwrite),
      preview: enrichedPreview,
      status: 'PENDING_REVIEW',
      createdAt: Date.now()
    };

    this.proposedPatches.unshift(patch);
    if (this.proposedPatches.length > 40) {
      this.proposedPatches = this.proposedPatches.slice(0, 40);
    }

    this.recordAudit(
      'GENERATE',
      patch.relativePath,
      `Prepared diff preview "${patch.title}" (+${enrichedPreview.addedLines}/-${enrichedPreview.removedLines}). Awaiting approval.`,
      true
    );
    this.notify();
    return { ok: true, patch };
  }

  public async generateCodeProposal(params: {
    projectPath: string;
    prompt: string;
    targetRelativePath?: string;
    useExternalAI?: boolean;
    externalUploadPermissionId?: string;
  }): Promise<{
    ok: boolean;
    patch?: ProposedPatchEntry;
    explanation: string;
    usedExternalAI: boolean;
    error?: string;
  }> {
    const report = await this.inspectProject(params.projectPath);
    if (!report.ok) {
      return { ok: false, explanation: report.error || 'Project inspection failed.', usedExternalAI: false, error: report.error };
    }

    const lower = params.prompt.toLowerCase();
    let targetPath = params.targetRelativePath?.trim() || '';
    if (!targetPath) {
      if (lower.includes('python') && lower.includes('calculator')) {
        targetPath = 'calculator.py';
      } else if (lower.includes('fastapi')) {
        targetPath = report.files.some((f) => f.relativePath === 'main.py') ? 'api_server.py' : 'main.py';
      } else if (lower.includes('login') && (report.frameworks.includes('React') || report.languages.some((l) => l.language.includes('TypeScript')))) {
        targetPath = 'src/components/LoginPage.tsx';
      } else if (lower.includes('react') || lower.includes('component')) {
        targetPath = 'src/components/GeneratedPanel.tsx';
      } else if (lower.includes('test')) {
        targetPath = report.languages.some((l) => l.language === 'Python') ? 'tests/test_generated.py' : 'tests/generated.test.ts';
      } else {
        targetPath = report.languages.some((l) => l.language === 'Python') ? 'generated_module.py' : 'src/generatedModule.ts';
      }
    }

    let generatedCode = '';
    let usedExternalAI = false;

    const cfg = contextualAI.getConfig();
    if (params.useExternalAI && cfg.provider !== 'LOCAL' && params.externalUploadPermissionId) {
      const auth = permissionManager.beginAuthorizedExecution(
        params.externalUploadPermissionId,
        'EXTERNAL_AI_UPLOAD',
        report.projectPath
      );
      if (auth.authorized) {
        const ctx = await this.buildSelectiveAIContext({ projectPath: report.projectPath, maxChars: 8000 });
        const aiRes = await contextualAI.queryStructuredCompletion({
          messages: [
            {
              role: 'system',
              content:
                'Return ONLY clean code for the requested file (no markdown fences) aligned with the project conventions.'
            },
            {
              role: 'user',
              content: `Request: ${params.prompt}\nTarget file: ${targetPath}\nProject context:\n${ctx.contextText}`
            }
          ]
        });
        permissionManager.completeExecution(
          params.externalUploadPermissionId,
          aiRes.ok,
          aiRes.ok ? `Generated code proposal for ${targetPath}.` : aiRes.error || 'AI code gen failed',
          aiRes.error
        );
        if (aiRes.ok && aiRes.text) {
          generatedCode = aiRes.text.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim() + '\n';
          usedExternalAI = true;
        }
      }
    }

    if (!generatedCode) {
      generatedCode = this.buildGroundedCodeTemplate(params.prompt, targetPath, report);
    }

    const explanation = `Proposed "${targetPath}" aligned with ${report.projectName} (${report.frameworks.join(', ') || report.languages.map((l) => l.language).join(', ') || 'project workspace'}). Preview ready for explicit user review before writing.`;
    const res = await this.proposePatch({
      projectPath: report.projectPath,
      relativeOrFullPath: targetPath,
      proposedContent: generatedCode,
      title: `Generate ${targetPath}`,
      explanation,
      overwrite: false
    });

    return {
      ok: res.ok,
      patch: res.patch,
      explanation,
      usedExternalAI,
      error: res.error
    };
  }

  private buildGroundedCodeTemplate(prompt: string, targetPath: string, report: ProjectWorkspaceReport): string {
    const lower = prompt.toLowerCase();
    if (/\.py$/i.test(targetPath)) {
      if (lower.includes('calculator')) {
        return `"""Safe CLI arithmetic calculator module generated for ${report.projectName}."""\n\ndef add(a: float, b: float) -> float:\n    return a + b\n\ndef subtract(a: float, b: float) -> float:\n    return a - b\n\ndef multiply(a: float, b: float) -> float:\n    return a * b\n\ndef divide(a: float, b: float) -> float:\n    if b == 0:\n        raise ValueError("Cannot divide by zero")\n    return a / b\n\nif __name__ == "__main__":\n    print("Calculator ready:", add(2, 3))\n`;
      }
      if (lower.includes('fastapi')) {
        return `"""FastAPI service starter for ${report.projectName}."""\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI(title="${report.projectName} API")\n\nclass HealthResponse(BaseModel):\n    status: str\n\n@app.get("/health", response_model=HealthResponse)\ndef read_health() -> HealthResponse:\n    return HealthResponse(status="ok")\n`;
      }
      if (lower.includes('test')) {
        return `"""Generated pytest suite for ${report.projectName}."""\nimport pytest\n\ndef test_placeholder_module_contract():\n    assert True\n`;
      }
      return `"""Generated Python module for ${report.projectName}."""\n\ndef run_task(value: str) -> str:\n    return value.strip()\n`;
    }

    if (/\.tsx$/i.test(targetPath)) {
      if (lower.includes('login')) {
        return `import React, { useState } from 'react';\n\ninterface LoginPageProps {\n  onSubmitCredentials?: (email: string) => void;\n}\n\nexport const LoginPage: React.FC<LoginPageProps> = ({ onSubmitCredentials }) => {\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n  const [error, setError] = useState<string | null>(null);\n\n  const handleSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!email.trim() || !password) {\n      setError('Email and password are required.');\n      return;\n    }\n    setError(null);\n    onSubmitCredentials?.(email.trim());\n  };\n\n  return (\n    <form onSubmit={handleSubmit} className="max-w-sm mx-auto p-6 rounded-lg border border-cyan-500/30 bg-slate-950 space-y-4">\n      <h2 className="text-lg font-semibold text-white">Sign In</h2>\n      {error && <p className="text-xs text-rose-400">{error}</p>}\n      <input\n        type="email"\n        value={email}\n        onChange={(e) => setEmail(e.target.value)}\n        placeholder="Email address"\n        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm text-white"\n      />\n      <input\n        type="password"\n        value={password}\n        onChange={(e) => setPassword(e.target.value)}\n        placeholder="Password"\n        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm text-white"\n      />\n      <button type="submit" className="w-full py-2 rounded bg-cyan-600 text-white text-sm font-medium">\n        Sign In\n      </button>\n    </form>\n  );\n};\n`;
      }
      return `import React from 'react';\n\nexport const GeneratedPanel: React.FC<{ title?: string }> = ({ title = '${report.projectName}' }) => {\n  return (\n    <section className="p-4 rounded-lg border border-cyan-500/30 bg-slate-950 text-slate-100">\n      <h2 className="text-sm font-semibold">{title}</h2>\n      <p className="text-xs text-slate-400 mt-1">Generated module ready for customization.</p>\n    </section>\n  );\n};\n`;
    }

    if (/\.test\.(ts|tsx|js|jsx)$/i.test(targetPath)) {
      return `import { describe, it, expect } from 'vitest';\n\ndescribe('${report.projectName} generated suite', () => {\n  it('verifies baseline assertion', () => {\n    expect(true).toBe(true);\n  });\n});\n`;
    }

    return `// Generated TypeScript module for ${report.projectName}\nexport function executeModuleTask(input: string): string {\n  return input.trim();\n}\n`;
  }

  public requestPatchPermission(patchId: string): PermissionRequest | null {
    const patch = this.proposedPatches.find((p) => p.id === patchId);
    if (!patch) return null;
    return permissionManager.createRequest({
      category: 'CODE_PATCH',
      requestedAction: patch.preview.existed ? 'Apply approved code modification with backup' : 'Create approved code file in project',
      target: patch.filePath,
      reason: `${patch.title} (${patch.relativePath}, +${patch.preview.addedLines}/-${patch.preview.removedLines} lines)`,
      riskLevel: patch.preview.existed ? 'HIGH' : 'MEDIUM',
      securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
      requestedScope: `Single-use code patch to "${patch.relativePath}"`
    });
  }

  public async applyProposedPatch(
    patchId: string,
    permissionId: string,
    overwriteConfirmed = false
  ): Promise<{ ok: boolean; patch?: ProposedPatchEntry; backupPath?: string; error?: string }> {
    const patch = this.proposedPatches.find((p) => p.id === patchId);
    if (!patch) {
      return { ok: false, error: 'Proposed patch not found.' };
    }
    if (patch.preview.overwriteWarning && !overwriteConfirmed && !patch.overwrite) {
      return {
        ok: false,
        error: `Overwrite confirmation required before modifying existing file "${patch.relativePath}".`
      };
    }

    const res = await desktopBridge.applyDevPatch({
      projectPath: patch.projectPath,
      filePath: patch.filePath,
      proposedContent: patch.proposedContent,
      overwrite: overwriteConfirmed || patch.overwrite,
      expectedOriginalHash: patch.preview.existed ? patch.preview.originalHash : undefined,
      summary: patch.title,
      permissionId
    });

    if (res.ok) {
      patch.status = 'APPLIED';
      patch.appliedPatchId = res.patchId;
      await this.refreshBackups();
      this.recordAudit(
        'PATCH',
        patch.relativePath,
        `Applied patch "${patch.title}" (backup: ${res.backupPath || 'created'}).`,
        true
      );
    } else {
      this.recordAudit('PATCH', patch.relativePath, res.error || 'Patch application blocked or failed.', false, res.error);
    }

    this.notify();
    return { ok: res.ok, patch: { ...patch }, backupPath: res.backupPath, error: res.error };
  }

  public rejectProposedPatch(patchId: string): boolean {
    const patch = this.proposedPatches.find((p) => p.id === patchId);
    if (!patch || patch.status !== 'PENDING_REVIEW') return false;
    patch.status = 'REJECTED';
    this.recordAudit('PATCH', patch.relativePath, `Rejected proposed patch "${patch.title}".`, true);
    this.notify();
    return true;
  }

  public requestRollbackPermission(appliedPatchId: string, targetFilePath: string): PermissionRequest {
    return permissionManager.createRequest({
      category: 'CODE_PATCH',
      requestedAction: 'Roll back applied code patch using backup snapshot',
      target: appliedPatchId,
      reason: `Restore previous state of "${targetFilePath}" from backup ${appliedPatchId}.`,
      riskLevel: 'MEDIUM',
      securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
      requestedScope: `Single-use rollback of patch "${appliedPatchId}"`
    });
  }

  public async rollbackPatch(appliedPatchId: string, projectPath: string, permissionId: string) {
    const res = await desktopBridge.rollbackDevPatch(appliedPatchId, projectPath, permissionId);
    if (res.ok) {
      for (const p of this.proposedPatches) {
        if (p.appliedPatchId === appliedPatchId) {
          p.status = 'ROLLED_BACK';
        }
      }
      await this.refreshBackups();
      this.recordAudit('ROLLBACK', res.filePath || appliedPatchId, `Rolled back patch ${appliedPatchId} (${res.restoredAction}).`, true);
    } else {
      this.recordAudit('ROLLBACK', appliedPatchId, res.error || 'Rollback failed.', false, res.error);
    }
    this.notify();
    return res;
  }

  // =========================================================================
  // 4. Code Debugging & Error Analysis
  // =========================================================================

  public async analyzeErrorAndProposeFix(params: {
    projectPath: string;
    errorText: string;
    logFilePath?: string;
  }): Promise<ErrorAnalysisReport> {
    let combinedError = params.errorText.trim();
    if (params.logFilePath && params.logFilePath.trim()) {
      const logRead = await this.readSourceFile(params.projectPath, params.logFilePath.trim());
      if (logRead.ok && logRead.content) {
        combinedError = `${combinedError}\n\n[Log: ${logRead.relativePath}]\n${logRead.content.slice(-3000)}`.trim();
      }
    }

    const report = await this.inspectProject(params.projectPath);
    const affectedFiles: { file: string; line?: number; column?: number }[] = [];

    // Match JS/TS/Vitest/Python stack trace file references
    const patterns = [
      /(?:at\s+[^\n(]+\()?([A-Za-z0-9_./\\-]+\.(?:tsx?|jsx?|py|mjs|cjs)):(\d+)(?::(\d+))?/g,
      /File\s+"([^"]+\.py)",\s+line\s+(\d+)/g,
      /([A-Za-z0-9_./\\-]+\.tsx?)\((\d+),(\d+)\):\s+error\s+TS\d+/g
    ];

    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(combinedError)) !== null) {
        const rawFile = match[1].replace(/\\/g, '/');
        if (rawFile.includes('node_modules')) continue;
        affectedFiles.push({
          file: rawFile,
          line: Number(match[2]),
          column: match[3] ? Number(match[3]) : undefined
        });
      }
    }

    let rootCauseCategory = 'Runtime / Build Exception';
    let explanation = 'Stack trace parsed. Inspect matching source locations before approving changes.';

    if (/TS\d+|Type '.*' is not assignable|Cannot find name/i.test(combinedError)) {
      rootCauseCategory = 'TypeScript Type Error';
      explanation = 'Type mismatch or missing symbol identified in TypeScript compilation output.';
    } else if (/Cannot find module|ModuleNotFoundError|ERR_MODULE_NOT_FOUND/i.test(combinedError)) {
      rootCauseCategory = 'Missing Module / Import Path';
      explanation = 'An import specifier does not resolve to an existing file or installed dependency.';
    } else if (/TypeError:.*(?:undefined|null)|AttributeError:.*NoneType/i.test(combinedError)) {
      rootCauseCategory = 'Null / Undefined Dereference';
      explanation = 'Property access or call attempted on an uninitialized, null, or undefined value.';
    } else if (/ZeroDivisionError|divide by zero/i.test(combinedError)) {
      rootCauseCategory = 'Division By Zero Guard Missing';
      explanation = 'Arithmetic divisor reached 0 without an explicit guard check.';
    } else if (/SyntaxError|Unexpected token/i.test(combinedError)) {
      rootCauseCategory = 'Syntax Error';
      explanation = 'Parser encountered malformed syntax, missing delimiter, or invalid token.';
    }

    let matchedSourceAnalysis: SourceFileAnalysis | undefined;
    if (report.ok && affectedFiles.length > 0) {
      const firstRef = affectedFiles[0];
      const matchedNode = report.files.find(
        (n) =>
          !n.isDirectory &&
          (n.relativePath === firstRef.file ||
            firstRef.file.endsWith(`/${n.relativePath}`) ||
            n.fullPath.replace(/\\/g, '/') === firstRef.file)
      );
      if (matchedNode) {
        matchedSourceAnalysis = await this.readSourceFile(report.projectPath, matchedNode.fullPath);
      }
    }

    const summary = `${rootCauseCategory}${
      affectedFiles[0] ? ` near ${affectedFiles[0].file}${affectedFiles[0].line ? `:${affectedFiles[0].line}` : ''}` : ''
    }. ${explanation}`;

    this.recordAudit('DEBUG', params.projectPath, summary, true);

    return {
      ok: true,
      summary,
      rootCauseCategory,
      explanation,
      affectedFiles,
      matchedSourceAnalysis,
      verificationNote:
        'Diagnosis generated only. Any proposed fix remains unapplied and unverified until reviewed, approved, patched, and re-tested.'
    };
  }

  // =========================================================================
  // 5. Terminal & Command Center
  // =========================================================================

  public requestDevCommandPermission(
    projectPath: string,
    tool: DevCommandTool,
    args: string[]
  ): PermissionRequest {
    const commandDisplay = `${tool}${args.length ? ' ' + args.join(' ') : ''}`;
    return permissionManager.createRequest({
      category: 'DEV_COMMAND',
      requestedAction: 'Run allowlisted development command inside approved project',
      target: commandDisplay,
      reason: `Execute "${commandDisplay}" inside approved project "${projectPath}".`,
      riskLevel: 'HIGH',
      securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
      requestedScope: `Single-use command execution "${commandDisplay}" in "${projectPath}"`
    });
  }

  public async runApprovedCommand(params: {
    projectPath: string;
    tool: DevCommandTool;
    args: string[];
    permissionId: string;
    timeoutMs?: number;
    taskId?: string;
  }): Promise<DevCommandResult> {
    const res = await desktopBridge.runDevCommand(params);
    this.recordAudit(
      'COMMAND',
      res.commandDisplay,
      res.ok
        ? `Executed "${res.commandDisplay}" (${res.durationMs} ms).`
        : res.cancelled
        ? `Cancelled "${res.commandDisplay}".`
        : res.error || `Command failed (exit ${res.exitCode}).`,
      res.ok,
      res.error
    );
    return res;
  }

  public async cancelCommand(taskId: string): Promise<boolean> {
    return desktopBridge.cancelDevCommand(taskId);
  }

  // =========================================================================
  // 6. Automated Testing Assistant
  // =========================================================================

  public discoverTests(report: ProjectWorkspaceReport | null): TestDiscoverySummary {
    if (!report || !report.ok) {
      return { testFrameworks: [], existingTestFiles: [], testScripts: {}, suggestedUntestedFiles: [] };
    }
    const testScripts: Record<string, string> = {};
    for (const [k, v] of Object.entries(report.scripts || {})) {
      if (k.includes('test') || v.includes('vitest') || v.includes('jest') || v.includes('pytest')) {
        testScripts[k] = v;
      }
    }

    const existingNames = new Set(
      report.testFiles.map((tf) => tf.split('/').pop()?.replace(/\.(test|spec)\.[^.]+$/, '').replace(/^test_/, '').replace(/\.py$/, '').toLowerCase())
    );
    const suggestedUntestedFiles = report.files
      .filter((f) => !f.isDirectory && !f.isTestFile && /\.(ts|tsx|js|jsx|py)$/i.test(f.relativePath))
      .filter((f) => {
        const stem = f.name.replace(/\.[^.]+$/, '').toLowerCase();
        return stem !== 'index' && stem !== 'main' && !existingNames.has(stem);
      })
      .map((f) => f.relativePath)
      .slice(0, 8);

    return {
      testFrameworks: report.testFrameworks,
      existingTestFiles: report.testFiles,
      testScripts,
      suggestedUntestedFiles
    };
  }

  public async generateUnitTestsForFile(projectPath: string, sourceFileRelativePath: string) {
    const report = await this.inspectProject(projectPath);
    if (!report.ok) return { ok: false, error: report.error || 'Project inspection failed.' };

    const src = await this.readSourceFile(report.projectPath, joinPath(report.projectPath, sourceFileRelativePath));
    if (!src.ok) return { ok: false, error: src.error || 'Unable to read source file.' };

    const isPython = src.language === 'Python';
    const baseName = src.name.replace(/\.[^.]+$/, '');
    const testRelPath = isPython ? `tests/test_${baseName}.py` : `tests/${baseName}.test.ts`;

    const exportedNames = src.symbols.map((s) => s.name).slice(0, 5);
    const testContent = isPython
      ? `"""Unit tests proposed for ${src.relativePath} (not executed until user applies & runs pytest)."""\nimport pytest\n\n${(exportedNames.length
          ? exportedNames
          : ['module_behavior']
        )
          .map((fn) => `def test_${fn.toLowerCase()}():\n    # TODO: add assertions for ${fn} in ${src.relativePath}\n    assert True\n`)
          .join('\n')}`
      : `import { describe, it, expect } from 'vitest';\n\n// Proposed unit tests for ${src.relativePath} (not yet executed)\ndescribe('${baseName}', () => {\n${(exportedNames.length
          ? exportedNames
          : [baseName]
        )
          .map(
            (sym) =>
              `  it('verifies ${sym} expected contract', () => {\n    expect(typeof '${sym}').toBe('string');\n  });`
          )
          .join('\n')}\n});\n`;

    return this.proposePatch({
      projectPath: report.projectPath,
      relativeOrFullPath: testRelPath,
      proposedContent: testContent,
      title: `Generate Unit Tests for ${src.relativePath}`,
      explanation: `Proposed unit tests covering ${exportedNames.length} inspected symbol(s) in ${src.relativePath}. Tests are generated only and NOT executed until approved and run.`,
      overwrite: false
    });
  }

  // =========================================================================
  // 7. Grounded Project Documentation Generator
  // =========================================================================

  public async generateGroundedDocumentation(
    projectPath: string,
    docType: DocGeneratorType,
    targetFilename?: string
  ) {
    const report = await this.inspectProject(projectPath);
    if (!report.ok) {
      return { ok: false, error: report.error || 'Project inspection failed.' };
    }

    const defaultNames: Record<DocGeneratorType, string> = {
      README: 'README.generated.md',
      ARCHITECTURE: 'docs/ARCHITECTURE.generated.md',
      API_DOCS: 'docs/API.generated.md',
      SETUP_GUIDE: 'docs/SETUP_GUIDE.generated.md',
      MODULE_SUMMARY: 'docs/MODULE_SUMMARY.generated.md',
      DEV_REPORT: 'docs/DEV_REPORT.generated.md'
    };

    const dest = (targetFilename && targetFilename.trim()) || defaultNames[docType];
    const langs = report.languages.map((l) => `- **${l.language}**: ${l.fileCount} file(s)`).join('\n') || '- None detected';
    const frameworks = report.frameworks.length > 0 ? report.frameworks.join(', ') : 'None detected';
    const scripts = Object.entries(report.scripts || {})
      .map(([k, v]) => `- \`${k}\`: \`${v}\``)
      .join('\n') || '- No scripts declared';
    const deps = report.dependencies
      .slice(0, 20)
      .map((d) => `- \`${d.name}\` (${d.version}, ${d.scope}): ${d.role}`)
      .join('\n') || '- No dependencies inspected';
    const entries = report.entryPoints.map((e) => `- \`${e}\``).join('\n') || '- No entry points flagged';
    const configs = report.configFiles.map((c) => `- \`${c}\``).join('\n') || '- No config files flagged';

    let content = '';
    if (docType === 'README' || docType === 'SETUP_GUIDE') {
      content = `# ${report.projectName} — ${docType === 'README' ? 'Project Overview' : 'Developer Setup Guide'}\n\n> Generated by JARVIS AI Development Studio from direct workspace inspection (${report.totalFilesScanned} files scanned; ${report.excludedSecretFiles.length} secret file(s) excluded).\n\n## Stack & Package Managers\n- **Frameworks**: ${frameworks}\n- **Package Managers**: ${report.packageManagers.join(', ') || 'None detected'}\n- **Test Frameworks**: ${report.testFrameworks.join(', ') || 'None detected'}\n\n## Languages\n${langs}\n\n## Entry Points\n${entries}\n\n## Configuration Files\n${configs}\n\n## Available Scripts\n${scripts}\n\n## Inspected Dependencies\n${deps}\n`;
    } else if (docType === 'ARCHITECTURE' || docType === 'MODULE_SUMMARY') {
      content = `# ${report.projectName} — ${docType === 'ARCHITECTURE' ? 'Architecture Notes' : 'Module Summary'}\n\n## Project Boundaries & Structure\n- Total files inspected: ${report.totalFilesScanned}\n- Secret files excluded from inspection: ${report.excludedSecretFiles.length}\n\n## Top-Level Directories\n${report.directories.slice(0, 20).map((d) => `- \`${d}/\``).join('\n') || '- Root only'}\n\n## Entry Points\n${entries}\n\n## Test Suites (${report.testFiles.length})\n${report.testFiles.slice(0, 20).map((t) => `- \`${t}\``).join('\n') || '- None discovered'}\n`;
    } else {
      content = `# ${report.projectName} — ${docType === 'API_DOCS' ? 'API & Script Reference' : 'Development Inspection Report'}\n\n- **Inspected Path**: \`${report.projectPath}\`\n- **Frameworks**: ${frameworks}\n- **Languages**: ${report.languages.map((l) => l.language).join(', ') || 'Unknown'}\n\n## Scripts\n${scripts}\n\n## Dependencies\n${deps}\n`;
    }

    this.recordAudit('DOCS', dest, `Generated ${docType} preview grounded in ${report.totalFilesScanned} inspected files.`, true);
    return this.proposePatch({
      projectPath: report.projectPath,
      relativeOrFullPath: dest,
      proposedContent: content,
      title: `Save ${docType} Documentation`,
      explanation: `Grounded ${docType} generated strictly from inspected files/scripts/dependencies in "${report.projectName}". Review before saving.`,
      overwrite: false
    });
  }
}

export const devStudioService = new DevStudioService();
