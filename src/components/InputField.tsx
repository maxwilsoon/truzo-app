import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
}

export const InputField: React.FC<Props> = ({ label, error, isPassword, style, ...props }) => {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.container, error ? styles.errorBorder : styles.normalBorder]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.textLight}
          secureTextEntry={isPassword && !visible}
          autoCapitalize="none"
          {...props}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setVisible(v => !v)} style={styles.eyeBtn}>
            <Ionicons name={visible ? 'eye' : 'eye-off'} size={20} color={colors.textLight} />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    height: 54,
  },
  normalBorder: { borderColor: colors.border },
  errorBorder: { borderColor: colors.error },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  eyeBtn: { padding: 4 },
  error: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
});
