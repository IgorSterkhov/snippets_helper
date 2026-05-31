import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { sendAiChat } from '../../api/ai';
import { executeMobileAiCommands } from '../../ai/commandDispatcher';
import { choiceKey, choiceLabel } from '../../ai/choiceDisplay';
import { startMobileSpeechRecognition, stopMobileSpeechRecognition } from '../../ai/speechRecognition';

export default function AIScreen({ navigation }) {
  const { colors } = useTheme();
  const { apiKey } = useAuth();
  const [mode, setMode] = useState('command');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState('idle');
  const [recentTaskUuid, setRecentTaskUuid] = useState(null);
  const voiceBusy = voiceState === 'listening' || voiceState === 'stopping';

  const send = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setReply('');
    setLogs([]);
    try {
      const baseUrl = await AsyncStorage.getItem('api_base_url');
      if (!baseUrl || !apiKey) {
        throw new Error('API URL or key is not configured');
      }
      const context = {
        module: 'ai',
        recent_task_uuid: recentTaskUuid,
        locale: 'ru',
      };
      const response = await sendAiChat(baseUrl, apiKey, {
        mode,
        message: text,
        context,
      });
      let nextLogs = Array.isArray(response.results) ? response.results : [];
      if (mode === 'command' && Array.isArray(response.commands) && response.commands.length) {
        nextLogs = await executeMobileAiCommands(response.commands, navigation, context);
      }
      if (context.recent_task_uuid) setRecentTaskUuid(context.recent_task_uuid);
      setReply(response.reply || (nextLogs.length ? 'Команды выполнены.' : 'Нет ответа.'));
      setLogs(nextLogs);
      setMessage('');
    } catch (e) {
      const errorText = String(e);
      setReply(errorText);
      setLogs([{ name: 'ai_chat', status: 'failed', message: errorText }]);
      Alert.alert('AI error', errorText);
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = async () => {
    if (busy) return;
    if (voiceBusy) {
      setVoiceState('stopping');
      try {
        await stopMobileSpeechRecognition();
      } catch (e) {
        const errorText = String(e);
        setReply(errorText);
        Alert.alert('Voice error', errorText);
        setVoiceState('idle');
      }
      return;
    }

    setVoiceState('listening');
    setReply('Listening...');
    try {
      const transcript = await startMobileSpeechRecognition({ locale: 'ru-RU' });
      setMessage((prev) => {
        const base = prev.trim();
        return base ? `${base} ${transcript}` : transcript;
      });
      setReply(`Heard: ${transcript}`);
    } catch (e) {
      const errorText = String(e);
      setReply(errorText);
      Alert.alert('Voice error', errorText);
    } finally {
      setVoiceState('idle');
    }
  };

  const renderLog = ({ item }) => (
    <View style={[s.logItem, { borderColor: statusColor(item.status, colors), backgroundColor: colors.card }]}>
      <Text style={[s.logName, { color: colors.text }]}>{item.name || 'command'}</Text>
      <Text style={[s.logMessage, { color: colors.textSecondary }]}>{item.message || item.status}</Text>
      {Array.isArray(item.choices) && item.choices.length ? (
        <View style={s.choiceList}>
          {item.choices.slice(0, 5).map((choice) => (
            <Text key={choiceKey(choice)} style={[s.choice, { color: colors.textMuted, borderColor: colors.border }]}>
              {choiceLabel(choice)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[s.header, { borderBottomColor: colors.border, backgroundColor: colors.bgSecondary }]}>
        <Text style={[s.heading, { color: colors.text }]}>AI</Text>
        <Text style={[s.status, { color: colors.textMuted }]}>{voiceStatus(voiceState)}</Text>
      </View>

      <View style={s.modeRow}>
        <Segment label="Chat" active={mode === 'chat'} onPress={() => setMode('chat')} colors={colors} />
        <Segment label="Command" active={mode === 'command'} onPress={() => setMode('command')} colors={colors} />
      </View>

      <View style={[s.response, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[s.responseText, { color: reply ? colors.text : colors.textMuted }]}>
          {busy ? 'Thinking...' : (reply || 'Ready')}
        </Text>
      </View>

      <FlatList
        data={logs}
        keyExtractor={(item, index) => `${item.name || 'command'}-${index}`}
        renderItem={renderLog}
        ListEmptyComponent={<Text style={[s.emptyLog, { color: colors.textMuted }]}>No commands yet</Text>}
        contentContainerStyle={s.logList}
      />

      <View style={[s.composer, { borderTopColor: colors.border, backgroundColor: colors.bgSecondary }]}>
        <TextInput
          style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          value={message}
          onChangeText={setMessage}
          placeholder="Ask or command..."
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!busy}
        />
        <View style={s.actionRow}>
          <TouchableOpacity
            onPress={toggleVoice}
            disabled={busy}
            style={[
              s.micButton,
              {
                borderColor: voiceBusy ? colors.primary : colors.border,
                backgroundColor: voiceBusy ? `${colors.primary}22` : 'transparent',
                opacity: busy ? 0.55 : 1,
              },
            ]}
          >
            <Text style={[s.micText, { color: voiceBusy ? colors.primary : colors.textSecondary }]}>
              {voiceBusy ? 'Stop' : 'Mic'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={send}
            disabled={busy || !message.trim()}
            style={[s.sendButton, { backgroundColor: colors.primary, opacity: busy || !message.trim() ? 0.55 : 1 }]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendText}>Send</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Segment({ label, active, onPress, colors }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        s.segment,
        { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.bgSecondary },
      ]}
    >
      <Text style={[s.segmentText, { color: active ? '#fff' : colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function statusColor(status, colors) {
  if (status === 'executed') return colors.success || '#3fb950';
  if (status === 'needs_clarification') return '#d29922';
  if (status === 'failed') return colors.danger || '#f85149';
  return colors.border;
}

function voiceStatus(state) {
  if (state === 'listening') return 'Listening';
  if (state === 'stopping') return 'Stopping';
  return 'DeepSeek';
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  heading: { fontSize: 22, fontWeight: '800' },
  status: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  segment: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '800' },
  response: { marginHorizontal: 12, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 92 },
  responseText: { fontSize: 14, lineHeight: 20 },
  logList: { padding: 12, paddingBottom: 16 },
  emptyLog: { textAlign: 'center', marginTop: 24, fontSize: 13 },
  logItem: { borderLeftWidth: 3, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  logName: { fontSize: 13, fontWeight: '800' },
  logMessage: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  choiceList: { marginTop: 6, gap: 4 },
  choice: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12 },
  composer: { borderTopWidth: 1, padding: 10, gap: 8 },
  input: { minHeight: 72, maxHeight: 150, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  micButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  micText: { fontSize: 13, fontWeight: '800' },
  sendButton: { minWidth: 88, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
