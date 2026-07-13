import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#F2F2F7';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'HomeAddress'> };

export const HomeAddressScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();

  const [line1, setLine1]       = useState('');
  const [line2, setLine2]       = useState('');
  const [city, setCity]         = useState('');
  const [postcode, setPostcode] = useState('');
  const [focused, setFocused]   = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);

  const line2Ref    = useRef<TextInput>(null);
  const cityRef     = useRef<TextInput>(null);
  const postcodeRef = useRef<TextInput>(null);

  const canContinue = line1.trim().length > 0 && city.trim().length > 0 && postcode.trim().length > 0;

  // Auto-fill city from postcode using the free postcodes.io API (UK only, no API key).
  // To swap in Google Places autocomplete in future, replace this function and add a
  // GooglePlacesAutocomplete component above the grouped card.
  const lookupPostcode = async (raw: string) => {
    const code = raw.trim().replace(/\s+/g, '');
    if (code.length < 5) return;
    setLookingUp(true);
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(code)}`);
      const json = await res.json();
      if (json.status === 200 && json.result) {
        const town = json.result.admin_district || json.result.parish || json.result.region || '';
        if (town && !city.trim()) {
          setCity(town);
          setLookupDone(true);
        }
      }
    } catch {
      // silently ignore — user can type city manually
    } finally {
      setLookingUp(false);
    }
  };

  const handleContinue = () => {
    const address = [line1.trim(), line2.trim(), city.trim(), postcode.trim().toUpperCase()]
      .filter(Boolean)
      .join(', ');
    setParent(p => ({ ...p, address }));
    navigation.navigate('Identity');
  };

  const field = (key: string) => ({
    onFocus: () => setFocused(key),
    onBlur:  () => setFocused(null),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={6} total={8} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Home address</Text>
          <Text style={styles.sub}>
            Your official home address is required to verify your identity. We'll also send your kids' cards here.
          </Text>

          {/* Grouped address card */}
          <View style={[styles.card, focused !== null && styles.cardActive]}>

            {/* Line 1 */}
            <View style={styles.row}>
              <Text style={[styles.label, focused === 'line1' && styles.labelActive]}>Home address</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Start typing your address…"
                  placeholderTextColor="#AEAEB2"
                  value={line1}
                  onChangeText={setLine1}
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={() => line2Ref.current?.focus()}
                  {...field('line1')}
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Line 2 */}
            <View style={styles.row}>
              <Text style={[styles.label, focused === 'line2' && styles.labelActive]}>
                Address line 2{' '}
                <Text style={styles.optional}>(optional)</Text>
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  ref={line2Ref}
                  style={styles.input}
                  placeholder="Flat, suite, unit…"
                  placeholderTextColor="#AEAEB2"
                  value={line2}
                  onChangeText={setLine2}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => cityRef.current?.focus()}
                  {...field('line2')}
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* City */}
            <View style={styles.row}>
              <Text style={[styles.label, focused === 'city' && styles.labelActive]}>Town / City</Text>
              <View style={styles.inputRow}>
                <TextInput
                  ref={cityRef}
                  style={styles.input}
                  placeholder="e.g. London"
                  placeholderTextColor="#AEAEB2"
                  value={city}
                  onChangeText={t => { setCity(t); setLookupDone(false); }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => postcodeRef.current?.focus()}
                  {...field('city')}
                />
                {lookupDone && (
                  <Ionicons name="checkmark-circle" size={18} color="#22C55E" style={{ marginLeft: 8 }} />
                )}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Postcode */}
            <View style={styles.row}>
              <Text style={[styles.label, focused === 'postcode' && styles.labelActive]}>Postcode</Text>
              <View style={styles.inputRow}>
                <TextInput
                  ref={postcodeRef}
                  style={styles.input}
                  placeholder="e.g. SW1A 1AA"
                  placeholderTextColor="#AEAEB2"
                  value={postcode}
                  onChangeText={t => {
                    setPostcode(t.toUpperCase());
                    setLookupDone(false);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onBlur={() => {
                    setFocused(null);
                    lookupPostcode(postcode);
                  }}
                  onFocus={() => setFocused('postcode')}
                />
                {lookingUp && <ActivityIndicator size="small" color={GREEN_DARK} style={{ marginLeft: 8 }} />}
              </View>
            </View>
          </View>

          <Text style={styles.hint}>
            <Ionicons name="lock-closed-outline" size={12} color="#8E8E93" />{' '}
            Your address is encrypted and used only for identity verification.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={handleContinue}
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
  scroll: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 8 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 23, marginBottom: 32 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
    overflow: 'hidden',
    marginBottom: 16,
  },
  cardActive: { borderColor: GREEN },

  row: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    minHeight: 68,
    // column layout: label sits above the input on all platforms
  },

  divider: { height: 1, backgroundColor: '#F2F2F7', marginHorizontal: 18 },

  label:       { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 6 },
  labelActive: { color: GREEN_DARK },
  optional:    { fontWeight: '400', color: '#AEAEB2' },

  // inputRow wraps TextInput + optional trailing icon side-by-side
  inputRow: { flexDirection: 'row', alignItems: 'center' },

  input: { fontSize: 17, color: '#1C1C1E', padding: 0, flex: 1 },

  hint: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },

  footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#1F2937', fontSize: 17, fontWeight: '700' },
});
