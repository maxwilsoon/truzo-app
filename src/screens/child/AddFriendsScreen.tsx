import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

const MOCK_USERS = [
  { id: 'u1', name: 'Maya Patel',    username: 'maya_p',  initial: 'M', color: '#7C3AED', trust: 65  },
  { id: 'u2', name: 'Marcus Brown',  username: 'marc_b',  initial: 'M', color: '#3B82F6', trust: 78  },
  { id: 'u3', name: 'Priya Sharma',  username: 'priya_s', initial: 'P', color: '#10B981', trust: 82  },
  { id: 'u4', name: 'Sam Wilson',    username: 'sam_w',   initial: 'S', color: '#EF4444', trust: 45  },
  { id: 'u5', name: 'Taylor Reed',   username: 'taylor_r',initial: 'T', color: '#F59E0B', trust: 91  },
];

const INVITED = [
  { id: 'i1', name: 'Jordan Lee', username: 'j_lee', initial: 'J', color: '#F59E0B', trust: 96 },
];

const TrustCircle = ({ score, variant }: { score: number; variant: 'purple' | 'cyan' }) => (
  <View style={[styles.trustCircle, variant === 'purple' ? styles.trustCirclePurple : styles.trustCircleCyan]}>
    <Text style={[styles.trustCircleText, { color: variant === 'purple' ? colors.primary : '#06B6D4' }]}>
      {score}
    </Text>
  </View>
);

export const AddFriendsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const [invited, setInvited] = useState<string[]>(INVITED.map(i => i.id));
  const [added, setAdded] = useState<string[]>([]);

  const query = search.trim().toLowerCase();
  const results = query.length > 0
    ? MOCK_USERS.filter(
        u => u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query)
      )
    : [];

  const handleAdd = (id: string, name: string) => {
    setAdded(prev => [...prev, id]);
    Alert.alert('Request sent! 🎉', `A friend request has been sent to ${name}.`);
  };

  const handleCancelInvite = (id: string) => {
    setInvited(prev => prev.filter(i => i !== id));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Handle bar */}
      <View style={styles.handleBar} />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Add Friends</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={18} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
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
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Search results */}
        {query.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RESULTS FOR "{query.toUpperCase()}"</Text>
            {results.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No users found for "{search}"</Text>
              </View>
            ) : (
              results.map(user => (
                <View key={user.id} style={styles.userCard}>
                  <View style={[styles.avatar, { backgroundColor: user.color }]}>
                    <Text style={styles.avatarInitial}>{user.initial}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{user.name}</Text>
                    <Text style={styles.userHandle}>@{user.username}</Text>
                  </View>
                  <TrustCircle score={user.trust} variant="cyan" />
                  {added.includes(user.id) ? (
                    <View style={styles.sentBtn}>
                      <Text style={styles.sentBtnText}>Sent ✓</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => handleAdd(user.id, user.name)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="person-add-outline" size={15} color={colors.primary} />
                      <Text style={styles.addBtnText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </>
        )}

        {/* Invited — awaiting reply */}
        {invited.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>INVITED · AWAITING REPLY</Text>
            {INVITED.filter(i => invited.includes(i.id)).map(user => (
              <View key={user.id} style={styles.userCard}>
                <View style={[styles.avatar, { backgroundColor: user.color }]}>
                  <Text style={styles.avatarInitial}>{user.initial}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{user.name}</Text>
                  <Text style={styles.userHandle}>@{user.username}</Text>
                </View>
                <TrustCircle score={user.trust} variant="purple" />
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => handleCancelInvite(user.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* Empty state when no search */}
        {query.length === 0 && invited.length === 0 && (
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8,
  },
  title: { fontSize: 26, fontWeight: '800', color: '#1A1A3E', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', lineHeight: 22 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
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
    padding: 14, borderWidth: 1, borderColor: '#EDE9FE',
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 22, fontWeight: '800', color: '#fff' },
  userName: { fontSize: 16, fontWeight: '700', color: '#1A1A3E' },
  userHandle: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  trustCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5,
  },
  trustCirclePurple: { borderColor: colors.primary, backgroundColor: '#F5F3FF' },
  trustCircleCyan: { borderColor: '#06B6D4', backgroundColor: '#ECFEFF' },
  trustCircleText: { fontSize: 14, fontWeight: '800' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: '#F5F3FF',
  },
  addBtnText: { fontSize: 14, fontWeight: '700', color: colors.primary },

  sentBtn: {
    borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F9FAFB',
  },
  sentBtnText: { fontSize: 14, fontWeight: '700', color: '#9CA3AF' },

  cancelBtn: {
    borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F9FAFB',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },

  emptyCard: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontSize: 15, color: '#9CA3AF', textAlign: 'center' },
});
