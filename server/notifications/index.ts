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
 * Notification delivery is deliberately honest in this phase: the project does not yet
 * persist browser PushSubscriptions or Android FCM registration tokens end-to-end, so
 * external adapters are not reported as configured/sent simply because a credential exists.
 */
export class WebPushAdapter implements INotificationAdapter {
  readonly channelName = 'web_push' as const;

  isConfigured(): boolean {
    return false;
  }

  async send(_userId: string, _payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Web Push delivery is not enabled until PushSubscription persistence and VAPID dispatch are implemented.'
    };
  }
}

export class FcmAdapter implements INotificationAdapter {
  readonly channelName = 'fcm' as const;

  isConfigured(): boolean {
    return false;
  }

  async send(_userId: string, _payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'FCM delivery is not enabled until Android device-token registration and authenticated server dispatch are implemented.'
    };
  }
}

export class NotificationService {
  private adapters: Map<string, INotificationAdapter> = new Map();

  constructor() {
    this.adapters.set('web_push', new WebPushAdapter());
    this.adapters.set('fcm', new FcmAdapter());
  }

  async dispatchMatchNotification(match: DbMatch): Promise<DbNotification> {
    const payload: NotificationPayload = {
      title: `${match.source_name || 'Social Radar'}: ${match.rule_name || 'New Alert'}`,
      body: match.reason || 'New matching activity detected.',
      url: match.post?.canonical_url || '/',
      icon: match.source_avatar || undefined,
      data: {
        matchId: match.id,
        ruleId: match.rule_id,
        sourceId: match.source_id,
        confidence: match.confidence
      }
    };

    // The match is immediately available through the in-app Alerts channel, so this specific
    // in_app delivery is accurately marked sent. This says nothing about FCM/Web Push: those
    // adapters remain unconfigured and cannot report success until real delivery exists.
    return await db.createNotification({
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      user_id: match.user_id,
      match_id: match.id,
      channel: 'in_app',
      status: 'sent',
      payload,
      sent_at: new Date().toISOString(),
      error: undefined
    });
  }

  async sendWithAdapter(channel: 'web_push' | 'fcm', userId: string, payload: NotificationPayload) {
    const adapter = this.adapters.get(channel);
    if (!adapter || !adapter.isConfigured()) {
      return { success: false, error: `${channel} adapter is not configured` };
    }
    return await adapter.send(userId, payload);
  }
}

export const notificationService = new NotificationService();
