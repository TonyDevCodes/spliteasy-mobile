import { StyleSheet, Text, View } from 'react-native';

export default function CreateGroupScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Create group coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 16,
    color: '#71717a',
  },
});
