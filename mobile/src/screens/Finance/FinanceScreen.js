import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import ShareLinkSheet from '../../components/ShareLinkSheet';
import SyncStatusBar from '../../components/SyncStatusBar';
import {
  FINANCE_PLAN_KINDS,
  computeFinanceTotals,
  deleteFinanceItem,
  deleteFinancePlan,
  financeBandSlotForDepth,
  flattenFinanceTree,
  getFinanceItemMoveAvailability,
  getFinanceItems,
  getFinancePlans,
  getNextFinanceItemSortOrder,
  getNextFinancePlanSortOrder,
  moveFinanceItemInTree,
  upsertFinanceItem,
  upsertFinanceItems,
  upsertFinancePlan,
} from '../../db/financeRepo';
import { uuidv4 } from '../../lib/uuid';
import { notifyLocalChange, performSync, subscribeSyncStatus } from '../../sync/syncService';
import { useTheme } from '../../theme/ThemeContext';

const PLAN_KIND_LABELS = {
  monthly: 'Monthly',
  project: 'Project',
  one_time: 'One-time',
  general: 'General',
};
const ROW_SAVE_DELAY_MS = 550;
const INDENT_STEP = 16;
const MAX_INDENT = 64;

function nowIso() {
  return new Date().toISOString();
}

function normalizeCurrency(value) {
  return String(value || 'RUB').trim().toUpperCase() || 'RUB';
}

