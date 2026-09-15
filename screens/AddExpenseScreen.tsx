import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'AddExpense'>;

type Member = {
  id: string;
  name: string;
};

type MemberRow = {
  user_id: string;
  profiles: { id: string; display_name: string | null; email: string } | null;
};

type SplitMode = 'equally' | 'custom';

// Same cents-based split algorithm as the web app's ExpenseForm.tsx, to avoid
// floating-point drift and keep rounding remainders distributed identically.
function getSplits(
  splitMode: SplitMode,
  members: Member[],
  amountCents: number,
  customSplits: Record<string, string>
): { userId: string; amountCents: number }[] {
  if (splitMode === 'equally') {
    const share = Math.floor(amountCents / members.length);
    const remainder = amountCents - share * members.length;
    return members.map((m, i) => ({
      userId: m.id,
      amountCents: share + (i < remainder ? 1 : 0),
    }));
  }

  return members.map((m) => ({
    userId: m.id,
    amountCents: Math.round(parseFloat(customSplits[m.id] || '0') * 100),
  }));
}

export default function AddExpenseScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const { session } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(session?.user.id ?? '');
  const [splitMode, setSplitMode] = useState<SplitMode>('equally');
  const [customSplits, setCustomSplits] = useState<Record<string, string>>({});
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      supabase
        .from('group_members')
        .select('user_id, profiles(id, display_name, email)')
        .eq('group_id', groupId)
        .returns<MemberRow[]>()
        .then(({ data, error: fetchError }) => {
          if (!isActive) return;

          if (fetchError || !data) {
            console.error('Group members query error:', fetchError);
            setMembersError('Could not load group members.');
            setMembersLoading(false);
            return;
          }

          const formatted = data
            .filter((m): m is MemberRow & { profiles: NonNullable<MemberRow['profiles']> } => m.profiles !== null)
            .map((m) => ({
              id: m.profiles.id,
              name: m.profiles.display_name || m.profiles.email,
            }));

          setMembers(formatted);
          setMembersError(null);
          setMembersLoading(false);
        });

      return () => {
        isActive = false;
      };
    }, [groupId])
  );

  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const splits = getSplits(splitMode, members, amountCents, customSplits);
  const splitTotal = splits.reduce((sum, s) => sum + s.amountCents, 0);
  const splitMismatch = splitMode === 'custom' && splitTotal !== amountCents;

  const pickImage = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(fromCamera ? 'Camera permission is required.' : 'Photo library permission is required.');
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

    if (!result.canceled && result.assets.length > 0) {
      setReceiptUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    if (!amountCents || amountCents <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    if (splitMismatch) {
      setError(
        `Split total (${(splitTotal / 100).toFixed(2)}) does not match the expense amount (${(amountCents / 100).toFixed(2)})`
      );
      return;
    }

    setSubmitting(true);

    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        group_id: groupId,
        paid_by: paidBy,
        description: description.trim(),
        amount: amountCents / 100,
      })
      .select('id')
      .single();

    if (expenseError || !expense) {
      console.error('Create expense error:', expenseError);
      setError(expenseError?.message || 'Failed to create expense');
      setSubmitting(false);
      return;
    }

    const splitRows = splits.map((s) => ({
      expense_id: expense.id,
      user_id: s.userId,
      amount_owed: s.amountCents / 100,
    }));

    const { error: splitsError } = await supabase.from('expense_splits').insert(splitRows);

    if (splitsError) {
      console.error('Create expense splits error:', splitsError);
      setError(splitsError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    navigation.goBack();
  };

  if (membersLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (membersError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{membersError}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="e.g. Dinner"
      />

      <Text style={styles.label}>Total amount</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Paid by</Text>
      <View style={styles.pillRow}>
        {members.map((m) => (
          <Pressable
            key={m.id}
            style={[styles.pill, paidBy === m.id && styles.pillActive]}
            onPress={() => setPaidBy(m.id)}
          >
            <Text style={[styles.pillText, paidBy === m.id && styles.pillTextActive]}>{m.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Split</Text>
      <View style={styles.pillRow}>
        <Pressable
          style={[styles.pill, splitMode === 'equally' && styles.pillActive]}
          onPress={() => setSplitMode('equally')}
        >
          <Text style={[styles.pillText, splitMode === 'equally' && styles.pillTextActive]}>Equally</Text>
        </Pressable>
        <Pressable
          style={[styles.pill, splitMode === 'custom' && styles.pillActive]}
          onPress={() => setSplitMode('custom')}
        >
          <Text style={[styles.pillText, splitMode === 'custom' && styles.pillTextActive]}>Custom</Text>
        </Pressable>
      </View>

      {splitMode === 'custom' && (
        <View style={styles.customSplits}>
          {members.map((m) => (
            <View key={m.id} style={styles.customSplitRow}>
              <Text style={styles.customSplitName}>{m.name}</Text>
              <TextInput
                style={styles.customSplitInput}
                value={customSplits[m.id] || ''}
                onChangeText={(text) => setCustomSplits((prev) => ({ ...prev, [m.id]: text }))}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>
          ))}
          <Text style={[styles.mutedText, splitMismatch && styles.error]}>
            Total: {(splitTotal / 100).toFixed(2)} / {(amountCents / 100).toFixed(2)}
          </Text>
        </View>
      )}

      <Text style={styles.label}>Receipt photo</Text>
      {receiptUri && <Image source={{ uri: receiptUri }} style={styles.receiptPreview} />}
      <View style={styles.pillRow}>
        <Pressable style={styles.pill} onPress={() => pickImage(true)}>
          <Text style={styles.pillText}>Take Photo</Text>
        </Pressable>
        <Pressable style={styles.pill} onPress={() => pickImage(false)}>
          <Text style={styles.pillText}>Choose from Library</Text>
        </Pressable>
      </View>
      {receiptUri && (
        <Text style={styles.mutedText}>Photo saved locally — upload to storage is not wired up yet.</Text>
      )}

      <Pressable
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Add expense</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    color: '#b91c1c',
    fontSize: 13,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3f3f46',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillActive: {
    backgroundColor: '#18181b',
    borderColor: '#18181b',
  },
  pillText: {
    fontSize: 14,
    color: '#3f3f46',
  },
  pillTextActive: {
    color: '#fff',
  },
  customSplits: {
    marginTop: 8,
    gap: 8,
  },
  customSplitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customSplitName: {
    fontSize: 14,
    color: '#3f3f46',
    flex: 1,
  },
  customSplitInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    width: 100,
    fontSize: 14,
    textAlign: 'right',
  },
  mutedText: {
    fontSize: 13,
    color: '#71717a',
    marginTop: 4,
  },
  receiptPreview: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f4f4f5',
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#dc2626',
  },
});
