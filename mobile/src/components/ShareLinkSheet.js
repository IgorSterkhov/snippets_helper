import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { createShareLink, getShareLink, revokeShareLink } from '../api/endpoints';
import { useTheme } from '../theme/ThemeContext';

export default function ShareLinkSheet({ visible, itemType, itemUuid, onClose }) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(null);

  useEffect(() => {
    if (!visible || !itemUuid) return;
    let cancelled = false;
    setLoading(true);
    getShareLink(itemType, itemUuid)
      .then((res) => {
        if (!cancelled) setLink(res.link || null);
      })
      .catch((e) => Alert.alert('Ошибка', String(e?.message || e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, itemType, itemUuid]);

  useEffect(() => {
    if (!visible) setLink(null);
  }, [visible]);

  const create = async () => {
    if (!itemUuid || loading) return;
    try {
      setLoading(true);
      const next = await createShareLink(itemType, itemUuid);
      setLink(next);
      Clipboard.setString(next.public_url);
      Alert.alert('Ссылка создана', 'Ссылка скопирована');
    } catch (e) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!link?.public_url) return;
    Clipboard.setString(link.public_url);
    Alert.alert('Скопировано', 'Ссылка скопирована');
  };

  const open = () => {
    if (link?.public_url) Linking.openURL(link.public_url);
  };

  const revoke = async () => {
    if (!link?.token || loading) return;
    try {
      setLoading(true);
      await revokeShareLink(link.token);
      setLink(null);
      Alert.alert('Ссылка отозвана');
    } catch (e) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.title, { color: colors.text }]}>Публичная ссылка</Text>
          <Text style={[s.status, { color: colors.textSecondary }]}>
            {loading ? 'Загрузка...' : link ? 'Live-ссылка активна' : 'Ссылка не создана'}
          </Text>
          {link ? (
            <Text style={[s.url, { color: colors.text, borderColor: colors.border }]} numberOfLines={2}>
              {link.public_url}
            </Text>
          ) : null}
          <View style={s.actions}>
            {link ? (
              <>
                <Action label="Копировать" onPress={copy} colors={colors} disabled={loading} />
                <Action label="Открыть" onPress={open} colors={colors} disabled={loading} />
                <Action label="Отозвать" onPress={revoke} colors={colors} disabled={loading} danger />
              </>
            ) : (
              <Action label="Создать ссылку" onPress={create} colors={colors} disabled={loading || !itemUuid} />
            )}
            <Action label="Закрыть" onPress={onClose} colors={colors} secondary />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Action({ label, onPress, colors, danger, secondary, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        s.btn,
        {
          backgroundColor: danger ? colors.danger : secondary ? colors.bgTertiary : colors.primary,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
      activeOpacity={0.85}
    >
      <Text style={[s.btnText, { color: secondary ? colors.text : '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 18,
  },
  sheet: { borderWidth: 1, borderRadius: 10, padding: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  status: { fontSize: 14, marginBottom: 10 },
  url: { borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 12 },
  actions: { gap: 8 },
  btn: { padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { fontWeight: '600' },
});
