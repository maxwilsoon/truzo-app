import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Dimensions, Alert,
  Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';

const AVATARS = [
  '🦁', '🐨', '🐯', '🦋', '🐸',
  '🦊', '🐧', '🦅', '🐺', '🦄',
  '🐼', '🐮', '🐷', '🐙', '🦀',
  '🐬', '🦈', '🐲', '🦉', '🐺',
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = SCREEN_WIDTH - 120;

export const AvatarPickerScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child, childId, setChild } = useApp();
  const initialIndex = AVATARS.indexOf(child.avatarEmoji) >= 0 ? AVATARS.indexOf(child.avatarEmoji) : 0;
  const [selected, setSelected] = useState(AVATARS[initialIndex]);
  const [uploading, setUploading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const currentIndex = AVATARS.indexOf(selected) >= 0 ? AVATARS.indexOf(selected) : 0;

  const confirm = () => {
    setChild(c => ({ ...c, avatarEmoji: selected }));
    navigation.goBack();
  };

  const pickPhoto = async (source: 'library' | 'files') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;
    if (!childId) { Alert.alert('Error', 'Not logged in.'); return; }

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';

    setUploading(true);
    try {
      const url = await db.uploadProfileImage(childId, asset.uri, mimeType);
      setChild(c => ({ ...c, profileImageUrl: url }));
      Alert.alert('Done!', 'Your profile photo has been updated.');
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Could not upload photo. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleAddPhoto = () => {
    Alert.alert(
      'Add Profile Picture',
      '',
      [
        { text: 'Choose from Camera Roll', onPress: () => pickPhoto('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const goLeft = () => {
    const newIndex = (currentIndex - 1 + AVATARS.length) % AVATARS.length;
    setSelected(AVATARS[newIndex]);
    flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
  };

  const goRight = () => {
    const newIndex = (currentIndex + 1) % AVATARS.length;
    setSelected(AVATARS[newIndex]);
    flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
  };

  const onMomentumScrollEnd = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH);
    if (index >= 0 && index < AVATARS.length) {
      setSelected(AVATARS[index]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Choose your avatar</Text>

      {/* Swipe emoji picker */}
      <View style={styles.swipeArea}>
        <TouchableOpacity onPress={goLeft} style={styles.arrowBtn}>
          <Ionicons name="chevron-back" size={32} color={colors.primary} />
        </TouchableOpacity>

        <FlatList
          ref={flatListRef}
          data={AVATARS}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, i) => `${item}-${i}`}
          initialScrollIndex={currentIndex}
          getItemLayout={(_, index) => ({ length: ITEM_WIDTH, offset: ITEM_WIDTH * index, index })}
          onMomentumScrollEnd={onMomentumScrollEnd}
          style={styles.flatList}
          contentContainerStyle={styles.flatListContent}
          renderItem={({ item }) => (
            <View style={styles.emojiPage}>
              <View style={[styles.emojiCircle, item === selected && styles.emojiCircleActive]}>
                <Text style={styles.emojiText}>{item}</Text>
              </View>
            </View>
          )}
        />

        <TouchableOpacity onPress={goRight} style={styles.arrowBtn}>
          <Ionicons name="chevron-forward" size={32} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Dot indicators */}
      <View style={styles.dotsRow}>
        {AVATARS.map((emoji, i) => (
          <View
            key={i}
            style={[styles.dot, AVATARS[currentIndex] === emoji && styles.dotActive]}
          />
        ))}
      </View>

      {/* Profile photo section */}
      <Text style={styles.orText}>Or add your own pic</Text>

      <TouchableOpacity style={styles.cameraCircle} onPress={handleAddPhoto} activeOpacity={0.8} disabled={uploading}>
        {uploading ? (
          <ActivityIndicator color="#6366F1" />
        ) : child.profileImageUrl ? (
          <Image source={{ uri: child.profileImageUrl }} style={styles.profilePhoto} />
        ) : (
          <Ionicons name="camera-outline" size={34} color="#C4C4C4" />
        )}
      </TouchableOpacity>

      {child.profileImageUrl && !uploading && (
        <TouchableOpacity onPress={handleAddPhoto} style={styles.changePhotoBtn}>
          <Text style={styles.changePhotoText}>Change photo</Text>
        </TouchableOpacity>
      )}

      <View style={{ flex: 1 }} />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.confirmBtn} onPress={confirm} activeOpacity={0.85}>
          <Text style={styles.confirmBtnText}>Looking good</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4,
  },
  closeBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },

  title: {
    fontSize: 30, fontWeight: '800', color: '#1A1A3E',
    textAlign: 'center', marginTop: 16, marginBottom: 32,
    paddingHorizontal: 24,
  },

  swipeArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  arrowBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  flatList: { flex: 1 },
  flatListContent: {},
  emojiPage: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiCircle: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: '#EEEDF8',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  emojiCircleActive: {
    backgroundColor: '#DDD8F8',
    borderColor: colors.primary,
  },
  emojiText: { fontSize: 72 },

  dotsRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 6, marginTop: 20, marginBottom: 8,
    flexWrap: 'wrap', paddingHorizontal: 40,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#E5E7EB',
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 18,
  },

  orText: {
    fontSize: 16, color: '#9CA3AF',
    textAlign: 'center', marginTop: 32, marginBottom: 20,
  },

  cameraCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  profilePhoto: {
    width: 90, height: 90, borderRadius: 45,
  },
  changePhotoBtn: {
    alignSelf: 'center', marginTop: 10,
  },
  changePhotoText: {
    fontSize: 14, color: colors.primary, fontWeight: '600',
  },

  footer: { padding: 24, paddingBottom: 16 },
  confirmBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 50, paddingVertical: 20,
    alignItems: 'center',
  },
  confirmBtnText: { fontSize: 18, fontWeight: '800', color: '#fff' },
});
