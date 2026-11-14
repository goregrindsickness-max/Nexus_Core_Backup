import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  syncCommunityShowToCloud,
  reconcilePendingCommunityShows,
} from '@/src/services/communityShowSyncService';
import {
  getOfflineQueue,
  saveOfflineQueue,
} from '@/src/services/offlineSyncService';
import { ensureUUID } from '@/src/services/schemaResilienceService';
import {
  seedSupabaseTable,
  getSupabaseTableRows,
  setMockAuthSession,
  resetSupabaseMockStore,
} from '@/src/__tests__/mocks/supabaseMock';

describe('Invariant 5: Community Show Cloud Sync & Stranded Local Show Reconciliation', () => {
  const AUTH_USER_ID = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    resetSupabaseMockStore();
    saveOfflineQueue([]);
    localStorage.clear();
  });

  it('stamps active authenticated auth.uid() over placeholder creator_id so RLS passes and clears _pendingCloudSync', async () => {
    const showId = ensureUUID('sh_comm_apk_test_1');

    localStorage.setItem(
      'nexus_core_shows_extended',
      JSON.stringify({
        [showId]: {
          id: showId,
          headliner: 'Suffocation',
          venue_name: 'Nile Theater',
          city: 'Mesa',
          state_province: 'AZ',
          date: '2026-12-18',
          is_community_submitted: true,
          _pendingCloudSync: true,
        },
      })
    );

    const res = await syncCommunityShowToCloud({
      id: showId,
      creator_id: 'community_curator', // placeholder string that previously broke RLS
      headliner: 'Suffocation',
      name: 'Suffocation',
      venue_name: 'Nile Theater',
      city: 'Mesa',
      state_province: 'AZ',
      date: '2026-12-18',
      is_community_submitted: true,
    });

    expect(res.synced).toBe(true);
    expect(res.error).toBeNull();
    expect(res.queuedOffline).toBe(false);

    const rows = getSupabaseTableRows('shows');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(showId);
    expect(rows[0].creator_id).toBe(AUTH_USER_ID);
    expect(rows[0].is_community_submitted).toBe(true);

    const extMap = JSON.parse(localStorage.getItem('nexus_core_shows_extended') || '{}');
    expect(extMap[showId]._pendingCloudSync).toBe(false);
    expect(extMap[showId]._syncedToCloudAt).toBeTruthy();
  });

  it('flags _pendingCloudSync and enqueues offline write when active Supabase session is missing on APK', async () => {
    setMockAuthSession(null);
    const { ensureValidSupabaseAuthSession } = await import('@/src/lib/supabaseClient');
    (ensureValidSupabaseAuthSession as any).mockResolvedValueOnce(null);

    const showId = ensureUUID('sh_comm_apk_offline_1');
    const res = await syncCommunityShowToCloud({
      id: showId,
      headliner: 'Cryptopsy',
      name: 'Cryptopsy',
      venue_name: 'Trees',
      city: 'Dallas',
      state_province: 'TX',
      date: '2026-12-20',
      is_community_submitted: true,
    });

    expect(res.synced).toBe(false);
    expect(res.queuedOffline).toBe(true);
    expect(getOfflineQueue()).toHaveLength(1);
    expect(getOfflineQueue()[0].table).toBe('shows');
    expect(getOfflineQueue()[0].action).toBe('upsert');

    const extMap = JSON.parse(localStorage.getItem('nexus_core_shows_extended') || '{}');
    expect(extMap[showId]._pendingCloudSync).toBe(true);
  });

  it('reconciles stranded local community shows missing from Supabase while respecting deleted show blacklists', async () => {
    const showA = ensureUUID('sh_comm_stranded_1');
    const showB = ensureUUID('sh_comm_stranded_2');
    const deletedShow = ensureUUID('sh_comm_deleted_1');
    const alreadySyncedShow = ensureUUID('sh_comm_already_synced');

    seedSupabaseTable('shows', [
      {
        id: alreadySyncedShow,
        headliner: 'Nile',
        show_name: 'Nile',
        venue_name: 'AM/FM',
        city: 'Dallas',
        date: '2027-03-05',
        is_community_submitted: true,
      },
    ]);

    localStorage.setItem(
      'nexus_created_show_ids',
      JSON.stringify([showA, showB, deletedShow, alreadySyncedShow])
    );

    localStorage.setItem(
      'nexus_core_shows_extended',
      JSON.stringify({
        [showA]: {
          id: showA,
          headliner: 'Deeds of Flesh',
          name: 'Deeds of Flesh',
          venue_name: 'The Cobalt',
          city: 'Vancouver',
          date: '2026-12-10',
          is_community_submitted: true,
        },
        [showB]: {
          id: showB,
          headliner: 'Hate Eternal',
          name: 'Hate Eternal',
          venue_name: 'The Orpheum',
          city: 'Tampa',
          date: '2026-12-12',
          is_community_submitted: true,
          _pendingCloudSync: true,
        },
        [deletedShow]: {
          id: deletedShow,
          headliner: 'Deleted Band',
          name: 'Deleted Band',
          venue_name: 'Old Venue',
          city: 'Austin',
          date: '2026-12-14',
          is_community_submitted: true,
        },
        [alreadySyncedShow]: {
          id: alreadySyncedShow,
          headliner: 'Nile',
          name: 'Nile',
          venue_name: 'AM/FM',
          city: 'Dallas',
          date: '2027-03-05',
          is_community_submitted: true,
          _pendingCloudSync: true,
        },
      })
    );

    const remoteShows = getSupabaseTableRows('shows');
    const deletedSet = new Set([deletedShow.toLowerCase()]);

    const result = await reconcilePendingCommunityShows(remoteShows, deletedSet);

    expect(result.attempted).toBe(2);
    expect(result.syncedCount).toBe(2);

    const rowsAfter = getSupabaseTableRows('shows');
    const headliners = rowsAfter.map((r) => r.headliner);
    expect(headliners).toContain('Nile');
    expect(headliners).toContain('Deeds of Flesh');
    expect(headliners).toContain('Hate Eternal');
    expect(headliners).not.toContain('Deleted Band');

    const extAfter = JSON.parse(localStorage.getItem('nexus_core_shows_extended') || '{}');
    expect(extAfter[showA]._pendingCloudSync).toBe(false);
    expect(extAfter[showB]._pendingCloudSync).toBe(false);
    expect(extAfter[alreadySyncedShow]._pendingCloudSync).toBe(false);
  });
});
