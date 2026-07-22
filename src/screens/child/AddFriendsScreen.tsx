import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';
import { sendPushNotification } from '../../lib/notifications';

type SearchResult = {
  id: string;
  display_name: string;
  username: string;
  avatar_emoji: string;
  trust_score: number;
};

const AVATAR_COLORS = ['#C8E8CB','#3B82F6','#10B981','#EF4444','#F59E0B','#EC4899','#06B6D4'];
const colorFor = (id: string) => AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length];

export const AddFriendsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { childId, child, circle } = useApp();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // circleIds: already in each other's circles (accepted)
  const [circleIds, setCircleIds] = useState<Set<string>>(new Set());
  // requestedIds: sent a request, not yet accepted — persists across circle polling cycles
  const requestedIdsRef = useRef<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());

  // Sync circle ids whenever circle state updates (from 5-sec polling)
  useEffect(() => {
    setCircleIds(new Set(circle.map(m => m.id)));
  }, [circle]);

  // On mount, seed requestedIds from DB so existing pending requests show correctly
  useEffect(() => {
    if (!childId) return;
    db.getOutgoingPendingRequests(childId)
      .then(rows => {
        rows.forEach(r => requestedIdsRef.current.add(r.id));
        setRequestedIds(new Set(requestedIdsRef.current));
      })
      .catch(() => {});
  }, [childId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (q.length < 2) { setResults([]); setError(''); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await db.searchChildren(q, childId ?? undefined);
        setResults(rows);
        if (rows.length === 0) setError(`No users found for "${q}"`);
      } catch {
        setError('Search failed. Check your connection.');
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [search, childId]);

  const handleCancel = (user: SearchResult) => {
    if (!childId) return;
    const doCancel = async () => {
      try {
        await db.cancelCircleRequest(childId, user.id);
        requestedIdsRef.current.delete(user.id);
        setRequestedIds(new Set(requestedIdsRef.current));
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not cancel request.');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Cancel your friend request to ${user.display_name}?`)) doCancel();
    } else {
      Alert.alert(
        'Cancel request?',
        `Remove your friend request to ${user.display_name}?`,
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Cancel request', style: 'destructive', onPress: doCancel },
        ]
      );
    }
  };

  const handleAdd = async (user: SearchResult) => {
    if (!childId) {
      Alert.alert('Not logged in', 'Please log in again.');
      return;
    }
    // Optimistically mark as requested immediately
    requestedIdsRef.current.add(user.id);
    setRequestedIds(new Set(requestedIdsRef.current));

    try {
      const pushToken = await db.sendCircleRequest(childId, user.id);
      // Notify the recipient (best-effort)
      if (pushToken) {
        sendPushNotification(
          pushToken,
          'New friend request 👋',
          `${child.displayName} wants to join your circle`,
        ).catch(() => {});
      }
    } catch (e: any) {
      requestedIdsRef.current.delete(user.id);
      setRequestedIds(new Set(requestedIdsRef.current));
      const msg: string = e?.message ?? '';
      if (msg.includes('already_friends')) {
        // Race: they became friends via another path — mark locally as in-circle
        setCircleIds(prev => new Set([...prev, user.id]));
      } else if (msg.includes('already_pending')) {
        // Race: a pending request already exists — mark as requested
        requestedIdsRef.current.add(user.id);
        setRequestedIds(new Set(requestedIdsRef.current));
      } else {
        Alert.alert('Error', 'Could not send request. Please try again.');
      }
    }
  };

  const getButtonState = (userId: string): 'in_circle' | 'requested' | 'none' => {
    if (circleIds.has(userId)) return 'in_circle';
    if (requestedIds.has(userId)) return 'requested';
    return 'none';
  };

  const query = search.trim();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.handleBar} />

      <View style={styles.header}>
        <Text style={styles.title}>Add Friends</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={18} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" style={{ marginRight: 4 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or @username"
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color="#2E7D32" style={{ marginLeft: 4 }} />}
        {!loading && search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(''); setResults([]); setError(''); }}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {query.length >= 2 && (
          <>
            {error ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>{error}</Text>
              </View>
            ) : results.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>RESULTS FOR "{query.toUpperCase()}"</Text>
                {results.map(user => {
                  const state = getButtonState(user.id);
                  return (
                    <View key={user.id} style={styles.userCard}>
                      <View style={[styles.avatar, { backgroundColor: colorFor(user.id) }]}>
                        <Text style={styles.avatarInitial}>{user.avatar_emoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.userName}>{user.display_name}</Text>
                        <Text style={styles.userHandle}>@{user.username}</Text>
                      </View>
                      <View style={styles.trustCircle}>
                        <Text style={styles.trustText}>{user.trust_score}</Text>
                      </View>

                      {state === 'in_circle' && (
                        <View style={styles.inCircleBtn}>
                          <Ionicons name="checkmark" size={14} color="#16A34A" />
                          <Text style={styles.inCircleBtnText}>Friends</Text>
                        </View>
                      )}
                      {state === 'requested' && (
                        <TouchableOpacity
                          style={styles.requestedBtn}
                          onPress={() => handleCancel(user)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="time-outline" size={14} color="#6B7280" />
                          <Text style={styles.requestedBtnText}>Requested</Text>
                        </TouchableOpacity>
                      )}
                      {state === 'none' && (
                        <TouchableOpacity
                          style={styles.addBtn}
                          onPress={() => handleAdd(user)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="person-add-outline" size={15} color="#2E7D32" />
                          <Text style={styles.addBtnText}>Add</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </>
            ) : null}
          </>
        )}

        {query.length < 2 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyText}>Search for friends by name or username</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  handleBar: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8,
  },
  title: { fontSize: 26, fontWeight: '800', color: '#1A1A3E' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 24, marginTop: 12, marginBottom: 4,
    backgroundColor: '#F5F4FC', borderRadius: 14,
    paddingHorizontal: 14, height: 52,
    borderWidth: 1.5, borderColor: '#A5B4FC',
  },
  searchInput: { flex: 1, fontSize: 16, color: '#1A1A3E', marginLeft: 4 },

  scroll: { paddingHorizontal: 24, paddingTop: 16, gap: 10 },

  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: '#6B7280',
    letterSpacing: 0.8, marginTop: 8, marginBottom: 2,
  },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#F9F8FF', borderRadius: 16,
    padding: 14, borderWidth: 1, borderColor: '#E8F5E9',
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 26 },
  userName: { fontSize: 16, fontWeight: '700', color: '#1A1A3E' },
  userHandle: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  trustCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#06B6D4', backgroundColor: '#ECFEFF',
  },
  trustText: { fontSize: 14, fontWeight: '800', color: '#06B6D4' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F1FAF2',
  },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#2E7D32' },

  requestedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#F9FAFB',
  },
  requestedBtnText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },

  inCircleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: '#BBF7D0', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#F0FDF4',
  },
  inCircleBtnText: { fontSize: 14, fontWeight: '700', color: '#16A34A' },

  emptyCard: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontSize: 15, color: '#9CA3AF', textAlign: 'center' },
});
