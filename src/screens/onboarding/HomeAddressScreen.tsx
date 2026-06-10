import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';
const BG = '#F2F2F7';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'HomeAddress'> };

export const HomeAddressScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();
  const [street, setStreet]     = useState('');
  const [apt, setApt]           = useState('');
  const [city, setCity]         = useState('');
  const [postcode, setPostcode] = useState('');
  const [country, setCountry]   = useState('');
  const [focused, setFocused]   = useState<string | null>(null);

  const canContinue = street.trim() && city.trim() && postcode.trim() && country.trim();

  type FieldDef = {
    key: string; label: string; placeholder: string;
    value: string; onChange: (v: string) => void;
    optional?: boolean; autoCapitalize?: 'words' | 'characters' | 'none';
    search?: boolean;
  };

  const fields: FieldDef[] = [
    {
      key: 'street', label: 'Street name', placeholder: 'Search home address',
      value: street, onChange: setStreet, autoCapitalize: 'words', search: true,
    },
    {
      key: 'apt', label: 'Apartment, flat, unit or suite number', placeholder: 'Apartment, flat, unit or suite number',
      value: apt, onChange: setApt, autoCapitalize: 'words', optional: true,
    },
    {
      key: 'city', label: 'Town / City', placeholder: 'Town / City',
      value: city, onChange: setCity, autoCapitalize: 'words',
    },
    {
      key: 'postcode', label: 'Postcode / ZIP code', placeholder: 'Postcode / ZIP code',
      value: postcode, onChange: t => setPostcode(t.toUpperCase()), autoCapitalize: 'characters',
    },
    {
      key: 'country', label: 'Country', placeholder: 'Country',
      value: country, onChange: setCountry, autoCapitalize: 'words',
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={8} total={9} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Home address</Text>
          <Text style={styles.sub}>
            Your official home address is required to verify your identity. We'll also send your kids' cards to this address.
          </Text>

          {fields.map((f, i) => (
            <View
              key={f.key}
              style={[
                styles.inputWrap,
                focused === f.key && styles.inputFocused,
                f.optional && styles.inputOptional,
              ]}
            >
              {/* Search icon on first field */}
              {f.search && (
                <Ionicons
                  name="search-outline"
                  size={20}
                  color={focused === f.key ? PURPLE : '#AEAEB2'}
                  style={styles.searchIcon}
                />
              )}

              <View style={{ flex: 1 }}>
                {(focused === f.key || f.value.length > 0) && (
                  <Text style={[styles.floatLabel, focused === f.key && styles.floatLabelActive]}>
                    {f.optional ? `${f.label} (optional)` : f.label}
                  </Text>
                )}
                <TextInput
                  style={[styles.input, f.search && styles.inputWithIcon]}
                  placeholder={
                    focused === f.key || f.value.length > 0
                      ? ''
                      : f.optional
                        ? `${f.placeholder} (optional)`
                        : f.placeholder
                  }
                  placeholderTextColor="#AEAEB2"
                  value={f.value}
                  onChangeText={f.onChange}
                  autoCapitalize={f.autoCapitalize ?? 'none'}
                  autoFocus={i === 0}
                  onFocus={() => setFocused(f.key)}
                  onBlur={() => setFocused(null)}
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={() => {
              const address = [street.trim(), apt.trim(), city.trim(), postcode.trim(), country.trim()]
                .filter(Boolean).join(', ');
              setParent(p => ({ ...p, address }));
              navigation.navigate('ChildDetails');
            }}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 8 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 23, marginBottom: 32 },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14,
    minHeight: 62,
  },
  inputFocused:  { borderColor: PURPLE },
  inputOptional: { borderStyle: 'dashed' },

  searchIcon: { marginRight: 10 },

  floatLabel:       { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 2 },
  floatLabelActive: { color: PURPLE },

  input:          { fontSize: 17, color: '#1C1C1E', padding: 0 },
  inputWithIcon:  { fontSize: 17 },

  footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: PURPLE,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#fff', fontSize: 17, fontWeight: '700' },
});
