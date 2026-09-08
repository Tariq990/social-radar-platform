import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export interface DbUser {
  id: string;
  email?: string;
  name?: string;
  tier: string;
  created_at: string;
  updated_at: string;
}

export interface DbSource {
  id: string;
  user_id: string;
  platform: 'facebook' | 'instagram';
  external_id: string;
  url: string;
  name: string;
  handle?: string;
  avatar_url?: string;
  bio?: string;
  visibility_type: 'public' | 'authenticated';
  connector_type: 'public_cloud' | 'device_session' | 'official_meta';
  connector_status: 'connected' | 'error' | 'needs_attention' | 'needs_relogin';
  is_paused: boolean;
  last_checked_at?: string;
  last_successful_check?: string;
  consecutive_failures: number;
  last_error?: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DbRule {
  id: string;
  user_id: string;
  name: string;
  natural_language: string;
  include_terms: string[];
  exclude_terms: string[];
  min_confidence: number;
  alert_mode: 'instant' | 'digest' | 'silent';
  enabled: boolean;
  collection_id?: string;
  source_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface DbPost {
  id: string;
  source_id: string;
  platform: 'facebook' | 'instagram';
  external_id?: string;
  canonical_url: string;
  author_name?: string;
  author_avatar?: string;
  text: string;
  media: any[];
  published_at?: string;
  fingerprint: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface DbMatch {
  id: string;
  user_id: string;
  post_id: string;
  rule_id: string;
  source_id: string;
  confidence: number;
  category: string;
  reason: string;
  extracted: Record<string, any>;
  feedback: 'unrated' | 'relevant' | 'not_relevant';
  is_read: boolean;
  is_saved: boolean;
  created_at: string;
  // Joined fields for display
  source_name?: string;
  source_avatar?: string;
  source_platform?: string;
  rule_name?: string;
  post?: DbPost;
}

export interface DbNotification {
  id: string;
  user_id: string;
  match_id: string;
  channel: 'web_push' | 'fcm' | 'in_app';
  status: 'pending' | 'sent' | 'failed';
  payload: Record<string, any>;
  sent_at?: string;
  error?: string;
  created_at: string;
}

export interface DbConnectorEvent {
  id: string;
  source_id: string;
  event_type: string;
  status: 'success' | 'warning' | 'error';
  message?: string;
  details?: Record<string, any>;
  created_at: string;
}

/**
 * Data Storage Engine
 * Connects to PostgreSQL if DATABASE_URL is available,
 * otherwise persists atomically to a local JSON database file.
 */
export class DatabaseRepository {
  private pool: pg.Pool | null = null;
  private isPostgres = false;
  private localFilePath: string;
  private memoryStore: {
    users: DbUser[];
    sources: DbSource[];
    rules: DbRule[];
    rule_sources: { id: string; rule_id: string; source_id: string; created_at: string }[];
    posts: DbPost[];
    matches: DbMatch[];
    notifications: DbNotification[];
    connector_events: DbConnectorEvent[];
  };

  constructor() {
    const dataDir = path.join(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        // Ignored
      }
    }
    this.localFilePath = path.join(dataDir, 'database.json');
    this.memoryStore = {
      users: [],
      sources: [],
      rules: [],
      rule_sources: [],
      posts: [],
      matches: [],
      notifications: [],
      connector_events: []
    };
  }

  async init(): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;

    if (dbUrl && dbUrl.trim().length > 0) {
      try {
        this.pool = new Pool({
          connectionString: dbUrl,
          ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
        });
        
        // Test connection
        const client = await this.pool.connect();
        try {
          // Run migration DDL
          const schemaPath = path.join(process.cwd(), 'server', 'db', 'schema.sql');
          if (fs.existsSync(schemaPath)) {
            const ddl = fs.readFileSync(schemaPath, 'utf8');
            await client.query(ddl);
            console.log('[Database] PostgreSQL schema migration executed successfully.');
          }
          this.isPostgres = true;
          console.log('[Database] Connected to PostgreSQL at', dbUrl.split('@')[1] || 'remote instance');
        } finally {
          client.release();
        }
        return;
      } catch (err) {
        console.warn('[Database] PostgreSQL connection failed, falling back to local persistent store:', (err as any)?.message);
        this.pool = null;
        this.isPostgres = false;
      }
    }

    // Local file persistence initialization
    this.loadFromDisk();
    console.log('[Database] Local persistent store loaded from', this.localFilePath);

    // Ensure default user exists
    if (!this.memoryStore.users.some(u => u.id === 'user_default')) {
      this.memoryStore.users.push({
        id: 'user_default',
        email: 'user@mrscrap.app',
        name: 'Radar Operator',
        tier: 'pro',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      this.saveToDisk();
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.localFilePath)) {
        const raw = fs.readFileSync(this.localFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.memoryStore = {
          users: parsed.users || [],
          sources: parsed.sources || [],
          rules: parsed.rules || [],
          rule_sources: parsed.rule_sources || [],
          posts: parsed.posts || [],
          matches: parsed.matches || [],
          notifications: parsed.notifications || [],
          connector_events: parsed.connector_events || []
        };
      }
    } catch (e) {
      console.error('[Database] Failed to read local storage file, starting fresh', e);
    }
  }

  private saveToDisk(): void {
    try {
      const tempPath = `${this.localFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.memoryStore, null, 2), 'utf8');
      fs.renameSync(tempPath, this.localFilePath);
    } catch (e) {
      console.error('[Database] Failed to persist data to disk', e);
    }
  }

  isUsingPostgres(): boolean {
    return this.isPostgres;
  }

  // ================= SOURCES =================

  async getSources(userId: string = 'user_default'): Promise<DbSource[]> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'SELECT * FROM sources WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return res.rows;
    }
    return this.memoryStore.sources.filter(s => s.user_id === userId);
  }

  async getSource(id: string): Promise<DbSource | null> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query('SELECT * FROM sources WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return this.memoryStore.sources.find(s => s.id === id) || null;
  }

  async findSourceByExternalId(userId: string, platform: string, externalId: string): Promise<DbSource | null> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'SELECT * FROM sources WHERE user_id = $1 AND platform = $2 AND external_id = $3',
        [userId, platform, externalId]
      );
      return res.rows[0] || null;
    }
    return this.memoryStore.sources.find(
      s => s.user_id === userId && s.platform === platform && s.external_id === externalId
    ) || null;
  }

  async createSource(source: Omit<DbSource, 'created_at' | 'updated_at'>): Promise<DbSource> {
    const now = new Date().toISOString();
    const fullSource: DbSource = {
      ...source,
      created_at: now,
      updated_at: now
    };

    if (this.isPostgres && this.pool) {
      const query = `
        INSERT INTO sources (
          id, user_id, platform, external_id, url, name, handle, avatar_url, bio,
          visibility_type, connector_type, connector_status, is_paused,
          consecutive_failures, metadata, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (user_id, platform, external_id) DO UPDATE SET
          name = EXCLUDED.name,
          avatar_url = EXCLUDED.avatar_url,
          url = EXCLUDED.url,
          updated_at = EXCLUDED.updated_at
        RETURNING *;
      `;
      const res = await this.pool.query(query, [
        fullSource.id, fullSource.user_id, fullSource.platform, fullSource.external_id,
        fullSource.url, fullSource.name, fullSource.handle || null, fullSource.avatar_url || null,
        fullSource.bio || null, fullSource.visibility_type, fullSource.connector_type,
        fullSource.connector_status, fullSource.is_paused, fullSource.consecutive_failures,
        JSON.stringify(fullSource.metadata || {}), now, now
      ]);
      return res.rows[0];
    }

    const existingIndex = this.memoryStore.sources.findIndex(
      s => s.user_id === source.user_id && s.platform === source.platform && s.external_id === source.external_id
    );
    if (existingIndex >= 0) {
      this.memoryStore.sources[existingIndex] = {
        ...this.memoryStore.sources[existingIndex],
        ...fullSource,
        id: this.memoryStore.sources[existingIndex].id
      };
      this.saveToDisk();
      return this.memoryStore.sources[existingIndex];
    }

    this.memoryStore.sources.unshift(fullSource);
    this.saveToDisk();
    return fullSource;
  }

  async updateSourceHealth(
    id: string,
    status: 'connected' | 'error' | 'needs_attention',
    success: boolean,
    errorMsg?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (this.isPostgres && this.pool) {
      if (success) {
        await this.pool.query(`
          UPDATE sources SET
            connector_status = $2,
            last_checked_at = $3,
            last_successful_check = $3,
            consecutive_failures = 0,
            last_error = NULL,
            updated_at = $3
          WHERE id = $1
        `, [id, status, now]);
      } else {
        await this.pool.query(`
          UPDATE sources SET
            connector_status = $2,
            last_checked_at = $3,
            consecutive_failures = consecutive_failures + 1,
            last_error = $4,
            updated_at = $3
          WHERE id = $1
        `, [id, status, now, errorMsg || null]);
      }
      return;
    }

    const src = this.memoryStore.sources.find(s => s.id === id);
    if (src) {
      src.connector_status = status;
      src.last_checked_at = now;
      src.updated_at = now;
      if (success) {
        src.last_successful_check = now;
        src.consecutive_failures = 0;
        src.last_error = undefined;
      } else {
        src.consecutive_failures = (src.consecutive_failures || 0) + 1;
        src.last_error = errorMsg;
      }
      this.saveToDisk();
    }
  }

  async toggleSourcePause(id: string): Promise<boolean> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'UPDATE sources SET is_paused = NOT is_paused, updated_at = NOW() WHERE id = $1 RETURNING is_paused',
        [id]
      );
      return res.rows[0]?.is_paused ?? false;
    }
    const src = this.memoryStore.sources.find(s => s.id === id);
    if (src) {
      src.is_paused = !src.is_paused;
      src.updated_at = new Date().toISOString();
      this.saveToDisk();
      return src.is_paused;
    }
    return false;
  }

  async deleteSource(id: string): Promise<void> {
    if (this.isPostgres && this.pool) {
      await this.pool.query('DELETE FROM sources WHERE id = $1', [id]);
      return;
    }
    this.memoryStore.sources = this.memoryStore.sources.filter(s => s.id !== id);
    this.memoryStore.rule_sources = this.memoryStore.rule_sources.filter(rs => rs.source_id !== id);
    this.memoryStore.posts = this.memoryStore.posts.filter(p => p.source_id !== id);
    this.memoryStore.matches = this.memoryStore.matches.filter(m => m.source_id !== id);
    this.saveToDisk();
  }

  // ================= RULES =================

  async getRules(userId: string = 'user_default'): Promise<DbRule[]> {
    if (this.isPostgres && this.pool) {
      const query = `
        SELECT r.*,
          COALESCE(
            json_agg(rs.source_id) FILTER (WHERE rs.source_id IS NOT NULL),
            '[]'::json
          ) as source_ids
        FROM rules r
        LEFT JOIN rule_sources rs ON r.id = rs.rule_id
        WHERE r.user_id = $1
        GROUP BY r.id
        ORDER BY r.created_at DESC;
      `;
      const res = await this.pool.query(query, [userId]);
      return res.rows.map(row => ({
        ...row,
        include_terms: Array.isArray(row.include_terms) ? row.include_terms : [],
        exclude_terms: Array.isArray(row.exclude_terms) ? row.exclude_terms : [],
        source_ids: Array.isArray(row.source_ids) ? row.source_ids : []
      }));
    }

    return this.memoryStore.rules
      .filter(r => r.user_id === userId)
      .map(r => {
        const sourceIds = this.memoryStore.rule_sources
          .filter(rs => rs.rule_id === r.id)
          .map(rs => rs.source_id);
        return { ...r, source_ids: sourceIds };
      });
  }

  async createRule(rule: Omit<DbRule, 'created_at' | 'updated_at'>, sourceIds: string[] = []): Promise<DbRule> {
    const now = new Date().toISOString();
    const fullRule: DbRule = {
      ...rule,
      source_ids: sourceIds,
      created_at: now,
      updated_at: now
    };

    if (this.isPostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const ruleQuery = `
          INSERT INTO rules (
            id, user_id, name, natural_language, include_terms, exclude_terms,
            min_confidence, alert_mode, enabled, collection_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *;
        `;
        const res = await client.query(ruleQuery, [
          fullRule.id, fullRule.user_id, fullRule.name, fullRule.natural_language,
          JSON.stringify(fullRule.include_terms || []), JSON.stringify(fullRule.exclude_terms || []),
          fullRule.min_confidence, fullRule.alert_mode, fullRule.enabled,
          fullRule.collection_id || null, now, now
        ]);

        for (const sId of sourceIds) {
          const mapId = `rs_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          await client.query(
            'INSERT INTO rule_sources (id, rule_id, source_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [mapId, fullRule.id, sId]
          );
        }

        await client.query('COMMIT');
        return {
          ...res.rows[0],
          include_terms: fullRule.include_terms,
          exclude_terms: fullRule.exclude_terms,
          source_ids: sourceIds
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    this.memoryStore.rules.unshift(fullRule);
    for (const sId of sourceIds) {
      this.memoryStore.rule_sources.push({
        id: `rs_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        rule_id: fullRule.id,
        source_id: sId,
        created_at: now
      });
    }
    this.saveToDisk();
    return fullRule;
  }

  async toggleRule(id: string): Promise<boolean> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'UPDATE rules SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING enabled',
        [id]
      );
      return res.rows[0]?.enabled ?? false;
    }
    const rule = this.memoryStore.rules.find(r => r.id === id);
    if (rule) {
      rule.enabled = !rule.enabled;
      rule.updated_at = new Date().toISOString();
      this.saveToDisk();
      return rule.enabled;
    }
    return false;
  }

  async deleteRule(id: string): Promise<void> {
    if (this.isPostgres && this.pool) {
      await this.pool.query('DELETE FROM rules WHERE id = $1', [id]);
      return;
    }
    this.memoryStore.rules = this.memoryStore.rules.filter(r => r.id !== id);
    this.memoryStore.rule_sources = this.memoryStore.rule_sources.filter(rs => rs.rule_id !== id);
    this.saveToDisk();
  }

  // ================= POSTS & DEDUPLICATION =================

  async hasPostFingerprint(fingerprint: string): Promise<boolean> {
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'SELECT 1 FROM posts WHERE fingerprint = $1 LIMIT 1',
        [fingerprint]
      );
      return (res.rowCount ?? 0) > 0;
    }
    return this.memoryStore.posts.some(p => p.fingerprint === fingerprint);
  }

  async createPost(post: Omit<DbPost, 'created_at'>): Promise<DbPost> {
    const now = new Date().toISOString();
    const fullPost: DbPost = {
      ...post,
      created_at: now
    };

    if (this.isPostgres && this.pool) {
      const query = `
        INSERT INTO posts (
          id, source_id, platform, external_id, canonical_url,
          author_name, author_avatar, text, media, published_at,
          fingerprint, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (fingerprint) DO UPDATE SET updated_at = NOW()
        RETURNING *;
      `;
      const res = await this.pool.query(query, [
        fullPost.id, fullPost.source_id, fullPost.platform, fullPost.external_id || null,
        fullPost.canonical_url, fullPost.author_name || null, fullPost.author_avatar || null,
        fullPost.text, JSON.stringify(fullPost.media || []), fullPost.published_at || null,
        fullPost.fingerprint, JSON.stringify(fullPost.metadata || {}), now
      ]);
      return res.rows[0];
    }

    const existingIndex = this.memoryStore.posts.findIndex(p => p.fingerprint === post.fingerprint);
    if (existingIndex >= 0) {
      return this.memoryStore.posts[existingIndex];
    }

    this.memoryStore.posts.unshift(fullPost);
    this.saveToDisk();
    return fullPost;
  }

  // ================= MATCHES =================

  async getMatches(userId: string = 'user_default'): Promise<DbMatch[]> {
    if (this.isPostgres && this.pool) {
      const query = `
        SELECT 
          m.*,
          s.name as source_name,
          s.avatar_url as source_avatar,
          s.platform as source_platform,
          r.name as rule_name,
          row_to_json(p.*) as post
        FROM matches m
        JOIN sources s ON m.source_id = s.id
        JOIN rules r ON m.rule_id = r.id
        JOIN posts p ON m.post_id = p.id
        WHERE m.user_id = $1
        ORDER BY m.created_at DESC;
      `;
      const res = await this.pool.query(query, [userId]);
      return res.rows.map(row => ({
        ...row,
        confidence: Number(row.confidence),
        extracted: row.extracted || {}
      }));
    }

    return this.memoryStore.matches
      .filter(m => m.user_id === userId)
      .map(m => {
        const source = this.memoryStore.sources.find(s => s.id === m.source_id);
        const rule = this.memoryStore.rules.find(r => r.id === m.rule_id);
        const post = this.memoryStore.posts.find(p => p.id === m.post_id);
        return {
          ...m,
          source_name: source?.name || 'Monitored Page',
          source_avatar: source?.avatar_url,
          source_platform: source?.platform || 'facebook',
          rule_name: rule?.name || 'Watch Rule',
          post
        };
      });
  }

  async createMatch(match: Omit<DbMatch, 'created_at'>): Promise<DbMatch> {
    const now = new Date().toISOString();
    const fullMatch: DbMatch = {
      ...match,
      created_at: now
    };

    if (this.isPostgres && this.pool) {
      const query = `
        INSERT INTO matches (
          id, user_id, post_id, rule_id, source_id,
          confidence, category, reason, extracted, feedback,
          is_read, is_saved, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (rule_id, post_id) DO NOTHING
        RETURNING *;
      `;
      const res = await this.pool.query(query, [
        fullMatch.id, fullMatch.user_id, fullMatch.post_id, fullMatch.rule_id, fullMatch.source_id,
        fullMatch.confidence, fullMatch.category, fullMatch.reason, JSON.stringify(fullMatch.extracted || {}),
        fullMatch.feedback || 'unrated', fullMatch.is_read || false, fullMatch.is_saved || false, now
      ]);
      if (res.rows.length > 0) {
        return res.rows[0];
      }
      return fullMatch;
    }

    const existing = this.memoryStore.matches.find(
      m => m.rule_id === match.rule_id && m.post_id === match.post_id
    );
    if (existing) {
      return existing;
    }

    this.memoryStore.matches.unshift(fullMatch);
    this.saveToDisk();
    return fullMatch;
  }

  async updateMatch(id: string, updates: Partial<Pick<DbMatch, 'feedback' | 'is_read' | 'is_saved'>>): Promise<void> {
    if (this.isPostgres && this.pool) {
      const sets: string[] = [];
      const values: any[] = [id];
      let idx = 2;

      if (updates.feedback !== undefined) {
        sets.push(`feedback = $${idx++}`);
        values.push(updates.feedback);
      }
      if (updates.is_read !== undefined) {
        sets.push(`is_read = $${idx++}`);
        values.push(updates.is_read);
      }
      if (updates.is_saved !== undefined) {
        sets.push(`is_saved = $${idx++}`);
        values.push(updates.is_saved);
      }

      if (sets.length > 0) {
        await this.pool.query(`UPDATE matches SET ${sets.join(', ')} WHERE id = $1`, values);
      }
      return;
    }

    const m = this.memoryStore.matches.find(item => item.id === id);
    if (m) {
      if (updates.feedback !== undefined) m.feedback = updates.feedback;
      if (updates.is_read !== undefined) m.is_read = updates.is_read;
      if (updates.is_saved !== undefined) m.is_saved = updates.is_saved;
      this.saveToDisk();
    }
  }

  // ================= NOTIFICATIONS =================

  async createNotification(notif: Omit<DbNotification, 'created_at'>): Promise<DbNotification> {
    const now = new Date().toISOString();
    const full: DbNotification = {
      ...notif,
      created_at: now
    };

    if (this.isPostgres && this.pool) {
      await this.pool.query(`
        INSERT INTO notifications (id, user_id, match_id, channel, status, payload, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [full.id, full.user_id, full.match_id, full.channel, full.status, JSON.stringify(full.payload), now]);
      return full;
    }

    this.memoryStore.notifications.unshift(full);
    this.saveToDisk();
    return full;
  }

  // ================= CONNECTOR EVENTS =================

  async logConnectorEvent(
    sourceId: string,
    eventType: string,
    status: 'success' | 'warning' | 'error',
    message?: string,
    details?: Record<string, any>
  ): Promise<void> {
    const id = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();

    if (this.isPostgres && this.pool) {
      await this.pool.query(`
        INSERT INTO connector_events (id, source_id, event_type, status, message, details, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [id, sourceId, eventType, status, message || null, JSON.stringify(details || {}), now]);
      return;
    }

    this.memoryStore.connector_events.unshift({
      id,
      source_id: sourceId,
      event_type: eventType,
      status,
      message,
      details,
      created_at: now
    });
    // Keep max 200 events in memory
    if (this.memoryStore.connector_events.length > 200) {
      this.memoryStore.connector_events = this.memoryStore.connector_events.slice(0, 200);
    }
    this.saveToDisk();
  }
}

export const db = new DatabaseRepository();
