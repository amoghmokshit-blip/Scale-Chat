import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env';
import type { CallKind, DevicePlatform } from '@scalechat/shared';

/** Expo push send endpoint (HTTPS POST — no SDK; the official SDK is ESM-only
 * and won't load in this CommonJS Nest app). */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Data payload routed to the IncomingCallScreen when a call push is received/tapped. */
export type CallPushPayload = {
  callId: string;
  chatId: string;
  kind: CallKind;
  roomName: string;
  initiatorName: string;
  ringExpiresAt: string;
};

function isExpoPushToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

/**
 * Push fan-out (Tranche 2.I). v1 sends inline via `fetch` (no BullMQ queue, no
 * SDK) — a 1-on-1 call wakes exactly ONE callee with a handful of devices. The
 * socket `call:ring` covers online devices; push is the best-effort wakeup for
 * backgrounded ones, and is NEVER suppressed by mute (a ringing call must ring).
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private readonly accessToken: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.accessToken = config.get('EXPO_ACCESS_TOKEN', { infer: true }) || undefined;
  }

  /** Upsert a device's push token (token is the natural key; reassigns userId on reinstall). */
  async registerToken(userId: string, expoPushToken: string, platform: DevicePlatform): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: { expoPushToken },
      create: { userId, expoPushToken, platform },
      update: { userId, platform, lastActiveAt: new Date() },
    });
  }

  async removeToken(expoPushToken: string): Promise<void> {
    await this.prisma.userDevice.deleteMany({ where: { expoPushToken } });
  }

  /** Wake the callee for an incoming call (always — never mute-suppressed). */
  async notifyCall(calleeUserId: string, payload: CallPushPayload): Promise<void> {
    const devices = await this.prisma.userDevice.findMany({ where: { userId: calleeUserId } });
    const valid = devices.filter((d) => isExpoPushToken(d.expoPushToken));
    if (valid.length === 0) return;

    const messages = valid.map((d) => ({
      to: d.expoPushToken,
      priority: 'high' as const,
      channelId: 'calls',
      title: `Incoming ${payload.kind === 'VIDEO' ? 'video' : 'voice'} call`,
      body: payload.initiatorName,
      sound: 'default',
      ttl: 30,
      data: { type: 'call:ring', ...payload },
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.log.warn({ status: res.status, calleeUserId }, 'expo push send non-ok (non-fatal)');
        return;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      for (let i = 0; i < tickets.length; i += 1) {
        if (tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered') {
          await this.prisma.userDevice.deleteMany({ where: { expoPushToken: valid[i].expoPushToken } });
          this.log.debug({ token: valid[i].expoPushToken }, 'pruned DeviceNotRegistered push token');
        }
      }
    } catch (err) {
      this.log.warn({ err, calleeUserId }, 'notifyCall push send failed (non-fatal)');
    }
  }
}
