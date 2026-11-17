import {
  PermissionAuditDecision,
  PermissionAuditEntry,
  PermissionCategory,
  PermissionRequest,
  PermissionRiskLevel,
  PermissionStatus
} from '../types/assistant';

const DEFAULT_PERMISSION_TTL_MS = 120_000;

export function normalizePermissionTarget(target: string): string {
  return target.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface CreatePermissionParams {
  category: PermissionCategory;
  requestedAction: string;
  target: string;
  reason: string;
  riskLevel?: PermissionRiskLevel;
  securityLevel?: import('../types/assistant').PermissionSecurityLevel;
  capabilityId?: import('../types/assistant').PermissionCapabilityId;
  requestedScope: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface PermissionConsumeResult {
  authorized: boolean;
  status: PermissionStatus;
  request?: PermissionRequest;
  error?: string;
}

export class PermissionManager {
  private requests: Map<string, PermissionRequest> = new Map();
  private auditHistory: PermissionAuditEntry[] = [];
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private appendAudit(
    req: PermissionRequest,
    decision: PermissionAuditDecision,
    resultSummary: string,
    timestamp = Date.now()
  ) {
    this.auditHistory.unshift({
      id: `audit-${timestamp.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      permissionId: req.id,
      category: req.category,
      requestedAction: req.requestedAction,
      target: req.target,
      decision,
      executionStatus: req.status,
      resultSummary,
      timestamp
    });
    if (this.auditHistory.length > 80) {
      this.auditHistory = this.auditHistory.slice(0, 80);
    }
  }

  public expireOutdatedRequests(now = Date.now()): number {
    let expiredCount = 0;
    for (const req of this.requests.values()) {
      if ((req.status === 'AWAITING_APPROVAL' || req.status === 'APPROVED') && now > req.expiresAt) {
        req.status = 'EXPIRED';
        req.completedAt = now;
        req.resultSummary = 'Permission request expired before execution.';
        this.appendAudit(req, 'EXPIRED', 'Approval window elapsed; request expired safely.', now);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      this.notify();
    }
    return expiredCount;
  }

  public createRequest(params: CreatePermissionParams, now = Date.now()): PermissionRequest {
    this.expireOutdatedRequests(now);

    const cleanTarget = params.target.trim();
    if (!cleanTarget) {
      throw new Error('Permission request requires a concrete, non-empty target.');
    }

    const fingerprint = normalizePermissionTarget(cleanTarget);

    // Prevent duplicate pending approval cards for the exact same category/action/target
    for (const existing of this.requests.values()) {
      if (
        existing.status === 'AWAITING_APPROVAL' &&
        existing.category === params.category &&
        existing.requestedAction === params.requestedAction &&
        existing.targetFingerprint === fingerprint
      ) {
        return { ...existing };
      }
    }

    const ttl = Math.max(100, params.ttlMs ?? DEFAULT_PERMISSION_TTL_MS);
    const req: PermissionRequest = {
      id: `perm-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      category: params.category,
      requestedAction: params.requestedAction.trim(),
      target: cleanTarget,
      targetFingerprint: fingerprint,
      reason: params.reason.trim(),
      riskLevel: params.riskLevel || 'MEDIUM',
      securityLevel: params.securityLevel,
      capabilityId: params.capabilityId,
      requestedScope: params.requestedScope.trim() || 'Single-use execution only',
      createdAt: now,
      expiresAt: now + ttl,
      status: 'AWAITING_APPROVAL',
      metadata: params.metadata ? { ...params.metadata } : undefined
    };

    this.requests.set(req.id, req);
    this.appendAudit(req, 'REQUESTED', `Waiting for user approval (${req.requestedScope}).`, now);
    this.notify();
    return { ...req };
  }

  /**
   * Issue a tracked single-use execution token pre-authorized by a Level 1 persistent user grant.
   * Preserves audit logs and single-use consumption integrity inside PermissionManager.
   */
  public authorizePreapprovedExecution(params: CreatePermissionParams, now = Date.now()): PermissionRequest {
    this.expireOutdatedRequests(now);

    const cleanTarget = params.target.trim();
    if (!cleanTarget) {
      throw new Error('Preapproved execution requires a concrete, non-empty target.');
    }

    const ttl = Math.max(100, params.ttlMs ?? DEFAULT_PERMISSION_TTL_MS);
    const req: PermissionRequest = {
      id: `perm-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      category: params.category,
      requestedAction: params.requestedAction.trim(),
      target: cleanTarget,
      targetFingerprint: normalizePermissionTarget(cleanTarget),
      reason: params.reason.trim(),
      riskLevel: params.riskLevel || 'LOW',
      securityLevel: params.securityLevel || 'LEVEL_1_PREAPPROVED',
      capabilityId: params.capabilityId,
      requestedScope: params.requestedScope.trim() || 'Level 1 persistently authorized execution',
      createdAt: now,
      expiresAt: now + ttl,
      decidedAt: now,
      status: 'APPROVED',
      resultSummary: 'Authorized automatically via Level 1 persistent user grant.',
      metadata: params.metadata ? { ...params.metadata } : undefined
    };

    this.requests.set(req.id, req);
    this.appendAudit(
      req,
      'POLICY_PREAPPROVED',
      `Executed under Level 1 persistent grant (${req.requestedScope}).`,
      now
    );
    this.notify();
    return { ...req };
  }

  public recordPolicyBlock(
    params: {
      category: PermissionCategory;
      requestedAction: string;
      target: string;
      reason: string;
      securityLevel?: import('../types/assistant').PermissionSecurityLevel;
      capabilityId?: import('../types/assistant').PermissionCapabilityId;
    },
    now = Date.now()
  ): PermissionRequest {
    const cleanTarget = params.target.trim() || 'unspecified-target';
    const req: PermissionRequest = {
      id: `perm-blk-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      category: params.category,
      requestedAction: params.requestedAction.trim(),
      target: cleanTarget,
      targetFingerprint: normalizePermissionTarget(cleanTarget),
      reason: params.reason.trim(),
      riskLevel: 'MEDIUM',
      securityLevel: params.securityLevel,
      capabilityId: params.capabilityId,
      requestedScope: 'Blocked by persistent permission policy',
      createdAt: now,
      expiresAt: now,
      decidedAt: now,
      completedAt: now,
      status: 'DENIED',
      resultSummary: params.reason.trim(),
      error: 'PERMISSION_DENIED_BY_POLICY'
    };

    this.requests.set(req.id, req);
    this.appendAudit(req, 'POLICY_BLOCKED', params.reason.trim(), now);
    this.notify();
    return { ...req };
  }

  public getRequest(permissionId: string, now = Date.now()): PermissionRequest | null {
    this.expireOutdatedRequests(now);
    const req = this.requests.get(permissionId);
    return req ? { ...req } : null;
  }

  public getStatus(permissionId: string, now = Date.now()): PermissionStatus {
    this.expireOutdatedRequests(now);
    return this.requests.get(permissionId)?.status ?? 'NOT_REQUESTED';
  }

  public getPendingRequests(now = Date.now()): PermissionRequest[] {
    this.expireOutdatedRequests(now);
    return Array.from(this.requests.values())
      .filter((r) => r.status === 'AWAITING_APPROVAL')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
  }

  public getAllRequests(now = Date.now()): PermissionRequest[] {
    this.expireOutdatedRequests(now);
    return Array.from(this.requests.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
  }

  public getAuditHistory(limit = 40, now = Date.now()): PermissionAuditEntry[] {
    this.expireOutdatedRequests(now);
    return this.auditHistory.slice(0, Math.max(1, limit)).map((e) => ({ ...e }));
  }

  public approveOnce(permissionId: string, now = Date.now()): PermissionRequest | null {
    this.expireOutdatedRequests(now);
    const req = this.requests.get(permissionId);
    if (!req) return null;

    if (req.status !== 'AWAITING_APPROVAL') {
      return { ...req };
    }

    req.status = 'APPROVED';
    req.decidedAt = now;
    req.resultSummary = 'Approved once by user; awaiting verified execution.';
    this.appendAudit(req, 'APPROVED_ONCE', 'User granted single-use approval.', now);
    this.notify();
    return { ...req };
  }

  public deny(permissionId: string, reason = 'Denied by user.', now = Date.now()): PermissionRequest | null {
    this.expireOutdatedRequests(now);
    const req = this.requests.get(permissionId);
    if (!req) return null;

    if (req.status === 'COMPLETED' || req.status === 'FAILED' || req.status === 'EXPIRED') {
      return { ...req };
    }

    req.status = 'DENIED';
    req.decidedAt = now;
    req.completedAt = now;
    req.resultSummary = reason;
    req.error = reason;
    this.appendAudit(req, 'DENIED', reason, now);
    this.notify();
    return { ...req };
  }

  public cancel(permissionId: string, reason = 'Action cancelled by user.', now = Date.now()): PermissionRequest | null {
    this.expireOutdatedRequests(now);
    const req = this.requests.get(permissionId);
    if (!req) return null;

    if (req.status === 'COMPLETED' || req.status === 'FAILED' || req.status === 'EXPIRED') {
      return { ...req };
    }

    req.status = 'CANCELLED';
    req.decidedAt = req.decidedAt ?? now;
    req.completedAt = now;
    req.resultSummary = reason;
    this.appendAudit(req, 'CANCELLED', reason, now);
    this.notify();
    return { ...req };
  }

  public beginAuthorizedExecution(
    permissionId: string,
    expectedCategory: PermissionCategory,
    expectedTarget: string,
    now = Date.now()
  ): PermissionConsumeResult {
    this.expireOutdatedRequests(now);
    const req = this.requests.get(permissionId);
    if (!req) {
      return {
        authorized: false,
        status: 'NOT_REQUESTED',
        error: 'No permission request found for this operation.'
      };
    }

    if (req.status === 'EXPIRED') {
      return {
        authorized: false,
        status: 'EXPIRED',
        request: { ...req },
        error: 'Permission request has expired. Request fresh approval before proceeding.'
      };
    }

    if (req.status === 'DENIED') {
      return {
        authorized: false,
        status: 'DENIED',
        request: { ...req },
        error: 'Action blocked: permission was denied by user.'
      };
    }

    if (req.status === 'CANCELLED') {
      return {
        authorized: false,
        status: 'CANCELLED',
        request: { ...req },
        error: 'Action blocked: permission request was cancelled.'
      };
    }

    if (req.status !== 'APPROVED') {
      return {
        authorized: false,
        status: req.status,
        request: { ...req },
        error:
          req.status === 'AWAITING_APPROVAL'
            ? 'Explicit user approval is required before execution.'
            : `Permission token cannot be reused (current status: ${req.status}).`
      };
    }

    const expectedFingerprint = normalizePermissionTarget(expectedTarget);
    if (req.category !== expectedCategory || req.targetFingerprint !== expectedFingerprint) {
      req.status = 'FAILED';
      req.completedAt = now;
      req.error = 'Permission target mismatch rejected.';
      req.resultSummary = `Blocked target mismatch: approved for "${req.target}" (${req.category}), attempted "${expectedTarget}" (${expectedCategory}).`;
      this.appendAudit(req, 'REJECTED_TARGET_MISMATCH', req.resultSummary, now);
      this.notify();
      return {
        authorized: false,
        status: 'FAILED',
        request: { ...req },
        error: req.resultSummary
      };
    }

    req.status = 'EXECUTING';
    req.executedAt = now;
    req.resultSummary = 'Executing approved action...';
    this.notify();
    return {
      authorized: true,
      status: 'EXECUTING',
      request: { ...req }
    };
  }

  public completeExecution(
    permissionId: string,
    ok: boolean,
    summary: string,
    error?: string,
    now = Date.now()
  ): PermissionRequest | null {
    const req = this.requests.get(permissionId);
    if (!req) return null;

    req.status = ok ? 'COMPLETED' : 'FAILED';
    req.completedAt = now;
    req.resultSummary = summary;
    if (!ok) {
      req.error = error || summary;
    }

    this.appendAudit(req, ok ? 'COMPLETED' : 'FAILED', summary, now);
    this.notify();
    return { ...req };
  }

  public clearAll() {
    this.requests.clear();
    this.auditHistory = [];
    this.notify();
  }
}

export const permissionManager = new PermissionManager();
