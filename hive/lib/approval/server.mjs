/**
 * Approval HTTP API server.
 *
 * Exposes the ApprovalEngine over a local HTTP interface so the Multica
 * dashboard micro-frontend can list pending approvals, submit decisions, and
 * read audit records without depending on the Multica server itself. Also
 * serves the plain web dashboard fallback (DOS-221, ./web/) at "/" for
 * platforms without the Multica micro-frontend — same API, no build step.
 *
 * Runs on 127.0.0.1:7841 by default (override via APPROVAL_PORT env var).
 * CORS is open for localhost origins — this server is only reachable locally.
 *
 * Usage:
 *   node hive/lib/approval/server.mjs           # standalone
 *   import { startApprovalServer } from './server.mjs'  # programmatic
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createEngine } from './engine.mjs';

const PORT = Number(process.env.APPROVAL_PORT ?? 7841);
const HOST = '127.0.0.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

export function startApprovalServer(dbPath) {
  const engine = createEngine(dbPath);

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;

    try {
      // GET /api/approvals/pending
      if (req.method === 'GET' && pathname === '/api/approvals/pending') {
        const status = url.searchParams.get('status') ?? 'pending';
        const actionType = url.searchParams.get('actionType') ?? undefined;
        return send(res, 200, engine.listPending({ status, actionType }));
      }

      // GET /api/approvals/pending/:id
      const pendingIdMatch = pathname.match(/^\/api\/approvals\/pending\/([^/]+)$/);
      if (req.method === 'GET' && pendingIdMatch) {
        const pending = engine.getPending(pendingIdMatch[1]);
        if (!pending) return send(res, 404, { error: 'not_found' });
        return send(res, 200, pending);
      }

      // POST /api/approvals/submit  — human-gate: { approvalId, approve, note?, approverIdentity }
      if (req.method === 'POST' && pathname === '/api/approvals/submit') {
        const body = await readBody(req);
        const { approvalId, approve, note, approverIdentity } = body;
        if (!approvalId || typeof approve !== 'boolean' || !approverIdentity) {
          return send(res, 400, { error: 'missing_fields', required: ['approvalId', 'approve (bool)', 'approverIdentity'] });
        }
        const timestamp = new Date().toISOString();
        const verdict = { approve, note: note ?? '', approverIdentity };
        const result = engine.submit(approvalId, verdict, timestamp);
        if ('error' in result) return send(res, 400, result);
        return send(res, 200, result.auditRecord);
      }

      // POST /api/approvals/submit-verdicts — agent-quorum / multi-agent-vote:
      // { approvalId, verdicts: VerdictEntry[] } (the complete set, one per
      // configured quorum member / panel lens).
      if (req.method === 'POST' && pathname === '/api/approvals/submit-verdicts') {
        const body = await readBody(req);
        const { approvalId, verdicts } = body;
        if (!approvalId || !Array.isArray(verdicts)) {
          return send(res, 400, { error: 'missing_fields', required: ['approvalId', 'verdicts (array)'] });
        }
        const timestamp = new Date().toISOString();
        const result = engine.submit(approvalId, verdicts, timestamp);
        if ('error' in result) return send(res, 400, result);
        return send(res, 200, result.auditRecord);
      }

      // GET /api/approvals/audit-records
      if (req.method === 'GET' && pathname === '/api/approvals/audit-records') {
        const actionType = url.searchParams.get('actionType') ?? undefined;
        return send(res, 200, engine.listAuditRecords({ actionType }));
      }

      // GET /api/approvals/audit-records/:id  (looks up by approvalId)
      const auditIdMatch = pathname.match(/^\/api\/approvals\/audit-records\/([^/]+)$/);
      if (req.method === 'GET' && auditIdMatch) {
        const record = engine.getAuditRecord(auditIdMatch[1]);
        if (!record) return send(res, 404, { error: 'not_found' });
        return send(res, 200, record);
      }

      // GET /health
      if (req.method === 'GET' && pathname === '/health') {
        return send(res, 200, { ok: true });
      }

      // GET / , /index.html , /app.js — plain web dashboard fallback (DOS-221)
      if (req.method === 'GET' && STATIC_FILES[pathname]) {
        const { file, type } = STATIC_FILES[pathname];
        try {
          const contents = await readFile(path.join(WEB_DIR, file));
          res.writeHead(200, { 'Content-Type': type, ...CORS_HEADERS });
          return res.end(contents);
        } catch {
          return send(res, 404, { error: 'not_found' });
        }
      }

      send(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error('[approval-server] error:', err);
      send(res, 500, { error: 'internal_error', message: err?.message });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[approval-server] listening at http://${HOST}:${PORT}`);
  });

  return server;
}

// Run standalone when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  startApprovalServer();
}
