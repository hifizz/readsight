import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Relata 的所有持久化对象都隔离在专属 PostgreSQL schema 中。 */
export const relataSchema = pgSchema('relata');

// Better Auth tables use the property names that its Drizzle adapter expects.
export const user = relataSchema.table(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const session = relataSchema.table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = relataSchema.table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = relataSchema.table(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const rateLimit = relataSchema.table('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/** 所有消耗型 AI request 的用户级 UTC 日配额。 */
export const dailyUsage = relataSchema.table(
  'daily_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date').notNull(),
    metric: text('metric').notNull(),
    amount: integer('amount').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.usageDate, table.metric] })],
);

export const projects = relataSchema.table(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    unique('projects_id_user_id_unique').on(table.id, table.userId),
    index('projects_user_active_idx').on(table.userId, table.archivedAt, table.updatedAt),
  ],
);

export const sources = relataSchema.table(
  'sources',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    canonicalUrl: text('canonical_url').notNull(),
    originalUrl: text('original_url').notNull(),
    title: text('title').notNull(),
    faviconUrl: text('favicon_url'),
    sourceType: text('source_type').notNull().default('web'),
    metadata: jsonb('metadata').notNull().default({}),
    firstCapturedAt: timestamp('first_captured_at', { withTimezone: true }).notNull().defaultNow(),
    lastCapturedAt: timestamp('last_captured_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sources_id_user_id_unique').on(table.id, table.userId),
    uniqueIndex('sources_user_canonical_url_unique').on(table.userId, table.canonicalUrl),
    index('sources_user_last_captured_idx').on(table.userId, table.lastCapturedAt),
  ],
);

export const captures = relataSchema.table(
  'captures',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    clientRequestId: text('client_request_id').notNull(),
    captureMethod: text('capture_method').notNull(),
    capturedUrl: text('captured_url'),
    capturedTitle: text('captured_title'),
    capturedFaviconUrl: text('captured_favicon_url'),
    selection: jsonb('selection'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('captures_id_user_id_unique').on(table.id, table.userId),
    uniqueIndex('captures_user_client_request_unique').on(table.userId, table.clientRequestId),
    index('captures_source_captured_at_idx').on(table.sourceId, table.capturedAt),
    foreignKey({
      columns: [table.userId, table.sourceId],
      foreignColumns: [sources.userId, sources.id],
      name: 'captures_source_same_user_fk',
    }).onDelete('cascade'),
  ],
);

export const intents = relataSchema.table(
  'intents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    rawText: text('raw_text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('intents_capture_unique').on(table.captureId),
    index('intents_user_capture_idx').on(table.userId, table.captureId),
    foreignKey({
      columns: [table.userId, table.captureId],
      foreignColumns: [captures.userId, captures.id],
      name: 'intents_capture_same_user_fk',
    }).onDelete('cascade'),
  ],
);

export const projectSources = relataSchema.table(
  'project_sources',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    linkedViaCaptureId: text('linked_via_capture_id').references(() => captures.id, {
      onDelete: 'set null',
    }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    sortOrder: integer('sort_order'),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.sourceId] }),
    index('project_sources_user_source_idx').on(table.userId, table.sourceId),
    index('project_sources_user_project_idx').on(table.userId, table.projectId),
    foreignKey({
      columns: [table.userId, table.projectId],
      foreignColumns: [projects.userId, projects.id],
      name: 'project_sources_project_same_user_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.sourceId],
      foreignColumns: [sources.userId, sources.id],
      name: 'project_sources_source_same_user_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.linkedViaCaptureId],
      foreignColumns: [captures.userId, captures.id],
      name: 'project_sources_capture_same_user_fk',
    }).onDelete('set null'),
  ],
);

