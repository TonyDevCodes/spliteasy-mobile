import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'GroupDetail'>;

type ExpenseRow = {
  id: string;
  paid_by: string;
  amount: number;
  description: string;
  created_at: string;
};

type SplitRow = {
  expense_id: string;
  user_id: string;
  amount_owed: number;
};

type SettlementRow = {
  from_user: string;
  to_user: string;
  amount: number;
};

type MemberRow = {
  user_id: string;
  profiles: { id: string; display_name: string | null; email: string } | null;
};

type InviteRow = {
  id: string;
  token: string;
  expires_at: string;
};

type BalanceLine = {
  from: string;
  to: string;
  amount: number;
};

// Same greedy debtor/creditor matching as the web app's app/groups/[id]/page.tsx.
function computeSettlements(net: Record<string, number>): BalanceLine[] {
  const creditors: { id: string; amount: number }[] = [];
  const debtors: { id: string; amount: number }[] = [];

  for (const [id, amount] of Object.entries(net)) {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded > 0.005) creditors.push({ id, amount: rounded });
    else if (rounded < -0.005) debtors.push({ id, amount: -rounded });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const lines: BalanceLine[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settled = Math.min(debtor.amount, creditor.amount);

    lines.push({ from: debtor.id, to: creditor.id, amount: settled });

    debtor.amount -= settled;
    creditor.amount -= settled;

    if (debtor.amount <= 0.005) i++;
    if (creditor.amount <= 0.005) j++;
  }

  return lines;
}

type Tab = 'balances' | 'expenses' | 'invite';

const TABS: { key: Tab; label: string }[] = [
  { key: 'balances', label: 'Balances' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'invite', label: 'Invite' },
];