function parseMoneyToCents(value) {
  const input = String(value || '').trim();
  if (input.includes('-')) return null;
  const normalized = input
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function amountInputValue(amountCents) {
  const amount = (Number(amountCents) || 0) / 100;
  return amount ? String(amount).replace('.', ',') : '';
}

function formatMoney(amountCents, currency = 'RUB') {
  const amount = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('ru-RU')} ${currency || ''}`.trim();
  }
}

function collectItemSubtree(items, rootUuid) {
  const ids = new Set([rootUuid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parent_uuid && ids.has(item.parent_uuid) && !ids.has(item.uuid)) {
        ids.add(item.uuid);
        changed = true;
      }
    }
  }
  return ids;
}

function bandBackground(slot, colors) {
  if (slot === 0) return colors.bg === '#1a1a1a' ? '#123747' : '#d9eef5';
  if (slot === 1) return colors.bg === '#1a1a1a' ? '#173141' : '#e6f3f7';
  if (slot === 2) return colors.bg === '#1a1a1a' ? '#1b2b37' : '#f0f7fa';
  return colors.card;
}

export default function FinanceScreen() {
  const { colors } = useTheme();
  const [plans, setPlans] = useState([]);
  const [activePlanUuid, setActivePlanUuid] = useState(null);
  const [items, setItems] = useState([]);
  const [collapsedIds, setCollapsedIds] = useState(new Set());
  const [reorderItemUuid, setReorderItemUuid] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [sharePreparing, setSharePreparing] = useState(false);
  const planTimers = useRef({});
  const itemTimers = useRef({});
  const pendingPlans = useRef({});
  const pendingItems = useRef({});
  const plansRef = useRef(plans);
  const itemsRef = useRef(items);

  useEffect(() => { plansRef.current = plans; }, [plans]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const activePlan = plans.find((plan) => plan.uuid === activePlanUuid) || null;

  const loadData = useCallback(async (preferredPlanUuid = activePlanUuid) => {
    const nextPlans = await getFinancePlans();
    setPlans(nextPlans);
    const selectedUuid = nextPlans.some((plan) => plan.uuid === preferredPlanUuid)
      ? preferredPlanUuid
      : nextPlans[0]?.uuid || null;
    setActivePlanUuid(selectedUuid);
    if (selectedUuid) {
      setItems(await getFinanceItems(selectedUuid));
    } else {
      setItems([]);
    }
  }, [activePlanUuid]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useEffect(() => {
    let wasSyncing = false;
    const unsubscribe = subscribeSyncStatus((evt) => {
      if (evt.type !== 'syncing') return;
      if (evt.value) {
        wasSyncing = true;
        return;
      }
      if (wasSyncing) {
        wasSyncing = false;
        loadData(activePlanUuid).catch((e) => console.warn('Finance reload failed:', e));
      }
    });
    return unsubscribe;
  }, [activePlanUuid, loadData]);

  useEffect(() => () => {
    Object.values(planTimers.current).forEach(clearTimeout);
    Object.values(itemTimers.current).forEach(clearTimeout);
  }, []);

  const savePlan = useCallback(async (plan) => {
    if (!plan?.uuid) return;
    await upsertFinancePlan(plan);
    notifyLocalChange();
  }, []);

  const saveItem = useCallback(async (item) => {
    if (!item?.uuid || !item.plan_uuid) return;
    await upsertFinanceItem(item);
    notifyLocalChange();
  }, []);

  const queuePlanSave = useCallback((plan) => {
    if (!plan?.uuid) return;
    pendingPlans.current[plan.uuid] = plan;
    if (planTimers.current[plan.uuid]) clearTimeout(planTimers.current[plan.uuid]);
    planTimers.current[plan.uuid] = setTimeout(() => {
      const pending = pendingPlans.current[plan.uuid];
      delete pendingPlans.current[plan.uuid];
      delete planTimers.current[plan.uuid];
      savePlan(pending).catch((e) => Alert.alert('Finance save failed', String(e?.message || e)));
    }, ROW_SAVE_DELAY_MS);
  }, [savePlan]);

  const queueItemSave = useCallback((item) => {
    if (!item?.uuid) return;
    pendingItems.current[item.uuid] = item;
    if (itemTimers.current[item.uuid]) clearTimeout(itemTimers.current[item.uuid]);
    itemTimers.current[item.uuid] = setTimeout(() => {
      const pending = pendingItems.current[item.uuid];
      delete pendingItems.current[item.uuid];
      delete itemTimers.current[item.uuid];
      saveItem(pending).catch((e) => Alert.alert('Finance save failed', String(e?.message || e)));
    }, ROW_SAVE_DELAY_MS);
  }, [saveItem]);

  const flushPendingSaves = useCallback(async () => {
    Object.values(planTimers.current).forEach(clearTimeout);
    Object.values(itemTimers.current).forEach(clearTimeout);
    planTimers.current = {};
    itemTimers.current = {};
    const planValues = Object.values(pendingPlans.current);
    const itemValues = Object.values(pendingItems.current);
    pendingPlans.current = {};
    pendingItems.current = {};
    for (const plan of planValues) await upsertFinancePlan(plan);
    for (const item of itemValues) await upsertFinanceItem(item);
    if (planValues.length || itemValues.length) notifyLocalChange();
  }, []);

  const patchPlan = useCallback((uuid, patch, options = {}) => {
    let nextPlan = null;
    setPlans((prev) => prev.map((plan) => {
      if (plan.uuid !== uuid) return plan;
      nextPlan = {
        ...plan,
        ...patch,
        currency: patch.currency != null ? normalizeCurrency(patch.currency) : plan.currency,
        updated_at: nowIso(),
      };
      return nextPlan;
    }));
    const current = plansRef.current.find((plan) => plan.uuid === uuid);
    nextPlan = {
      ...current,
      ...patch,
      currency: patch.currency != null ? normalizeCurrency(patch.currency) : current?.currency,
      updated_at: nowIso(),
    };
    if (options.immediate) savePlan(nextPlan).catch((e) => Alert.alert('Finance save failed', String(e?.message || e)));
    else queuePlanSave(nextPlan);
  }, [queuePlanSave, savePlan]);

  const patchItem = useCallback((uuid, patch, options = {}) => {
    let nextItem = null;
    setItems((prev) => prev.map((item) => {
      if (item.uuid !== uuid) return item;
      nextItem = { ...item, ...patch, updated_at: nowIso() };
      return nextItem;
    }));
    const current = itemsRef.current.find((item) => item.uuid === uuid);
    nextItem = { ...current, ...patch, updated_at: nowIso() };
    if (options.immediate) saveItem(nextItem).catch((e) => Alert.alert('Finance save failed', String(e?.message || e)));
    else queueItemSave(nextItem);
  }, [queueItemSave, saveItem]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await flushPendingSaves();
      await performSync();
      await loadData(activePlanUuid);
    } catch (e) {
      Alert.alert('Finance sync failed', String(e?.message || e));
    }
    setRefreshing(false);
  };

  const createPlan = async () => {
    const now = nowIso();
    const plan = {
      uuid: uuidv4(),
      id: null,
      name: 'New finance list',
      currency: 'RUB',
      kind: 'general',
      sort_order: await getNextFinancePlanSortOrder(),
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    };
    await upsertFinancePlan(plan);
    notifyLocalChange();
    setPlans((prev) => [...prev, plan]);
    setActivePlanUuid(plan.uuid);
    setItems([]);
  };

  const removeActivePlan = () => {
    if (!activePlan) return;
    Alert.alert('Удалить список?', activePlan.name || 'Finance list', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          if (planTimers.current[activePlan.uuid]) clearTimeout(planTimers.current[activePlan.uuid]);
          delete planTimers.current[activePlan.uuid];
          delete pendingPlans.current[activePlan.uuid];
          for (const row of itemsRef.current.filter((item) => item.plan_uuid === activePlan.uuid)) {
            if (itemTimers.current[row.uuid]) clearTimeout(itemTimers.current[row.uuid]);
            delete itemTimers.current[row.uuid];
            delete pendingItems.current[row.uuid];
          }
          await deleteFinancePlan(activePlan.uuid);
          notifyLocalChange();
          const nextPlans = plans.filter((plan) => plan.uuid !== activePlan.uuid);
          setPlans(nextPlans);
          const nextActiveUuid = nextPlans[0]?.uuid || null;
          setActivePlanUuid(nextActiveUuid);
          setItems(nextActiveUuid ? await getFinanceItems(nextActiveUuid) : []);
        },
      },
    ]);
  };

  const createItem = async (parentUuid = null) => {
    if (!activePlanUuid) return;
    const now = nowIso();
    const item = {
      uuid: uuidv4(),
      id: null,
      plan_id: null,
      plan_uuid: activePlanUuid,
      parent_id: null,
      parent_uuid: parentUuid || null,
      name: '',
      amount_cents: 0,
      due_day: null,
      due_date: null,
      note: '',
      sort_order: await getNextFinanceItemSortOrder(activePlanUuid, parentUuid),
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    };
    await upsertFinanceItem(item);
    notifyLocalChange();
    setItems((prev) => [...prev, item]);
    if (parentUuid) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.delete(parentUuid);
        return next;
      });
    }
  };

  const removeItem = (item) => {
    Alert.alert('Удалить строку?', item.name || 'Без названия', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          const deletedIds = collectItemSubtree(itemsRef.current, item.uuid);
          for (const deletedId of deletedIds) {
            if (itemTimers.current[deletedId]) clearTimeout(itemTimers.current[deletedId]);
            delete itemTimers.current[deletedId];
            delete pendingItems.current[deletedId];
          }
          await deleteFinanceItem(item.uuid);
          notifyLocalChange();
          setItems((prev) => prev.filter((row) => !deletedIds.has(row.uuid)));
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            for (const id of deletedIds) next.delete(id);
            return next;
          });
          if (deletedIds.has(reorderItemUuid)) setReorderItemUuid(null);
        },
      },
    ]);
  };

  const toggleCollapse = (uuid, hasChildren) => {
    if (!hasChildren) return;
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const moveSelectedItem = async (direction) => {
    if (!reorderItemUuid) return;
    const previous = itemsRef.current;
    const result = moveFinanceItemInTree(previous, reorderItemUuid, direction, nowIso());
    if (!result.changed.length) return;
    setItems(result.items);
    if (result.parentToExpand) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.delete(result.parentToExpand);
        return next;
      });
    }
    try {
      await upsertFinanceItems(result.changed);
      notifyLocalChange();
    } catch (e) {
      setItems(previous);
      Alert.alert('Finance reorder failed', String(e?.message || e));
    }
  };

  const handleShare = async () => {
    if (!activePlanUuid || sharePreparing) return;
    setSharePreparing(true);
    try {
      await flushPendingSaves();
      await performSync();
      setShareVisible(true);
    } catch (e) {
      Alert.alert('Share failed', String(e?.message || e));
    } finally {
      setSharePreparing(false);
    }
  };

  const flatRows = useMemo(() => flattenFinanceTree(items, { collapsedIds }), [items, collapsedIds]);
  const maxDepth = useMemo(() => flatRows.reduce((max, row) => Math.max(max, row.depth), 0), [flatRows]);
  const totals = useMemo(() => computeFinanceTotals(items), [items]);
  const currency = activePlan?.currency || 'RUB';
  const reorderMoveState = reorderItemUuid
    ? getFinanceItemMoveAvailability(items, reorderItemUuid)
    : { up: false, down: false, left: false, right: false };
  const reorderItem = reorderItemUuid
    ? items.find((item) => item.uuid === reorderItemUuid && !item.is_deleted)
    : null;

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SyncStatusBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={[s.content, reorderItemUuid ? s.contentWithToolbar : null]}
      >
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={[s.heading, { color: colors.text }]}>Finance</Text>
            <Text style={[s.total, { color: colors.textSecondary }]}>
              {formatMoney(totals.grandTotal, currency)}
            </Text>
          </View>
          <View style={s.headerActions}>
            {activePlan ? (
              <TouchableOpacity
                style={[s.iconBtn, { borderColor: colors.border, opacity: sharePreparing ? 0.55 : 1 }]}
                onPress={handleShare}
                disabled={sharePreparing}
              >
                <Text style={[s.iconText, { color: colors.primary }]}>🔗</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[s.addBtn, { backgroundColor: colors.primary }]} onPress={createPlan}>
              <Text style={s.addBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {plans.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.planStrip}>
            {plans.map((plan) => (
              <TouchableOpacity
                key={plan.uuid}
                style={[
                  s.planChip,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  plan.uuid === activePlanUuid && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                ]}
                onPress={async () => {
                  await flushPendingSaves();
                  setActivePlanUuid(plan.uuid);
                  setItems(await getFinanceItems(plan.uuid));
                  setReorderItemUuid(null);
                }}
              >
                <Text
                  style={[s.planChipTitle, { color: plan.uuid === activePlanUuid ? colors.primary : colors.text }]}
                  numberOfLines={1}
                >
                  {plan.name || 'Untitled'}
                </Text>
                <Text style={[s.planChipMeta, { color: colors.textMuted }]}>
                  {PLAN_KIND_LABELS[plan.kind] || PLAN_KIND_LABELS.monthly} · {plan.currency || 'RUB'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {activePlan ? (
          <>
            <View style={[s.planEditor, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TextInput
                style={[s.planNameInput, { color: colors.text, borderColor: colors.border }]}
                value={activePlan.name || ''}
                onChangeText={(name) => patchPlan(activePlan.uuid, { name })}
                placeholder="Название списка"
                placeholderTextColor={colors.textMuted}
              />
              <View style={s.planMetaRow}>
                <TextInput
                  style={[s.currencyInput, { color: colors.text, borderColor: colors.border }]}
                  value={activePlan.currency || 'RUB'}
                  onChangeText={(currencyText) => patchPlan(activePlan.uuid, { currency: currencyText })}
                  autoCapitalize="characters"
                  maxLength={6}
                />
                <TouchableOpacity style={[s.deletePlanBtn, { borderColor: colors.danger }]} onPress={removeActivePlan}>
                  <Text style={[s.deletePlanText, { color: colors.danger }]}>🗑</Text>
                </TouchableOpacity>
              </View>
              <View style={s.kindRow}>
                {FINANCE_PLAN_KINDS.map((kind) => (
                  <TouchableOpacity
                    key={kind}
                    style={[
                      s.kindBtn,
                      { borderColor: colors.border },
                      activePlan.kind === kind && { backgroundColor: colors.primaryLight, borderColor: colors.primary },
                    ]}
                    onPress={() => patchPlan(activePlan.uuid, { kind }, { immediate: true })}
                  >
                    <Text style={[s.kindText, { color: activePlan.kind === kind ? colors.primary : colors.textSecondary }]}>
                      {PLAN_KIND_LABELS[kind]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={s.rowsHeader}>
              <Text style={[s.sectionTitle, { color: colors.textSecondary }]}>Rows</Text>
              <TouchableOpacity onPress={() => createItem(null)}>
                <Text style={[s.linkAction, { color: colors.primary }]}>Добавить строку</Text>
              </TouchableOpacity>
            </View>

            {flatRows.length ? (
              flatRows.map((row) => (
                <FinanceRow
                  key={row.item.uuid}
                  row={row}
                  colors={colors}
                  currency={currency}
                  planKind={activePlan.kind || 'monthly'}
                  total={totals.totals.get(row.item.uuid) || 0}
                  maxDepth={maxDepth}
                  isCollapsed={collapsedIds.has(row.item.uuid)}
                  isSelected={reorderItemUuid === row.item.uuid}
                  onToggleCollapse={toggleCollapse}
                  onPatchItem={patchItem}
                  onAddChild={createItem}
                  onDelete={removeItem}
                  onSelectReorder={setReorderItemUuid}
                />
              ))
            ) : (
              <View style={[s.emptyBox, { borderColor: colors.border }]}>
                <Text style={[s.emptyText, { color: colors.textMuted }]}>Нет строк затрат</Text>
                <TouchableOpacity style={[s.emptyAction, { backgroundColor: colors.primary }]} onPress={() => createItem(null)}>
                  <Text style={s.emptyActionText}>Добавить первую строку</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <View style={[s.emptyBox, { borderColor: colors.border }]}>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>Нет финансовых списков</Text>
            <TouchableOpacity style={[s.emptyAction, { backgroundColor: colors.primary }]} onPress={createPlan}>
              <Text style={s.emptyActionText}>Создать список</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {reorderItemUuid ? (
        <View style={[s.reorderToolbar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.reorderTitle, { color: colors.text }]} numberOfLines={1}>
            {reorderItem?.name || 'Строка'}
          </Text>
          <View style={s.reorderControls}>
            <ReorderButton label="↑" colors={colors} disabled={!reorderMoveState.up} onPress={() => moveSelectedItem('up')} />
            <ReorderButton label="↓" colors={colors} disabled={!reorderMoveState.down} onPress={() => moveSelectedItem('down')} />
            <ReorderButton label="←" colors={colors} disabled={!reorderMoveState.left} onPress={() => moveSelectedItem('left')} />
            <ReorderButton label="→" colors={colors} disabled={!reorderMoveState.right} onPress={() => moveSelectedItem('right')} />
            <TouchableOpacity style={[s.reorderOkBtn, { backgroundColor: colors.primary }]} onPress={() => setReorderItemUuid(null)}>
              <Text style={s.reorderOkText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <ShareLinkSheet
        visible={shareVisible}
        itemType="finance_plan"
        itemUuid={activePlanUuid}
        onClose={() => setShareVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

function FinanceRow({
  row,
  colors,
  currency,
  planKind,
  total,
  maxDepth,
  isCollapsed,
  isSelected,
  onToggleCollapse,
  onPatchItem,
  onAddChild,
  onDelete,
  onSelectReorder,
}) {
  const { item, depth, hasChildren, hiddenDescendantCount } = row;
  const bandSlot = financeBandSlotForDepth(depth, maxDepth, 'soft_first');
  const backgroundColor = isSelected ? colors.primaryLight : bandBackground(bandSlot, colors);
  const dueValue = planKind === 'monthly'
    ? (item.due_day == null ? '' : String(item.due_day))
    : (item.due_date || '');

  const handleAmountChange = (text) => {
    const cents = parseMoneyToCents(text);
    if (cents == null) return;
    onPatchItem(item.uuid, { amount_cents: cents });
  };

  const handleDateChange = (text) => {
    if (planKind === 'monthly') {
      const raw = String(text || '').replace(/[^\d]/g, '').slice(0, 2);
      const day = raw ? Number(raw) : null;
      onPatchItem(item.uuid, { due_day: day && day >= 1 && day <= 31 ? day : null });
    } else {
      onPatchItem(item.uuid, { due_date: String(text || '').slice(0, 10) });
    }
  };

  return (
    <View
      style={[
        s.rowCard,
        { borderColor: isSelected ? colors.primary : colors.border, backgroundColor },
      ]}
    >
      <View style={s.rowTop}>
        <TouchableOpacity
          style={[s.collapseBtn, { borderColor: colors.border }]}
          onPress={() => onToggleCollapse(item.uuid, hasChildren)}
          activeOpacity={hasChildren ? 0.7 : 1}
        >
          <Text style={[s.collapseText, { color: hasChildren ? colors.primary : colors.textMuted }]}>
            {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
          </Text>
        </TouchableOpacity>
        <View style={[s.nameWrap, depth ? { paddingLeft: Math.min(depth * INDENT_STEP, MAX_INDENT) } : null]}>
          <TextInput
            style={[
              s.rowNameInput,
              hasChildren && s.rowNameGroup,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={item.name || ''}
            onChangeText={(name) => onPatchItem(item.uuid, { name })}
            placeholder="Название"
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </View>
        {hiddenDescendantCount ? (
          <Text style={[s.hiddenCount, { color: colors.textMuted }]}>{hiddenDescendantCount}</Text>
        ) : null}
      </View>

      <View style={s.rowFields}>
        <View style={s.fieldBlock}>
          <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Amount</Text>
          <TextInput
            style={[s.fieldInput, { color: colors.text, borderColor: colors.border }]}
            defaultValue={amountInputValue(item.amount_cents)}
            onChangeText={handleAmountChange}
            onEndEditing={(event) => handleAmountChange(event.nativeEvent.text)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={s.fieldBlock}>
          <Text style={[s.fieldLabel, { color: colors.textMuted }]}>{planKind === 'monthly' ? 'Day' : 'Date'}</Text>
          <TextInput
            style={[s.fieldInput, { color: colors.text, borderColor: colors.border }]}
            value={dueValue}
            onChangeText={handleDateChange}
            keyboardType={planKind === 'monthly' ? 'number-pad' : 'default'}
            placeholder={planKind === 'monthly' ? '21' : 'YYYY-MM-DD'}
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={s.totalBlock}>
          <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Total</Text>
          <Text style={[s.rowTotal, hasChildren && s.rowTotalGroup, { color: colors.text }]} numberOfLines={1}>
            {formatMoney(total, currency)}
          </Text>
        </View>
      </View>

      <TextInput
        style={[s.noteInput, { color: colors.textSecondary, borderColor: colors.border }]}
        value={item.note || ''}
        onChangeText={(note) => onPatchItem(item.uuid, { note })}
        placeholder="Note"
        placeholderTextColor={colors.textMuted}
      />

      <View style={s.rowActions}>
        <SmallAction label="+ child" colors={colors} onPress={() => onAddChild(item.uuid)} />
        <SmallAction label="Move" colors={colors} onPress={() => onSelectReorder(isSelected ? null : item.uuid)} active={isSelected} />
        <SmallAction label="Del" colors={colors} onPress={() => onDelete(item)} danger />
      </View>
    </View>
  );
}

function SmallAction({ label, colors, onPress, danger, active }) {
  return (
    <TouchableOpacity
      style={[
        s.smallAction,
        { borderColor: danger ? colors.danger : active ? colors.primary : colors.border },
        active && { backgroundColor: colors.primaryLight },
      ]}
      onPress={onPress}
    >
      <Text style={[s.smallActionText, { color: danger ? colors.danger : active ? colors.primary : colors.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ReorderButton({ label, colors, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[
        s.reorderBtn,
        { borderColor: disabled ? colors.border : colors.primary, opacity: disabled ? 0.45 : 1 },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[s.reorderBtnText, { color: disabled ? colors.textMuted : colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 24 },
  contentWithToolbar: { paddingBottom: 104 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  headerText: { flex: 1, minWidth: 0 },
  heading: { fontSize: 22, fontWeight: '700' },
  total: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 17, fontWeight: '700' },
  addBtn: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, lineHeight: 26, fontWeight: '500' },
  planStrip: { paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  planChip: { width: 164, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  planChipTitle: { fontSize: 13, fontWeight: '700' },
  planChipMeta: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  planEditor: { margin: 12, marginTop: 6, borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  planNameInput: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, fontWeight: '700' },
  planMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currencyInput: { flex: 1, borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontWeight: '600' },
  deletePlanBtn: { width: 42, height: 38, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  deletePlanText: { fontSize: 16 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  kindBtn: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  kindText: { fontSize: 12, fontWeight: '700' },
  rowsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  linkAction: { fontSize: 13, fontWeight: '700' },
  rowCard: { borderWidth: 1, borderRadius: 8, marginHorizontal: 12, marginVertical: 4, padding: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  collapseBtn: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  collapseText: { fontSize: 16, lineHeight: 18, fontWeight: '800' },
  nameWrap: { flex: 1, minWidth: 0 },
  rowNameInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, minHeight: 32 },
  rowNameGroup: { fontWeight: '800' },
  hiddenCount: { fontSize: 11, fontWeight: '700', paddingTop: 7 },
  rowFields: { flexDirection: 'row', gap: 7, marginTop: 8 },
  fieldBlock: { flex: 0.78 },
  totalBlock: { flex: 1.08 },
  fieldLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 3 },
  fieldInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 34, fontSize: 13 },
  rowTotal: { fontSize: 13, fontWeight: '700', paddingTop: 8 },
  rowTotalGroup: { fontWeight: '800' },
  noteInput: { marginTop: 8, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  smallAction: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 },
  smallActionText: { fontSize: 12, fontWeight: '700' },
  emptyBox: { margin: 16, borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, marginBottom: 12 },
  emptyAction: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  emptyActionText: { color: '#fff', fontWeight: '700' },
  reorderToolbar: { position: 'absolute', left: 10, right: 10, bottom: 10, borderWidth: 1, borderRadius: 10, padding: 10, elevation: 8 },
  reorderTitle: { fontSize: 13, fontWeight: '800', marginBottom: 8 },
  reorderControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reorderBtn: { width: 39, height: 34, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  reorderBtnText: { fontSize: 17, fontWeight: '800' },
  reorderOkBtn: { marginLeft: 'auto', height: 34, paddingHorizontal: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  reorderOkText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
