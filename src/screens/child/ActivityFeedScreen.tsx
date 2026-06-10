import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

const typeColors: Record<string, string> = {
  request: colors.primaryLight, funded: colors.successLight,
  missed: colors.errorLight,    repaid: colors.successLight,
  joined: '#DBEAFE',            tier: colors.warningLight,
  topup: colors.successLight,   spend: colors.surface,
};

export const ActivityFeedScreen: React.FC = () => {
  const navigation = useNavigation();
  const { activityFeed } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>⚡ Activity</Text>
        <View style={{ width: 40 }} />
      </View>
      <FlatList
        data={activityFeed}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: typeColors[item.type] ?? colors.surface }]}>
              <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.text}>{item.text}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity yet</Text>
          </View>
        }
        ListFooterComponent={<View style={{ height: 24 }} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  list: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: colors.white, borderRadius: 14, padding: 14 },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text: { fontSize: 14, color: colors.text, lineHeight: 20, fontWeight: '500' },
  time: { fontSize: 12, color: colors.textLight, marginTop: 4 },
  separator: { height: 10 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontSize: 15, color: colors.textLight },
});
