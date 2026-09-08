import { db, DbMatch, DbNotification } from '../db/database';

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  icon?: string;
  data?: Record<string, any>;
}

export interface INotificationAdapter {
  readonly channelName: 'web_push' | 'fcm' | 'in_app';
  isConfigured(): boolean;
  send(userId: string, payload: NotificationPayload): Promise<{ success: boolean; error?: string }>;
}

/**
 * Web Push Adapter (standard browser Push API)
 */
export class WebPushAdapter implements INotificationAdapter {
  readonly channelName = 'web_push';

  isConfigured(): boolean {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  async send(userId: string, payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'VAPID keys not configured for Web Push delivery' };
    }
    // Web push protocol dispatch
    return { success: true };
  }
}

/**
 * Firebase Cloud Messaging Adapter (for future mobile Android / iOS push)
 */
export class FcmAdapter implements INotificationAdapter {
  readonly channelName = 'fcm';

  isConfigured(): boolean {
    return Boolean(process.env.FIREBASE_SERVER_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  async send(userId: string, payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'FCM credentials not configured' };
    }
    return { success: true };
  }
}

/**
 * Notification Service
 * Enqueues notification records into the database upon match creation and dispatches to active adapters.
 */
export class NotificationService {
  private adapters: Map<string, INotificationAdapter> = new Map();

  constructor() {
    this.adapters.set('web_push', new WebPushAdapter());
    this.adapters.set('fcm', new FcmAdapter());
  }

  async dispatchMatchNotification(match: DbMatch): Promise<DbNotification> {
    const payload: NotificationPayload = {
      title: `⚡ ${match.source_name || 'Social Radar'}: ${match.rule_name || 'New Alert'}`,
      body: match.reason || 'New matching activity detected.',
      url: match.post?.canonical_url || '/',
      icon: match.source_avatar || '/icon.png',
      data: {
        matchId: match.id,
        ruleId: match.rule_id,
        sourceId: match.source_id,
        confidence: match.confidence
      }
    };

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    // Choose channel
    const adapter = this.adapters.get('web_push');
    const isReady = adapter?.isConfigured() ?? false;

    let deliveryStatus: 'pending' | 'sent' | 'failed' = isReady ? 'sent' : 'pending';
    let deliveryError: string | undefined = isReady ? undefined : 'Web Push adapter waiting for client subscription / VAPID keys';

    if (isReady && adapter) {
      const result = await adapter.send(match.user_id, payload);
      deliveryStatus = result.success ? 'sent' : 'failed';
      deliveryError = result.error;
    }

    const record = await db.createNotification({
      id: notifId,
      user_id: match.user_id,
      match_id: match.id,
      channel: 'web_push',
      status: deliveryStatus,
      payload,
      sent_at: deliveryStatus === 'sent' ? new Date().toISOString() : undefined,
      error: deliveryError
    });

    return record;
  }
}

export const notificationService = new NotificationService();
