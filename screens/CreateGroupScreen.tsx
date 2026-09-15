import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateGroup'>;

export default function CreateGroupScreen({ navigation }: Props) {
  const { session } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !session) return;

    setError(null);
    setSubmitting(true);

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({ name: trimmedName, created_by: session.user.id })
      .select('id')
      .single();

    if (groupError || !group) {
      console.error('Create group error:', groupError);
      setError('Something went wrong creating the group.');
      setSubmitting(false);
      return;
    }

    const { error: memberError } = await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: session.user.id,
      role: 'admin',
    });

    setSubmitting(false);

    if (memberError) {
      console.error('Add group member error:', memberError);
      setError('Something went wrong creating the group.');
      return;
    }

    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create a group</Text>

      <TextInput
        style={styles.input}
        placeholder="Group name"
        value={name}
        onChangeText={setName}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (submitting || !name.trim()) && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={submitting || !name.trim()}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Group</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#dc2626',
    marginBottom: 12,
    textAlign: 'center',
  },
});
