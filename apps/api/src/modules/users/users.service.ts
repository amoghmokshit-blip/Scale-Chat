import { Injectable, NotFoundException } from '@nestjs/common';
import type { SelfUser, ProfileUpdateBody } from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getSelf(userId: string): Promise<SelfUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    }
    return toSelfDto(user);
  }

  async updateProfile(userId: string, patch: ProfileUpdateBody): Promise<SelfUser> {
    // `undefined` skips the field; `null` clears it. The zod schema enforces shape.
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: patch.fullName,
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        ...(patch.avatarUri !== undefined ? { avatarUri: patch.avatarUri } : {}),
      },
    });

    await this.prisma.securityEvent.create({
      data: {
        kind: 'PROFILE_UPDATED',
        userId,
        metadata: { fields: Object.keys(patch) },
      },
    });

    return toSelfDto(updated);
  }
}

// Pulled out so the controller never invents the shape of `SelfUser`.
function toSelfDto(row: {
  id: string;
  phoneE164: string;
  fullName: string;
  bio: string | null;
  avatarUri: string | null;
  isPremium: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SelfUser {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    fullName: row.fullName,
    bio: row.bio,
    avatarUri: row.avatarUri,
    isPremium: row.isPremium,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
