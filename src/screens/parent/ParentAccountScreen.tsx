import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from '../../navigation/types';
import { navigationRef } from '../../navigation';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';

const BRAND = '#2E7D32';

const MenuItem = ({
  icon, label, value, onPress, color,
}: {
  icon: any; label: string; value?: string; onPress: () => void; color?: string;
}) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
    <View style={[styles.menuIcon, { backgroundColor: color ? `${color}20` : colors.surface }]}>
      <Ionicons name={icon} size={20} color={color ?? colors.textSecondary} />
    </View>
    <Text style={[styles.menuLabel, color && { color }]}>{label}</Text>
    {value && <Text style={styles.menuValue}>{value}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
  </TouchableOpacity>
);

export const ParentAccountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { parent, setParent, userId } = useApp();
  const [uploading, setUploading] = useState(false);

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow Truzo to access your photo library in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled) await upload(result.assets[0]);
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow Truzo to access your camera in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled) await upload(result.assets[0]);
  };

  const upload = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!userId) return;
    setUploading(true);
    try {
      const mimeType = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
      const url = await db.uploadParentProfileImage(userId, asset.uri, mimeType);
      setParent(p => ({ ...p, profileImageUrl: url }));
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    if (!userId) return;
    setUploading(true);
    try {
      await db.removeParentProfileImage(userId);
      setParent(p => ({ ...p, profileImageUrl: undefined }));
    } catch {
      Alert.alert('Error', 'Could not remove photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const showImageOptions = () => {
    const hasPhoto = !!parent.profileImageUrl;
    if (Platform.OS === 'ios') {
      const options = [
        'Take photo',
        'Choose from library',
        ...(hasPhoto ? ['Remove photo'] : []),
        'Cancel',
      ];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: hasPhoto ? 2 : undefined },
        idx => {
          if (idx === 0) pickFromCamera();
          else if (idx === 1) pickFromLibrary();
          else if (idx === 2 && hasPhoto) removePhoto();
        },
      );
    } else {
      const buttons: Alert['alert'] | any[] = [
        { text: 'Take photo', onPress: pickFromCamera },
        { text: 'Choose from library', onPress: pickFromLibrary },
        ...(hasPhoto ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: removePhoto }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ];
      Alert.alert('Profile photo', 'Choose an option', buttons);
    }
  };

  const initial = (parent.firstName || parent.displayName || 'P').charAt(0).toUpperCase();

  const doLogout = () => navigationRef.reset({ index: 0, routes: [{ name: 'WhoIsLoggingIn' }] });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Account</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Profile header ───────────────────────────────── */}
        <View style={styles.profileHeader}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={showImageOptions}
            activeOpacity={0.85}
            disabled={uploading}
          >
            {parent.profileImageUrl ? (
              <Image source={{ uri: parent.profileImageUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}

            {/* Camera badge */}
            {!uploading && (
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={13} color="#fff" />
              </View>
            )}

            {/* Upload overlay */}
            {uploading && (
              <View style={styles.uploadOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.firstName}>{parent.firstName || parent.displayName}</Text>
          <Text style={styles.role}>Parent account</Text>
        </View>

        {/* ── Your account ──────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Your account</Text>
        <View style={styles.menuSection}>
          <MenuItem icon="shield-checkmark-outline" label="Membership" value="Free" onPress={() => {}} />
          <MenuItem icon="card-outline" label="Payment methods" onPress={() => navigation.navigate('PaymentMethods')} />
          <MenuItem icon="repeat-outline" label="Auto top-up" onPress={() => {}} />
          <MenuItem icon="people-outline" label="Family account" onPress={() => navigation.navigate('ParentAccountDetails')} />
          <MenuItem icon="document-text-outline" label="Parent statements" onPress={() => {}} />
        </View>

        {/* ── Settings ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Settings</Text>
        <View style={styles.menuSection}>
          <MenuItem icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('ParentNotifications')} />
        </View>

        {/* ── More ──────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>More</Text>
        <View style={styles.menuSection}>
          <MenuItem icon="help-circle-outline" label="Help Centre" onPress={() => {}} />
          <MenuItem icon="star-outline" label="Rate Truzo" onPress={() => navigation.navigate('RateTruzo')} />
          <MenuItem icon="lock-closed-outline" label="Privacy Policy" onPress={() => {}} />
          <MenuItem icon="gift-outline" label="Refer a friend" onPress={() => {}} />
        </View>

        {/* ── Log out ───────────────────────────────────────── */}
        <View style={styles.menuSection}>
          <MenuItem
            icon="log-out-outline"
            label="Log out"
            color="#000"
            onPress={() => {
              if (Platform.OS === 'web') {
                if (window.confirm('Are you sure you want to log out?')) setTimeout(doLogout, 0);
              } else {
                Alert.alert('Log out', 'Are you sure you want to log out?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Log out', style: 'destructive', onPress: doLogout },
                ]);
              }
            }}
          />
        </View>

        <Text style={styles.version}>Truzo v1.0.0 · © 2025</Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.surface },
  topBar:     { paddingHorizontal: 20, paddingVertical: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  topBarTitle:{ fontSize: 22, fontWeight: '800', color: colors.text },
  scroll:     { padding: 16, gap: 16 },

  /* Profile header */
  profileHeader: {
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 38,
    fontWeight: '800',
    color: BRAND,
    letterSpacing: -1,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstName: { fontSize: 22, fontWeight: '800', color: colors.text },
  role:      { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },

  /* Menu */
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, paddingHorizontal: 4 },
  menuSection:  { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden' },
  menuItem:     { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.surface },
  menuIcon:     { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel:    { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  menuValue:    { fontSize: 14, color: colors.textSecondary, marginRight: 4 },

  version: { textAlign: 'center', fontSize: 13, color: colors.textLight },
});
