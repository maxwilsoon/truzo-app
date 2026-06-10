import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export const BackButton: React.FC = () => {
  const navigation = useNavigation();
  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => navigation.goBack()}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="chevron-back" size={26} color="#1C1C1E" />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 16, paddingVertical: 6 },
});