export const analysisRuns = relataSchema.table(
  'analysis_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    requestedByCaptureId: text('requested_by_capture_id').references(() => captures.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    extractionMetadata: jsonb('extraction_metadata').notNull().default({}),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('analysis_runs_id_user_id_unique').on(table.id, table.userId),
    index('analysis_runs_source_created_idx').on(table.userId, table.sourceId, table.createdAt),
    index('analysis_runs_status_idx').on(table.status, table.createdAt),
    foreignKey({ columns: [table.userId, table.sourceId], foreignColumns: [sources.userId, sources.id], name: 'analysis_runs_source_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.requestedByCaptureId], foreignColumns: [captures.userId, captures.id], name: 'analysis_runs_capture_same_user_fk' }),
    check('analysis_runs_status_check', sql`${table.status} in ('queued','running','completed','failed','cancelled')`),
  ],
);

export const sourceAnalyses = relataSchema.table(
  'source_analyses',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    analysisRunId: text('analysis_run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    summary: text('summary').notNull(),
    keyPoints: jsonb('key_points').notNull().default([]),
    topics: jsonb('topics').notNull().default([]),
    entities: jsonb('entities').notNull().default([]),
    contentType: text('content_type'),
    intentInterpretations: jsonb('intent_interpretations').notNull().default([]),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('source_analyses_id_user_id_unique').on(table.id, table.userId),
    unique('source_analyses_source_version_unique').on(table.sourceId, table.version),
    uniqueIndex('source_analyses_run_unique').on(table.analysisRunId),
    index('source_analyses_current_idx').on(table.userId, table.sourceId, table.version),
    foreignKey({ columns: [table.userId, table.sourceId], foreignColumns: [sources.userId, sources.id], name: 'source_analyses_source_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.analysisRunId], foreignColumns: [analysisRuns.userId, analysisRuns.id], name: 'source_analyses_run_same_user_fk' }).onDelete('cascade'),
  ],
);

export const projectInsights = relataSchema.table(
  'project_insights',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    sourceAnalysisId: text('source_analysis_id').notNull().references(() => sourceAnalyses.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    whyItMatters: text('why_it_matters').notNull(),
    implications: jsonb('implications').notNull().default([]),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('project_insights_id_user_id_unique').on(table.id, table.userId),
    unique('project_insights_version_unique').on(table.projectId, table.sourceId, table.version),
    index('project_insights_current_idx').on(table.userId, table.projectId, table.sourceId, table.version),
    foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [projects.userId, projects.id], name: 'project_insights_project_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.sourceId], foreignColumns: [sources.userId, sources.id], name: 'project_insights_source_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.sourceAnalysisId], foreignColumns: [sourceAnalyses.userId, sourceAnalyses.id], name: 'project_insights_analysis_same_user_fk' }).onDelete('cascade'),
  ],
);

export const threads = relataSchema.table(
  'threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    unique('threads_id_user_id_unique').on(table.id, table.userId),
    index('threads_context_idx').on(table.userId, table.sourceId, table.projectId, table.updatedAt),
    foreignKey({ columns: [table.userId, table.sourceId], foreignColumns: [sources.userId, sources.id], name: 'threads_source_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [projects.userId, projects.id], name: 'threads_project_same_user_fk' }).onDelete('cascade'),
    check('threads_context_check', sql`${table.sourceId} is not null or ${table.projectId} is not null`),
  ],
);

export const messages = relataSchema.table(
  'messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),
    sourceAnalysisId: text('source_analysis_id').references(() => sourceAnalyses.id, { onDelete: 'set null' }),
    projectInsightId: text('project_insight_id').references(() => projectInsights.id, { onDelete: 'set null' }),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('messages_id_user_id_unique').on(table.id, table.userId),
    index('messages_thread_created_idx').on(table.userId, table.threadId, table.createdAt),
    foreignKey({ columns: [table.userId, table.threadId], foreignColumns: [threads.userId, threads.id], name: 'messages_thread_same_user_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.userId, table.sourceAnalysisId], foreignColumns: [sourceAnalyses.userId, sourceAnalyses.id], name: 'messages_analysis_same_user_fk' }),
    foreignKey({ columns: [table.userId, table.projectInsightId], foreignColumns: [projectInsights.userId, projectInsights.id], name: 'messages_insight_same_user_fk' }),
    check('messages_role_check', sql`${table.role} in ('user','assistant','system','tool')`),
  ],
);
