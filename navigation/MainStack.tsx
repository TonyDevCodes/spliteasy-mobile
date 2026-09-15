import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import GroupsListScreen from '../screens/GroupsListScreen';

export type MainStackParamList = {
  GroupsList: undefined;
  CreateGroup: undefined;
  GroupDetail: { groupId: string; groupName: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  const { signOut } = useAuth();

  return (
    <Stack.Navigator>
      <Stack.Screen
        name="GroupsList"
        component={GroupsListScreen}
        options={({ navigation }) => ({
          title: 'Your Groups',
          headerLeft: () => (
            <Pressable onPress={signOut} hitSlop={8}>
              <Text style={{ color: '#2563eb', fontSize: 15 }}>Sign Out</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('CreateGroup')} hitSlop={8}>
              <Text style={{ color: '#2563eb', fontSize: 24, fontWeight: '600' }}>+</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} options={{ title: 'Create Group' }} />
      <Stack.Screen
        name="GroupDetail"
        component={GroupDetailScreen}
        options={({ route }) => ({ title: route.params.groupName })}
      />
    </Stack.Navigator>
  );
}
