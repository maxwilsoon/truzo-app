import { useEffect } from 'react';
import { supabase } from './supabase';
import { db } from './database';
import { PendingRequest } from '../context/AppContext';

interface Handlers {
  childId: string;
  onNewRequest:      (req: PendingRequest) => void;
  onCircleUpdated:   (members: Array<{ id: string; display_name: string; username: string; avatar_emoji: string; trust_score: number }>) => void;
}

export function useRealtimeCircle({ childId, onNewRequest, onCircleUpdated }: Handlers) {
  useEffect(() => {
    if (!childId) return;

    // Listen for new incoming friend requests addressed to this child
    const requestChannel = supabase
      .channel(`cr_${childId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'circle_requests', filter: `to_id=eq.${childId}` },
        async () => {
          try {
            const pending = await db.getPendingRequests(childId);
            // Report only the newest request (the one that just arrived)
            if (pending.length > 0) {
              const newest = pending[0];
              onNewRequest({
                requestId:   newest.request_id,
                id:          newest.id,
                displayName: newest.display_name,
                username:    newest.username,
                avatarEmoji: newest.avatar_emoji,
                trustScore:  newest.trust_score,
                createdAt:   newest.created_at,
              });
            }
          } catch {}
        }
      )
      .subscribe();

    // Listen for circle entries where this child is the owner becoming active.
    // INSERT covers first-time friendships; UPDATE covers re-activated friendships
    // (remove_from_circle soft-deletes, so accept_circle_request fires an UPDATE).
    const handleCircleChange = async () => {
      try {
        const members = await db.getCircle(childId);
        onCircleUpdated(members);
      } catch {}
    };

    const circleChannel = supabase
      .channel(`ci_${childId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'circles', filter: `child_id=eq.${childId}` }, handleCircleChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'circles', filter: `child_id=eq.${childId}` }, handleCircleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(requestChannel);
      supabase.removeChannel(circleChannel);
    };
  }, [childId]);
}
