import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'GroupsList'>;

type GroupRow = {
  id: string;
  name: string;
  created_at: string;
};

type MembershipRow = {
  groups: GroupRow | null;
};

type GroupWithMemberCount = GroupRow & { memberCount: number };

export default function GroupsListScreen({ navigation }: Props) {
  const { session } = useAuth();
  const [groups, setGroups] = useState<GroupWithMemberCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!session) return;

    const { data: memberships, error: membershipsError } = await supabase
      .from('group_members')
      .select('groups(id, name, created_at)')
      .eq('user_id', session.user.id)
      .order('created_at', { referencedTable: 'groups', ascending: false })
      .returns<MembershipRow[]>();

    if (membershipsError) {
      console.error('Groups query error:', membershipsError);
      setError('Something went wrong loading your groups.');
      return;
    }

    const userGroups = (memberships ?? [])
      .map((m) => m.groups)
      .filter((g): g is GroupRow => g !== null);

    if (userGroups.length === 0) {
      setGroups([]);
      setError(null);
      return;
    }

    const groupIds = userGroups.map((g) => g.id);
    const { data: allMembers, error: membersError } = await supabase
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds);

    if (membersError) {
      console.error('Group members query error:', membersError);
      setError('Something went wrong loading your groups.');
      return;
    }

    const countByGroupId: Record<string, number> = {};
    (allMembers ?? []).forEach((m) => {
      countByGroupId[m.group_id] = (countByGroupId[m.group_id] ?? 0) + 1;
    });

    setGroups(
      userGroups.map((g) => ({
        ...g,
        memberCount: countByGroupId[g.id] ?? 0,
      }))
    );
    setError(null);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchGroups().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchGroups])
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>You have no groups yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('GroupDetail', { groupId: item.id, groupName: item.name })}
        >
          <Text style={styles.groupName}>{item.name}</Text>
          <Text style={styles.memberCount}>
            {item.memberCount} {item.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  listContent: {
    padding: 16,
    backgroundColor: '#fff',
    flexGrow: 1,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  groupName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#18181b',
  },
  memberCount: {
    fontSize: 14,
    color: '#71717a',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 16,
    color: '#71717a',
  },
  error: {
    color: '#dc2626',
    textAlign: 'center',
  },
});
