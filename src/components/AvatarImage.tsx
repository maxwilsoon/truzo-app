import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  emoji: string;
  avatarUrl?: string | null;
  size: number;
}

export const AvatarImage: React.FC<Props> = ({ emoji, avatarUrl, size }) => {
  const [imgError, setImgError] = useState(false);
  const radius = size / 2;
  if (avatarUrl && !imgError) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: radius }]}>
      <Text style={{ fontSize: size * 0.5 }}>{emoji}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
