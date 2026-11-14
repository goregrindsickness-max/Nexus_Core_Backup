import { describe, it, expect } from 'vitest';
import {
  isIndustryChecklistRole,
  resolveOnboardingChecklistSteps,
  calculateChecklistSummary,
  getChecklistPersistedState,
  setChecklistMinimized,
  dismissChecklistConfirmed,
  setShowSetupChecklist,
  syncCompletionAndPioneerBadge,
  hasScenePioneerBadge,
  SCENE_PIONEER_BADGE_LABEL,
} from '../../components/OnboardingChecklist';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('INVARIANT: Role-Aware Profile Activation Checklist & Persistence', () => {
  it('resolves Fan role vs. Industry roles (Artist/Band, Venue, Promoter, Label, Creative) accurately', () => {
    expect(isIndustryChecklistRole('fan')).toBe(false);
    expect(isIndustryChecklistRole('fan_only')).toBe(false);
    expect(isIndustryChecklistRole(undefined, { account_type: 'fan_only' })).toBe(false);

    for (const industryRole of ['band', 'artist', 'venue', 'promoter', 'label', 'creative', 'industry_pro']) {
      expect(isIndustryChecklistRole(industryRole)).toBe(true);
    }

    const fanSteps = resolveOnboardingChecklistSteps({ role: 'fan_only' });
    expect(fanSteps).toHaveLength(6);
    expect(fanSteps[0].id).toBe('account_created');
    expect(fanSteps[0].completed).toBe(true); // Endowed progress: always pre-checked
    expect(fanSteps[4].id).toBe('fan_first_post_or_reply');
    expect(fanSteps[4].label).toContain('Make your first post or forum reply');
    expect(fanSteps[5].id).toBe('fan_bookmark_rsvp_show');
    expect(fanSteps[5].label).toContain('Bookmark/RSVP to an upcoming show');

    const industrySteps = resolveOnboardingChecklistSteps({ role: 'band' });
    expect(industrySteps).toHaveLength(6);
    expect(industrySteps[0].id).toBe('account_created');
    expect(industrySteps[0].completed).toBe(true);
    expect(industrySteps[4].id).toBe('industry_create_claim_entity');
    expect(industrySteps[4].label).toContain('Create or claim a Band/Venue/Brand entity page');
    expect(industrySteps[5].id).toBe('industry_publish_flyer_track_merch');
    expect(industrySteps[5].label).toContain('Publish your first show flyer, track/clip, or merch listing');
  });

  it('enforces exact auto-completion thresholds across all 6 steps', () => {
    // Only avatar uploaded (no cover) & only 2 circles subscribed -> Steps 2 and 3 remain incomplete
    const partialSteps = resolveOnboardingChecklistSteps({
      role: 'fan',
      avatar_url: 'https://example.com/avatar.jpg',
      cover_url: '',
      subscribedCircles: ['Death Metal', 'Grindcore'],
      pushEnabled: false,
      hasFirstPostOrReply: false,
      hasBookmarkedOrRsvpedShow: false,
    });

    expect(partialSteps[0].completed).toBe(true); // Step 1 pre-checked
    expect(partialSteps[1].completed).toBe(false); // Requires BOTH avatar_url && cover_url
    expect(partialSteps[2].completed).toBe(false); // Requires >= 3 circles
    expect(partialSteps[3].completed).toBe(false);

    const partialSummary = calculateChecklistSummary(partialSteps);
    expect(partialSummary.completedCount).toBe(1);
    expect(partialSummary.totalCount).toBe(6);
    expect(partialSummary.percentage).toBe(17);
    expect(partialSummary.pillLabel).toBe('Profile Setup • 1/6 (17%)');
    expect(partialSummary.isComplete).toBe(false);

    // 3/6 completed (50% pill label check)
    const halfSteps = resolveOnboardingChecklistSteps({
      role: 'fan',
      avatar_url: 'https://example.com/avatar.jpg',
      cover_url: 'https://example.com/cover.jpg',
      subscribedCircles: ['Death Metal', 'Black Metal', 'Grindcore'],
      pushEnabled: false,
      hasFirstPostOrReply: false,
      hasBookmarkedOrRsvpedShow: false,
    });
    const halfSummary = calculateChecklistSummary(halfSteps);
    expect(halfSummary.completedCount).toBe(3);
    expect(halfSummary.percentage).toBe(50);
    expect(halfSummary.pillLabel).toBe('Profile Setup • 3/6 (50%)');
  });

  it('unlocks Scene Pioneer badge and auto-collapses when all 6 steps reach 100%', () => {
    const storage = createMemoryStorage();
    const userKey = 'pioneer_user_1';

    const completeSteps = resolveOnboardingChecklistSteps({
      role: 'promoter',
      avatar_url: 'https://example.com/avatar.jpg',
      cover_url: 'https://example.com/cover.jpg',
      subscribedCircles: ['Death Metal', 'Black Metal', 'Grindcore', 'Doom'],
      pushEnabled: true,
      hasCreatedOrClaimedEntity: true,
      hasPublishedFlyerTrackOrMerch: true,
    });

    const summary = calculateChecklistSummary(completeSteps);
    expect(summary.completedCount).toBe(6);
    expect(summary.percentage).toBe(100);
    expect(summary.isComplete).toBe(true);
    expect(summary.unlockedBadge).toBe(SCENE_PIONEER_BADGE_LABEL);

    const syncedState = syncCompletionAndPioneerBadge(userKey, summary, storage);
    expect(syncedState.scenePioneerUnlocked).toBe(true);
    expect(syncedState.autoCollapsedOnComplete).toBe(true);
    expect(syncedState.minimized).toBe(true);
    expect(hasScenePioneerBadge({ id: userKey }, storage)).toBe(true);
  });

  it('persists minimize, confirmed dismissal, and Profile Settings restore state cleanly', () => {
    const storage = createMemoryStorage();
    const userKey = 'user_settings_test';

    // Default state
    expect(getChecklistPersistedState(userKey, storage)).toEqual({
      minimized: false,
      dismissed: false,
      scenePioneerUnlocked: false,
      autoCollapsedOnComplete: false,
    });

    // Minimize into compact pill
    setChecklistMinimized(userKey, true, storage);
    expect(getChecklistPersistedState(userKey, storage).minimized).toBe(true);

    // Dismiss after confirmation dialog
    dismissChecklistConfirmed(userKey, storage);
    expect(getChecklistPersistedState(userKey, storage).dismissed).toBe(true);

    // Restore from Profile Settings ("Show Setup Checklist" toggle)
    setShowSetupChecklist(userKey, true, storage);
    const restored = getChecklistPersistedState(userKey, storage);
    expect(restored.dismissed).toBe(false);
    expect(restored.minimized).toBe(false);
  });
});
