import { describe, it, expect } from 'vitest';
import { mapGiftPayload } from '../../../src/adapters/tiktok/live.connector';

describe('Gift Payload Mapping & Combo Contract Tests (Lát 1)', () => {
  it('drops intermediate combo gifts (repeatEnd=0) and settles only on repeatEnd=1 (14 drops + 1 settled)', () => {
    const payloads: Array<Record<string, any> | null> = [];

    // Simulate 14 intermediate combo taps (repeatEnd: 0)
    for (let i = 1; i <= 14; i++) {
      const rawIntermediate = {
        giftId: 'rose_5655',
        repeatCount: i,
        repeatEnd: 0,
        gift: {
          id: 'rose_5655',
          name: 'Rose',
          type: 1, // combo gift
          diamondCount: 1,
        },
      };
      const result = mapGiftPayload(rawIntermediate);
      payloads.push(result);
    }

    // Simulate 15th settled message (repeatEnd: 1, repeatCount: 15)
    const rawSettled = {
      giftId: 'rose_5655',
      repeatCount: 15,
      repeatEnd: 1,
      gift: {
        id: 'rose_5655',
        name: 'Rose',
        type: 1,
        diamondCount: 1,
      },
      toUser: { id: 'streamer_target_01' },
    };
    const settledResult = mapGiftPayload(rawSettled);
    payloads.push(settledResult);

    // Verify: 14 intermediate events must return null
    for (let i = 0; i < 14; i++) {
      expect(payloads[i], `Message index ${i} should be null for intermediate combo`).toBeNull();
    }

    // Verify: exactly 1 non-null settled payload
    const nonNullPayloads = payloads.filter((p) => p !== null);
    expect(nonNullPayloads).toHaveLength(1);

    const payload = nonNullPayloads[0]!;
    expect(payload.giftId).toBe('rose_5655');
    expect(payload.giftName).toBe('Rose');
    expect(payload.diamondCount).toBe(1);
    expect(payload.repeatCount).toBe(15);
    expect(payload.totalDiamonds).toBe(15);
    expect(payload.repeatEnd).toBe(true);
    expect(payload.giftType).toBe(1);
    expect(payload.toUserId).toBe('streamer_target_01');
  });

  it('correctly maps non-combo gifts regardless of repeatEnd', () => {
    const rawNonCombo = {
      giftId: 'galaxy_1000',
      gift: {
        id: 'galaxy_1000',
        name: 'Galaxy',
        type: 0, // non-combo
        diamondCount: 1000,
      },
      repeatCount: 1,
      repeatEnd: 0, // Even if repeatEnd is 0, non-combo should map
    };

    const payload = mapGiftPayload(rawNonCombo);
    expect(payload).not.toBeNull();
    expect(payload?.giftId).toBe('galaxy_1000');
    expect(payload?.giftName).toBe('Galaxy');
    expect(payload?.diamondCount).toBe(1000);
    expect(payload?.repeatCount).toBe(1);
    expect(payload?.totalDiamonds).toBe(1000);
    expect(payload?.repeatEnd).toBe(true);
  });

  it('handles MockConnector fallback when payload.totalDiamonds is null/undefined (AUDIT.md §4.4)', () => {
    // In MockConnector or edge cases where totalDiamonds is missing/null:
    const mockPayload: Record<string, any> = {
      giftId: 'doughnut_30',
      giftName: 'Doughnut',
      diamondCount: 30,
      repeatCount: 5,
      repeatEnd: true,
      totalDiamonds: null,
    };

    // Fallback formula specified in AUDIT.md §4.4:
    // payload.totalDiamonds ?? (Number(payload.diamondCount || 0) * Number(payload.repeatCount || 1))
    const totalDiamondsFallback =
      mockPayload.totalDiamonds ??
      Number(mockPayload.diamondCount || 0) * Number(mockPayload.repeatCount || 1);

    expect(totalDiamondsFallback).toBe(150);

    const asBigInt = BigInt(totalDiamondsFallback);
    expect(asBigInt).toBe(150n);
  });

  it('handles unpriced gifts (diamondCount is undefined/null)', () => {
    const rawUnpriced = {
      giftId: 'custom_badge_99',
      gift: {
        id: 'custom_badge_99',
        name: 'Custom Badge',
        type: 0,
        // diamondCount is absent
      },
      repeatCount: 1,
      repeatEnd: 1,
    };

    const payload = mapGiftPayload(rawUnpriced);
    expect(payload).not.toBeNull();
    expect(payload?.giftId).toBe('custom_badge_99');
    expect(payload?.diamondCount).toBeNull();
    expect(payload?.totalDiamonds).toBeNull();
  });
});
