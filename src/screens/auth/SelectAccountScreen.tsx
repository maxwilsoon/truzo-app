import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';

const GREEN      = '#C8E8CB';
const GREEN_DARK = '#3D7A45';

type AccountType = 'parent' | 'child';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'SelectAccount'> };

const OPTIONS: { type: AccountType; label: string }[] = [
  { type: 'parent', label: 'Parent / co-parent' },
  { type: 'child',  label: 'Child' },
];

export const SelectAccountScreen: React.FC<Props> = ({ navigation }) => {
  const [selected, setSelected] = useState<AccountType | null>(null);

  const handleContinue = () => {
    if (selected === 'parent') {
      navigation.navigate('ParentEmailLogin');
    } else if (selected === 'child') {
      navigation.navigate('ChildLogin');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={styles.back}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="chevron-back" size={26} color="#1C1C1E" />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Which account are you logging into?</Text>

        <View style={styles.options}>
          {OPTIONS.map(({ type, label }) => {
            const active = selected === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => setSelected(type)}
                activeOpacity={0.75}
              >
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {label}
                </Text>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, !selected && styles.btnDisabled]}
          onPress={handleContinue}
          disabled={!selected}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#fff' },
  back:    { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },

  title: { fontSize: 26, fontWeight: '800', color: '#1C1C1E', marginBottom: 32, lineHeight: 34 },

  options: { gap: 12 },

  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: '#D1D1D6', borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 20, backgroundColor: '#fff',
  },
  optionActive:      { borderColor: GREEN, backgroundColor: '#E8F5E9' },
  optionLabel:       { fontSize: 17, fontWeight: '500', color: '#1C1C1E' },
  optionLabelActive: { fontWeight: '600' },

  radio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#C7C7CC',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: GREEN, backgroundColor: GREEN },
  radioDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },

  footer:      { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8 },
  btn:         { backgroundColor: GREEN, borderRadius: 50, paddingVertical: 18, alignItems: 'center' },
  btnDisabled: { opacity: 0.35 },
  btnText:     { color: '#1F2937', fontSize: 17, fontWeight: '700' },
});