export default function GroupDetailScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>('balances');
  const [loading, setLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [balanceLines, setBalanceLines] = useState<BalanceLine[]>([]);
  const [myNet, setMyNet] = useState(0);
  const [totalOwedByMe, setTotalOwedByMe] = useState(0);
  const [totalOwedToMe, setTotalOwedToMe] = useState(0);
  const [latestInvite, setLatestInvite] = useState<InviteRow | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!session) return;

    const [
      { data: expensesData, error: expensesError },
      { data: splitsData, error: splitsError },
      { data: settlementsData, error: settlementsError },
      { data: membersData, error: membersError },
      { data: invitesData, error: invitesError },
    ] = await Promise.all([
      supabase
        .from('expenses')
        .select('id, paid_by, amount, description, created_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .returns<ExpenseRow[]>(),
      supabase
        .from('expense_splits')
        .select('expense_id, user_id, amount_owed, expenses!inner(group_id)')
        .eq('expenses.group_id', groupId)
        .returns<SplitRow[]>(),
      supabase
        .from('settlements')
        .select('from_user, to_user, amount')
        .eq('group_id', groupId)
        .returns<SettlementRow[]>(),
      supabase
        .from('group_members')
        .select('user_id, profiles(id, display_name, email)')
        .eq('group_id', groupId)
        .returns<MemberRow[]>(),
      supabase
        .from('group_invites')
        .select('id, token, expires_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
        .returns<InviteRow[]>(),
    ]);

    const loadError = Boolean(
      expensesError || splitsError || settlementsError || membersError || invitesError
    );
    if (loadError) {
      console.error('Group detail partial load error:', {
        expensesError,
        splitsError,
        settlementsError,
        membersError,
        invitesError,
      });
    }
    setHasLoadError(loadError);

    const nameByIdMap: Record<string, string> = {};
    (membersData ?? []).forEach((m) => {
      if (m.profiles) {
        nameByIdMap[m.profiles.id] = m.profiles.display_name || m.profiles.email;
      }
    });
    setNameById(nameByIdMap);

    const net: Record<string, number> = {};

    (expensesData ?? []).forEach((e) => {
      net[e.paid_by] = (net[e.paid_by] ?? 0) + Number(e.amount);
    });

    (splitsData ?? []).forEach((s) => {
      net[s.user_id] = (net[s.user_id] ?? 0) - Number(s.amount_owed);
    });

    (settlementsData ?? []).forEach((s) => {
      net[s.from_user] = (net[s.from_user] ?? 0) + Number(s.amount);
      net[s.to_user] = (net[s.to_user] ?? 0) - Number(s.amount);
    });

    const lines = computeSettlements(net);
    setBalanceLines(lines);
    setExpenses(expensesData ?? []);
    setLatestInvite(invitesData?.[0] ?? null);

    const userId = session.user.id;
    const owedByMe = lines.filter((l) => l.from === userId).reduce((sum, l) => sum + l.amount, 0);
    const owedToMe = lines.filter((l) => l.to === userId).reduce((sum, l) => sum + l.amount, 0);
    setTotalOwedByMe(owedByMe);
    setTotalOwedToMe(owedToMe);
    setMyNet(Math.round((owedToMe - owedByMe) * 100) / 100);
  }, [session, groupId]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchDetail().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchDetail])
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const hasExpenses = expenses.length > 0;

  return (
    <View style={styles.container}>
      {hasLoadError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>
            Some data failed to load — the numbers below may be incomplete.
          </Text>
        </View>
      )}

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tabButton, tab === t.key && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonText, tab === t.key && styles.tabButtonTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'balances' && (
          <View>
            <Text style={styles.sectionTitle}>Your balance</Text>
            {myNet === 0 ? (
              <Text style={styles.mutedText}>You're all settled up!</Text>
            ) : (
              <>
                {totalOwedByMe > 0 && (
                  <Text style={styles.negativeText}>You owe €{totalOwedByMe.toFixed(2)}</Text>
                )}
                {totalOwedToMe > 0 && (
                  <Text style={styles.positiveText}>You are owed €{totalOwedToMe.toFixed(2)}</Text>
                )}
                <Text style={styles.mutedText}>
                  Net:{' '}
                  {myNet > 0
                    ? `You are owed €${myNet.toFixed(2)}`
                    : `You owe €${Math.abs(myNet).toFixed(2)}`}
                </Text>
              </>
            )}

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              All balances in this group
            </Text>
            {!hasExpenses ? (
              <Text style={styles.mutedText}>No expenses yet.</Text>
            ) : balanceLines.length === 0 ? (
              <Text style={styles.mutedText}>All settled up!</Text>
            ) : (
              balanceLines.map((line, idx) => (
                <Text key={idx} style={styles.balanceLine}>
                  {nameById[line.from] ?? 'Someone'} owes {nameById[line.to] ?? 'someone'}: €
                  {line.amount.toFixed(2)}
                </Text>
              ))
            )}
          </View>
        )}

        {tab === 'expenses' && (
          <View>
            <Text style={styles.sectionTitle}>Expenses</Text>
            {!hasExpenses ? (
              <Text style={styles.mutedText}>No expenses yet.</Text>
            ) : (
              expenses.map((e) => (
                <View key={e.id} style={styles.expenseRow}>
                  <Text style={styles.expenseDescription}>
                    {e.description}
                    <Text style={styles.mutedInline}> — paid by {nameById[e.paid_by] ?? 'someone'}</Text>
                  </Text>
                  <Text style={styles.expenseAmount}>€{Number(e.amount).toFixed(2)}</Text>
                </View>
              ))
            )}
            <Pressable
              style={styles.addExpenseButton}
              onPress={() => navigation.navigate('AddExpense', { groupId })}
            >
              <Text style={styles.addExpenseButtonText}>+ Add expense</Text>
            </Pressable>
          </View>
        )}

        {tab === 'invite' && (
          <View>
            <Text style={styles.sectionTitle}>Invite</Text>
            {latestInvite ? (
              <Text style={styles.mutedText}>Invite link: /invite/{latestInvite.token}</Text>
            ) : (
              <Text style={styles.mutedText}>No active invite link.</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
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
  errorBanner: {
    backgroundColor: '#fef2f2',
    padding: 12,
  },
  errorBannerText: {
    color: '#b91c1c',
    fontSize: 13,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#2563eb',
  },
  tabButtonText: {
    fontSize: 14,
    color: '#71717a',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: '#2563eb',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#18181b',
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 20,
  },
  mutedText: {
    fontSize: 14,
    color: '#71717a',
  },
  mutedInline: {
    fontSize: 14,
    color: '#a1a1aa',
  },
  negativeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#dc2626',
  },
  positiveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#16a34a',
  },
  balanceLine: {
    fontSize: 14,
    color: '#3f3f46',
    marginBottom: 8,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  expenseDescription: {
    fontSize: 14,
    color: '#3f3f46',
    flexShrink: 1,
    paddingRight: 8,
  },
  expenseAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
  },
  addExpenseButton: {
    marginTop: 12,
  },
  addExpenseButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563eb',
  },
});
