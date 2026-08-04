import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import type { Env } from './utils/env.js';
import {
  MembersRepo,
  DrinksRepo,
  DrinkCategoriesRepo,
  BookingsRepo,
  AuditLogRepo,
  TokenBlocklistRepo,
  VerbindungenRepo,
  ZeigerRepo,
} from './db/repos/index.js';
import { AuthService } from './services/AuthService.js';
import { MembersService } from './services/MembersService.js';
import { DrinksService } from './services/DrinksService.js';
import { DrinkCategoriesService } from './services/DrinkCategoriesService.js';
import { BookingService } from './services/BookingService.js';
import { ReportService } from './services/ReportService.js';
import { ZeigerService } from './services/ZeigerService.js';
import { VerbindungenService } from './services/VerbindungenService.js';
import { UpdateService } from './services/UpdateService.js';
import { healthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createMembersRouter } from './routes/members.js';
import { createDrinksRouter } from './routes/drinks.js';
import { createDrinkCategoriesRouter } from './routes/drinkCategories.js';
import { createBookingsRouter } from './routes/bookings.js';
import { createReportsRouter } from './routes/reports.js';
import { createZeigerRouter } from './routes/zeiger.js';
import { createVerbindungenRouter } from './routes/verbindungen.js';
import { createUpdateRouter } from './routes/update.js';
import { createErrorHandler } from './middleware/errorHandler.js';

export interface AppOptions {
  logger: Logger;
  db: Db;
  env: Env;
}

/**
 * Baut die Express-App auf und gibt sie zurück.
 * Trennt App-Konstruktion vom Listen-Start, damit Tests die App
 * ohne offenen Port via Supertest ansprechen können.
 */
export function createApp({ logger, db, env }: AppOptions): Express {
  const app = express();

  // Guardrail: Das Rate-Limiting darf nur in Test-/E2E-Läufen deaktiviert werden.
  // Ist das Flag in einer echten Produktionsumgebung gesetzt, laut warnen –
  // dann fehlt der Login-Brute-Force-Schutz.
  if (process.env['DISABLE_RATE_LIMIT'] === 'true' && env.NODE_ENV === 'production') {
    logger.warn(
      'DISABLE_RATE_LIMIT=true bei NODE_ENV=production – der Login-Brute-Force-Schutz ist deaktiviert. Nur für E2E-Tests vorgesehen!',
    );
  }

  // Hinter einem Reverse-Proxy (Caddy/nginx) die echte Client-IP durchreichen,
  // damit das Login-Rate-Limiting pro Nutzer statt pro Proxy greift. Default 0
  // (kein Proxy) – siehe env.TRUST_PROXY.
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  // Security-Header inkl. Content-Security-Policy. Da der Token im localStorage
  // liegt (bewusster Trade-off, siehe ARCHITECTURE.md), ist eine strikte CSP die
  // günstigste Absicherung gegen den XSS-Fall: Skripte nur von 'self'.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // React setzt Inline-Style-Attribute; das Webfont-Stylesheet lädt extern.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          // Bewusst deaktiviert: Der Pi wird im Vereins-WLAN oft nur über HTTP
          // ausgeliefert (HTTPS ist laut ARCHITECTURE.md nur empfohlen). Mit
          // dieser Direktive würde der Browser relative Asset-URLs auf https://
          // hochstufen und alle Assets 404en.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  // -- Repos & Services -------------------------------------------------------
  const membersRepo = new MembersRepo(db);
  const auditLogRepo = new AuditLogRepo(db);
  const tokenBlocklistRepo = new TokenBlocklistRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const drinkCategoriesRepo = new DrinkCategoriesRepo(db);
  const bookingsRepo = new BookingsRepo(db);
  const verbindungenRepo = new VerbindungenRepo(db);
  const zeigerRepo = new ZeigerRepo(db);

  const authService = new AuthService(
    membersRepo,
    auditLogRepo,
    tokenBlocklistRepo,
    env.JWT_SECRET,
    env.JWT_EXPIRES_IN,
  );

  const membersService = new MembersService(membersRepo, auditLogRepo);
  const drinksService = new DrinksService(drinksRepo, drinkCategoriesRepo, auditLogRepo);
  const drinkCategoriesService = new DrinkCategoriesService(drinkCategoriesRepo, auditLogRepo);
  const bookingService = new BookingService(
    bookingsRepo,
    drinksRepo,
    auditLogRepo,
    membersRepo,
    zeigerRepo,
  );
  const reportService = new ReportService(bookingsRepo, membersRepo, zeigerRepo, verbindungenRepo);
  const zeigerService = new ZeigerService(zeigerRepo, verbindungenRepo, auditLogRepo, bookingsRepo);
  const verbindungenService = new VerbindungenService(verbindungenRepo, auditLogRepo);
  const updateService = new UpdateService(env.UPDATE_STATE_DIR, auditLogRepo);

  // -- Profilbilder (statische Auslieferung vor API-Routen) -------------------
  app.use('/avatars', express.static(env.AVATAR_DIR));

  // -- Routen -----------------------------------------------------------------
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(authService, membersService, env.AVATAR_DIR));
  app.use('/api/v1/members', createMembersRouter(authService, membersService, env.AVATAR_DIR));
  app.use('/api/v1/drinks', createDrinksRouter(authService, drinksService));
  app.use(
    '/api/v1/drink-categories',
    createDrinkCategoriesRouter(authService, drinkCategoriesService),
  );
  app.use('/api/v1/bookings', createBookingsRouter(authService, bookingService));
  app.use('/api/v1/reports', createReportsRouter(authService, reportService));
  app.use('/api/v1/zeiger', createZeigerRouter(authService, zeigerService));
  app.use('/api/v1/verbindungen', createVerbindungenRouter(authService, verbindungenService));
  app.use('/api/v1/update', createUpdateRouter(authService, updateService));

  // -- Frontend (SPA) ---------------------------------------------------------
  // Im Production-Build liegen die gebauten React-Assets in frontend/dist,
  // relativ zum kompilierten backend/dist/app.js also zwei Ebenen hoch.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));

  // SPA-Fallback: alle Nicht-API-Routen auf index.html umleiten,
  // damit React Router client-seitig die Navigation übernimmt.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  // -- Globaler Error-Handler (muss nach allen Routen stehen) -----------------
  app.use(createErrorHandler(logger));

  return app;
}
