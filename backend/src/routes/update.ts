import { Router } from 'express';
import { authenticate, type AuthenticatedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import type { AuthService } from '../services/AuthService.js';
import type { UpdateService } from '../services/UpdateService.js';

// ---------------------------------------------------------------------------
// Update-Router (M14) — Admin-Bereich „System/Update".
//
// Löst kein Update selbst aus: schreibt nur eine Marker-Datei, die eine
// systemd-Path-Unit auf dem Pi beobachtet (siehe docs/AUTO-UPDATE.md). Alle
// Routen sind Admin-only.
// ---------------------------------------------------------------------------

export function createUpdateRouter(authService: AuthService, updateService: UpdateService): Router {
  const router = Router();
  const auth = authenticate(authService);
  const admin = requireRole('admin');

  // -------------------------------------------------------------------------
  // GET /update/status  (Admin)
  // -------------------------------------------------------------------------
  router.get('/status', auth, admin, (_req, res, next) => {
    try {
      res.json(updateService.getStatus());
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // POST /update  (Admin) — „Jetzt aktualisieren"
  // -------------------------------------------------------------------------
  router.post('/', auth, admin, (req, res, next) => {
    try {
      const actorId = Number((req as AuthenticatedRequest).auth.sub);
      updateService.requestUpdate(actorId);
      res.status(202).json({ accepted: true, mode: 'update' });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // POST /update/check  (Admin) — „Jetzt prüfen"
  // -------------------------------------------------------------------------
  router.post('/check', auth, admin, (req, res, next) => {
    try {
      const actorId = Number((req as AuthenticatedRequest).auth.sub);
      updateService.requestCheck(actorId);
      res.status(202).json({ accepted: true, mode: 'check' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
