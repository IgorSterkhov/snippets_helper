import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  applyFinanceMappingRule,
  computeFinanceTotals,
  createFinanceMappingRule,
  createFinanceTransactionAllocation,
  deleteFinanceItem,
  deleteFinancePlan,
  financeBandSlotForDepth,
  flattenFinanceTree,
  getAllFinanceItems,
  getFinanceItemMoveAvailability,
  getFinanceItems,
  getFinanceMappingRules,
  getFinancePlans,
  getFinanceTransactionAllocations,
  getFinanceTransactions,
  getNextFinanceItemSortOrder,
  getNextFinancePlanSortOrder,
  maxFinanceTreeDepth,
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
const FACT_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unmapped', label: 'Unmapped' },
  { value: 'locked', label: 'Locked' },
];

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

function formatDueHint(item, planKind) {
  if (planKind === 'monthly') {
    return item?.due_day ? `${item.due_day}-е` : '';
  }
  return item?.due_date || '';
}

function parseSignedMoneyToCents(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  const normalized = input
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function createRuleConditionsFromForm({ category, description, mcc, direction, minAmount, maxAmount }) {
  const conditions = [];
  if (String(category || '').trim()) {
    conditions.push({ field: 'bank_category', op: 'contains', value: String(category).trim() });
  }
  if (String(description || '').trim()) {
    conditions.push({ field: 'description', op: 'contains', value: String(description).trim() });
  }
  if (String(mcc || '').trim()) {
    conditions.push({ field: 'mcc', op: 'equals', value: String(mcc).trim() });
  }
  if (direction && direction !== 'any') {
    conditions.push({ field: 'direction', op: 'equals', value: direction });
  }
  const minCents = parseSignedMoneyToCents(minAmount);
  const maxCents = parseSignedMoneyToCents(maxAmount);
  if (minCents != null) conditions.push({ field: 'amount_cents', op: 'gte', value: String(minCents / 100) });
  if (maxCents != null) conditions.push({ field: 'amount_cents', op: 'lte', value: String(maxCents / 100) });
  return conditions;
}

function transactionDirection(transaction) {
  const amount = Number(transaction?.amount_cents) || 0;
  if (amount < 0) return 'expense';
  if (amount > 0) return 'income';
  return 'any';
}

export default function FinanceScreen() {
  const { colors } = useTheme();
  const [activeMode, setActiveMode] = useState('lists');
  const [plans, setPlans] = useState([]);
  const [activePlanUuid, setActivePlanUuid] = useState(null);
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [mappingRules, setMappingRules] = useState([]);
  const [factsFilter, setFactsFilter] = useState('all');
  const [factsMonth, setFactsMonth] = useState('');
  const [mappingTransactionUuid, setMappingTransactionUuid] = useState(null);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [ruleSeed, setRuleSeed] = useState(null);
  const [factsLoading, setFactsLoading] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(new Set());
  const [reorderItemUuid, setReorderItemUuid] = useState(null);
  const [editingItemUuid, setEditingItemUuid] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [sharePreparing, setSharePreparing] = useState(false);
  const planTimers = useRef({});
  const itemTimers = useRef({});
  const pendingPlans = useRef({});
  const pendingItems = useRef({});
  const activeModeRef = useRef(activeMode);
  const activePlanUuidRef = useRef(activePlanUuid);
  const plansRef = useRef(plans);
  const itemsRef = useRef(items);

  useEffect(() => { activeModeRef.current = activeMode; }, [activeMode]);
  useEffect(() => { activePlanUuidRef.current = activePlanUuid; }, [activePlanUuid]);
  useEffect(() => { plansRef.current = plans; }, [plans]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const activePlan = plans.find((plan) => plan.uuid === activePlanUuid) || null;

  const loadData = useCallback(async (preferredPlanUuid = activePlanUuidRef.current) => {
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
  }, []);

  const loadFactsData = useCallback(async () => {
    setFactsLoading(true);
    try {
      const [nextPlans, nextItems, nextTransactions, nextAllocations, nextRules] = await Promise.all([
        getFinancePlans(),
        getAllFinanceItems(),
        getFinanceTransactions(),
        getFinanceTransactionAllocations(),
        getFinanceMappingRules(),
      ]);
      setPlans(nextPlans);
      setAllItems(nextItems);
      setTransactions(nextTransactions);
      setAllocations(nextAllocations);
      setMappingRules(nextRules);
      if (!nextPlans.some((plan) => plan.uuid === activePlanUuidRef.current)) {
        setActivePlanUuid(nextPlans[0]?.uuid || null);
      }
    } finally {
      setFactsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (activeModeRef.current === 'facts') {
      loadFactsData();
    } else {
      loadData();
    }
  }, [loadData, loadFactsData]));

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
        const loader = activeModeRef.current === 'facts'
          ? loadFactsData()
          : loadData(activePlanUuidRef.current);
        loader.catch((e) => console.warn('Finance reload failed:', e));
      }
    });
    return unsubscribe;
  }, [loadData, loadFactsData]);

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
      if (activeModeRef.current === 'facts') {
        await loadFactsData();
      } else {
        await loadData(activePlanUuidRef.current);
      }
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
          if (deletedIds.has(editingItemUuid)) setEditingItemUuid(null);
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

  const closeItemEditor = useCallback(async () => {
    setEditingItemUuid(null);
    try {
      await flushPendingSaves();
    } catch (e) {
      Alert.alert('Finance save failed', String(e?.message || e));
    }
  }, [flushPendingSaves]);

  const flatRows = useMemo(() => flattenFinanceTree(items, { collapsedIds }), [items, collapsedIds]);
  const maxDepth = useMemo(() => maxFinanceTreeDepth(items), [items]);
  const totals = useMemo(() => computeFinanceTotals(items), [items]);
  const allTotals = useMemo(() => computeFinanceTotals(allItems), [allItems]);
  const currency = activePlan?.currency || 'RUB';
  const planByUuid = useMemo(() => new Map(plans.map((plan) => [plan.uuid, plan])), [plans]);
  const itemByUuid = useMemo(() => new Map(allItems.map((item) => [item.uuid, item])), [allItems]);
  const allocationByTransaction = useMemo(() => {
    const map = new Map();
    for (const allocation of allocations) {
      if (!allocation?.transaction_uuid || allocation.is_deleted || !allocation.is_active) continue;
      map.set(allocation.transaction_uuid, allocation);
    }
    return map;
  }, [allocations]);
  const filteredFacts = useMemo(() => transactions.filter((transaction) => {
    if (!transaction || transaction.is_deleted) return false;
    const allocation = allocationByTransaction.get(transaction.uuid);
    if (factsFilter === 'unmapped' && allocation) return false;
    if (factsFilter === 'locked' && !transaction.rules_locked) return false;
    if (factsMonth && /^\d{4}-\d{2}$/.test(factsMonth)) {
      return String(transaction.payment_date || '').startsWith(`${factsMonth}-`);
    }
    return true;
  }), [transactions, allocationByTransaction, factsFilter, factsMonth]);
  const unmappedCount = useMemo(
    () => transactions.filter((transaction) => !transaction.is_deleted && !allocationByTransaction.has(transaction.uuid)).length,
    [transactions, allocationByTransaction],
  );
  const mappingTransaction = mappingTransactionUuid
    ? transactions.find((transaction) => transaction.uuid === mappingTransactionUuid)
    : null;
  const reorderMoveState = reorderItemUuid
    ? getFinanceItemMoveAvailability(items, reorderItemUuid)
    : { up: false, down: false, left: false, right: false };
  const reorderItem = reorderItemUuid
    ? items.find((item) => item.uuid === reorderItemUuid && !item.is_deleted)
    : null;
  const editingItem = editingItemUuid
    ? items.find((item) => item.uuid === editingItemUuid && !item.is_deleted)
    : null;

  const showListsMode = activeMode === 'lists';

  const switchMode = async (mode) => {
    setActiveMode(mode);
    if (mode === 'facts') {
      await flushPendingSaves();
      await loadFactsData();
    } else {
      await loadData(activePlanUuidRef.current);
    }
  };

  const allocationLabel = (allocation) => {
    if (!allocation) return 'Unmapped';
    const plan = planByUuid.get(allocation.plan_uuid);
    const item = allocation.item_uuid ? itemByUuid.get(allocation.item_uuid) : null;
    return [plan?.name || 'Finance list', item?.name].filter(Boolean).join(' / ');
  };

  const saveFactMapping = async ({ transaction, plan, item, rulesLocked }) => {
    try {
      await createFinanceTransactionAllocation({ transaction, plan, item, rulesLocked });
      notifyLocalChange();
      setMappingTransactionUuid(null);
      await loadFactsData();
    } catch (e) {
      Alert.alert('Finance mapping failed', String(e?.message || e));
    }
  };

  const openRuleFromFact = ({ transaction, plan, item }) => {
    setMappingTransactionUuid(null);
    setRuleSeed({ transaction, targetPlan: plan, targetItem: item });
    setRulesVisible(true);
  };

  const saveRule = async (input) => {
    try {
      const result = await createFinanceMappingRule(input);
      notifyLocalChange();
      setRulesVisible(false);
      setRuleSeed(null);
      await loadFactsData();
      if (result?.appliedCount) {
        Alert.alert('Rule applied', `Mapped ${result.appliedCount} fact(s).`);
      }
    } catch (e) {
      Alert.alert('Finance rule failed', String(e?.message || e));
    }
  };

  const applyExistingRule = async (rule) => {
    try {
      const count = await applyFinanceMappingRule(rule, { remapAssigned: false });
      notifyLocalChange();
      await loadFactsData();
      Alert.alert('Rule applied', `Mapped ${count} fact(s).`);
    } catch (e) {
      Alert.alert('Finance rule failed', String(e?.message || e));
    }
  };

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
              {showListsMode
                ? formatMoney(totals.grandTotal, currency)
                : `${filteredFacts.length} fact(s) · ${unmappedCount} unmapped`}
            </Text>
          </View>
          <View style={s.headerActions}>
            {!showListsMode ? (
              <TouchableOpacity
                style={[s.rulesBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => {
                  setRuleSeed(null);
                  setRulesVisible(true);
                }}
              >
                <Text style={[s.rulesBtnText, { color: colors.primary }]}>Rules</Text>
              </TouchableOpacity>
            ) : null}
            {showListsMode && activePlan ? (
              <TouchableOpacity
                style={[s.iconBtn, { borderColor: colors.border, opacity: sharePreparing ? 0.55 : 1 }]}
                onPress={handleShare}
                disabled={sharePreparing}
              >
                <Text style={[s.iconText, { color: colors.primary }]}>🔗</Text>
              </TouchableOpacity>
            ) : null}
            {showListsMode ? (
            <TouchableOpacity style={[s.addBtn, { backgroundColor: colors.primary }]} onPress={createPlan}>
              <Text style={s.addBtnText}>+</Text>
            </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={[s.modeSwitch, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {[
            ['lists', 'Lists'],
            ['facts', 'Facts'],
          ].map(([mode, label]) => (
            <TouchableOpacity
              key={mode}
              style={[
                s.modeBtn,
                activeMode === mode && { backgroundColor: colors.primaryLight },
              ]}
              onPress={() => switchMode(mode).catch((e) => Alert.alert('Finance load failed', String(e?.message || e)))}
            >
              <Text style={[s.modeBtnText, { color: activeMode === mode ? colors.primary : colors.textSecondary }]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {showListsMode && plans.length ? (
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

        {showListsMode && activePlan ? (
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
                  onOpenEditor={setEditingItemUuid}
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
        ) : null}

        {!showListsMode ? (
          <FactsPanel
            colors={colors}
            facts={filteredFacts}
            factsFilter={factsFilter}
            factsMonth={factsMonth}
            factsLoading={factsLoading}
            allocationsByTransaction={allocationByTransaction}
            allocationLabel={allocationLabel}
            currencyByPlan={planByUuid}
            onFilterChange={setFactsFilter}
            onMonthChange={setFactsMonth}
            onMap={(transaction) => setMappingTransactionUuid(transaction.uuid)}
          />
        ) : null}

        {showListsMode && !activePlan ? (
          <View style={[s.emptyBox, { borderColor: colors.border }]}>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>Нет финансовых списков</Text>
            <TouchableOpacity style={[s.emptyAction, { backgroundColor: colors.primary }]} onPress={createPlan}>
              <Text style={s.emptyActionText}>Создать список</Text>
            </TouchableOpacity>
          </View>
        ) : null}
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

      <FinanceItemEditorSheet
        visible={!!editingItem}
        item={editingItem}
        colors={colors}
        currency={currency}
        planKind={activePlan?.kind || 'monthly'}
        total={editingItem ? totals.totals.get(editingItem.uuid) || 0 : 0}
        onClose={closeItemEditor}
        onPatchItem={patchItem}
        onAddChild={async (uuid) => {
          await createItem(uuid);
          setEditingItemUuid(null);
        }}
        onMove={(uuid) => {
          setReorderItemUuid(uuid);
          setEditingItemUuid(null);
        }}
        onDelete={(item) => {
          setEditingItemUuid(null);
          removeItem(item);
        }}
      />

      <MapFinanceFactSheet
        visible={!!mappingTransaction}
        transaction={mappingTransaction}
        allocation={mappingTransaction ? allocationByTransaction.get(mappingTransaction.uuid) : null}
        plans={plans}
        items={allItems}
        totals={allTotals.totals}
        colors={colors}
        onClose={() => setMappingTransactionUuid(null)}
        onSave={saveFactMapping}
        onCreateRule={openRuleFromFact}
      />

      <FinanceRulesSheet
        visible={rulesVisible}
        seed={ruleSeed}
        rules={mappingRules}
        plans={plans}
        items={allItems}
        totals={allTotals.totals}
        colors={colors}
        onClose={() => {
          setRulesVisible(false);
          setRuleSeed(null);
        }}
        onSave={saveRule}
        onApplyRule={applyExistingRule}
      />

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
  onOpenEditor,
}) {
  const { item, depth, hasChildren, hiddenDescendantCount } = row;
  const bandSlot = financeBandSlotForDepth(depth, maxDepth, 'soft_first');
  const backgroundColor = isSelected ? colors.primaryLight : bandBackground(bandSlot, colors);
  const dueLabel = formatDueHint(item, planKind);
  const directAmount = Number(item.amount_cents) || 0;
  const showDirectAmount = hasChildren && directAmount > 0 && directAmount !== total;

  return (
    <TouchableOpacity
      style={[
        s.rowCard,
        { borderColor: isSelected ? colors.primary : colors.border, backgroundColor },
      ]}
      activeOpacity={0.82}
      onPress={() => onOpenEditor(item.uuid)}
    >
      <TouchableOpacity
        style={s.compactCollapseHit}
        onPress={() => onToggleCollapse(item.uuid, hasChildren)}
        activeOpacity={hasChildren ? 0.7 : 1}
      >
        <Text style={[s.compactCollapseText, { color: hasChildren ? colors.primary : colors.textMuted }]}>
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </Text>
      </TouchableOpacity>
      <View style={[s.compactMain, depth ? { paddingLeft: Math.min(depth * INDENT_STEP, MAX_INDENT) } : null]}>
        <View style={s.compactTitleRow}>
          <Text
            style={[
              s.compactTitle,
              hasChildren && s.compactGroupTitle,
              { color: colors.text },
            ]}
            numberOfLines={1}
          >
            {item.name || 'Без названия'}
          </Text>
          {hiddenDescendantCount ? (
            <Text style={[s.compactHiddenCount, { color: colors.textMuted }]}>{hiddenDescendantCount}</Text>
          ) : null}
        </View>
        {item.note || dueLabel ? (
          <Text style={[s.compactHint, { color: colors.textMuted }]} numberOfLines={1}>
            {[dueLabel, item.note].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={s.compactAmounts}>
        <Text style={[s.compactTotal, hasChildren && s.compactGroupTotal, { color: colors.text }]} numberOfLines={1}>
          {formatMoney(total, currency)}
        </Text>
        {showDirectAmount ? (
          <Text style={[s.compactDirectAmount, { color: colors.textMuted }]} numberOfLines={1}>
            + {formatMoney(directAmount, currency)}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function FactsPanel({
  colors,
  facts,
  factsFilter,
  factsMonth,
  factsLoading,
  allocationsByTransaction,
  allocationLabel,
  onFilterChange,
  onMonthChange,
  onMap,
}) {
  return (
    <View style={s.factsRoot}>
      <View style={s.factsFilters}>
        {FACT_FILTERS.map((filter) => (
          <TouchableOpacity
            key={filter.value}
            style={[
              s.filterChip,
              { borderColor: colors.border, backgroundColor: colors.card },
              factsFilter === filter.value && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
            ]}
            onPress={() => onFilterChange(filter.value)}
          >
            <Text style={[s.filterChipText, { color: factsFilter === filter.value ? colors.primary : colors.textSecondary }]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TextInput
          style={[s.monthInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={factsMonth}
          onChangeText={(text) => onMonthChange(String(text || '').replace(/[^\d-]/g, '').slice(0, 7))}
          placeholder="YYYY-MM"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {factsLoading ? (
        <Text style={[s.factsLoading, { color: colors.textMuted }]}>Loading...</Text>
      ) : null}

      {facts.length ? (
        facts.map((transaction) => (
          <FactCard
            key={transaction.uuid}
            transaction={transaction}
            allocation={allocationsByTransaction.get(transaction.uuid)}
            allocationLabel={allocationLabel}
            colors={colors}
            onMap={() => onMap(transaction)}
          />
        ))
      ) : (
        <View style={[s.emptyBox, { borderColor: colors.border }]}>
          <Text style={[s.emptyText, { color: colors.textMuted }]}>No finance facts for this filter</Text>
        </View>
      )}
    </View>
  );
}

function FactCard({ transaction, allocation, allocationLabel, colors, onMap }) {
  const mapped = !!allocation;
  const amountColor = Number(transaction.amount_cents) < 0 ? colors.danger : colors.success;
  return (
    <TouchableOpacity
      style={[s.factCard, { borderColor: colors.border, backgroundColor: colors.card }]}
      activeOpacity={0.88}
      onPress={onMap}
    >
      <View style={s.factTopRow}>
        <Text style={[s.factDate, { color: colors.textMuted }]}>{formatDueDate(transaction.payment_date || transaction.operation_at)}</Text>
        <Text style={[s.factAmount, { color: amountColor }]}>{formatMoney(transaction.amount_cents, transaction.currency || 'RUB')}</Text>
      </View>
      <Text style={[s.factDescription, { color: colors.text }]} numberOfLines={2}>
        {transaction.description || 'Без описания'}
      </Text>
      <Text style={[s.factMeta, { color: colors.textMuted }]} numberOfLines={1}>
        {[transaction.bank_category, transaction.mcc ? `MCC ${transaction.mcc}` : '', transaction.card_mask].filter(Boolean).join(' · ')}
      </Text>
      <View style={s.factBottomRow}>
        <View
          style={[
            s.factMappingBadge,
            { borderColor: mapped ? colors.primary : colors.border, backgroundColor: mapped ? colors.primaryLight : colors.bgSecondary },
          ]}
        >
          <Text style={[s.factMappingText, { color: mapped ? colors.primary : colors.textMuted }]} numberOfLines={1}>
            {allocationLabel(allocation)}
          </Text>
        </View>
        {transaction.rules_locked ? (
          <Text style={[s.factLock, { color: colors.textMuted }]}>🔒</Text>
        ) : null}
        <TouchableOpacity style={[s.mapBtn, { backgroundColor: colors.primary }]} onPress={onMap}>
          <Text style={s.mapBtnText}>{mapped ? 'Edit' : 'Map'}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function formatDueDate(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [year, month, day] = text.slice(0, 10).split('-');
    return `${day}.${month}.${year}`;
  }
  return text;
}

function planItems(items, planUuid) {
  return items.filter((item) => item.plan_uuid === planUuid && !item.is_deleted);
}

function terminalItemSet(items) {
  const parents = new Set(items.map((item) => item.parent_uuid).filter(Boolean));
  return new Set(items.filter((item) => !parents.has(item.uuid)).map((item) => item.uuid));
}

function MapFinanceFactSheet({
  visible,
  transaction,
  allocation,
  plans,
  items,
  totals,
  colors,
  onClose,
  onSave,
  onCreateRule,
}) {
  const [selectedPlanUuid, setSelectedPlanUuid] = useState('');
  const [selectedItemUuid, setSelectedItemUuid] = useState('');
  const [rulesLocked, setRulesLocked] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const nextPlanUuid = allocation?.plan_uuid || plans[0]?.uuid || '';
    setSelectedPlanUuid(nextPlanUuid);
    setSelectedItemUuid(allocation?.item_uuid || '');
    setRulesLocked(Boolean(transaction?.rules_locked));
  }, [visible, allocation?.uuid, allocation?.plan_uuid, allocation?.item_uuid, plans, transaction?.uuid, transaction?.rules_locked]);

  if (!transaction) return null;

  const selectedPlan = plans.find((plan) => plan.uuid === selectedPlanUuid) || null;
  const selectedItem = items.find((item) => item.uuid === selectedItemUuid) || null;

  const handleSave = () => {
    if (!selectedPlan) {
      Alert.alert('Choose finance list', 'Select a target list first.');
      return;
    }
    if (!selectedItem) {
      Alert.alert('Choose finance item', 'Select a terminal finance item first.');
      return;
    }
    onSave({ transaction, plan: selectedPlan, item: selectedItem, rulesLocked });
  };

  const handleCreateRule = () => {
    if (!selectedPlan || !selectedItem) {
      Alert.alert('Choose target', 'Select a target list and terminal item before creating a rule.');
      return;
    }
    onCreateRule({ transaction, plan: selectedPlan, item: selectedItem });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, s.mapSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={[s.sheetTitle, { color: colors.text }]}>Map finance fact</Text>
            <Text style={[s.sheetTotal, { color: Number(transaction.amount_cents) < 0 ? colors.danger : colors.success }]}>
              {formatMoney(transaction.amount_cents, transaction.currency || 'RUB')}
            </Text>
          </View>
          <Text style={[s.factSheetDescription, { color: colors.text }]} numberOfLines={2}>
            {transaction.description || 'Без описания'}
          </Text>
          <Text style={[s.factMeta, { color: colors.textMuted }]} numberOfLines={1}>
            {[formatDueDate(transaction.payment_date), transaction.bank_category, transaction.mcc ? `MCC ${transaction.mcc}` : ''].filter(Boolean).join(' · ')}
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sheetPlanStrip}>
            {plans.map((plan) => (
              <TouchableOpacity
                key={plan.uuid}
                style={[
                  s.sheetPlanChip,
                  { borderColor: colors.border },
                  selectedPlanUuid === plan.uuid && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                ]}
                onPress={() => {
                  setSelectedPlanUuid(plan.uuid);
                  setSelectedItemUuid('');
                }}
              >
                <Text style={[s.sheetPlanChipText, { color: selectedPlanUuid === plan.uuid ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                  {plan.name || 'Untitled'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TerminalItemPicker
            colors={colors}
            plan={selectedPlan}
            items={items}
            totals={totals}
            selectedItemUuid={selectedItemUuid}
            onSelect={setSelectedItemUuid}
          />

          <TouchableOpacity style={s.lockRow} onPress={() => setRulesLocked((value) => !value)}>
            <Text style={[s.checkboxBox, { borderColor: colors.border, color: colors.primary }]}>{rulesLocked ? '✓' : ''}</Text>
            <Text style={[s.lockText, { color: colors.textSecondary }]}>Keep this manual mapping unchanged when rules run</Text>
          </TouchableOpacity>

          <View style={s.sheetActions}>
            <SmallAction label="Create rule" colors={colors} onPress={handleCreateRule} />
            <TouchableOpacity style={[s.sheetDoneBtn, { backgroundColor: colors.primary }]} onPress={handleSave}>
              <Text style={s.sheetDoneText}>Save mapping</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FinanceRulesSheet({
  visible,
  seed,
  rules,
  plans,
  items,
  totals,
  colors,
  onClose,
  onSave,
  onApplyRule,
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [mcc, setMcc] = useState('');
  const [direction, setDirection] = useState('expense');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedPlanUuid, setSelectedPlanUuid] = useState('');
  const [selectedItemUuid, setSelectedItemUuid] = useState('');
  const [applyExisting, setApplyExisting] = useState(true);
  const [remapAssigned, setRemapAssigned] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const transaction = seed?.transaction || null;
    setName(transaction
      ? [transaction.bank_category, transaction.description].filter(Boolean).join(' · ') || 'New mapping rule'
      : 'New mapping rule');
    setCategory(transaction?.bank_category || '');
    setDescription(transaction?.description || '');
    setMcc(transaction?.mcc || '');
    setDirection(transactionDirection(transaction));
    setMinAmount('');
    setMaxAmount('');
    setSelectedPlanUuid(seed?.targetPlan?.uuid || plans[0]?.uuid || '');
    setSelectedItemUuid(seed?.targetItem?.uuid || '');
    setApplyExisting(true);
    setRemapAssigned(false);
  }, [visible, seed, plans]);

  const selectedPlan = plans.find((plan) => plan.uuid === selectedPlanUuid) || null;
  const selectedItem = items.find((item) => item.uuid === selectedItemUuid) || null;

  const handleSave = () => {
    if (!selectedPlan || !selectedItem) {
      Alert.alert('Choose target', 'Select a target list and terminal item first.');
      return;
    }
    const conditions = createRuleConditionsFromForm({ category, description, mcc, direction, minAmount, maxAmount });
    if (!conditions.length) {
      Alert.alert('Rule condition required', 'Set at least one condition.');
      return;
    }
    onSave({
      name: name || 'New mapping rule',
      isEnabled: true,
      priority: (rules?.length || 0) + 1,
      matchMode: 'all',
      conditions,
      targetPlan: selectedPlan,
      targetItem: selectedItem,
      applyExisting,
      remapAssigned,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, s.rulesSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={[s.sheetTitle, { color: colors.text }]}>Finance mapping rules</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[s.closeText, { color: colors.textMuted }]}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={s.rulesScroll} contentContainerStyle={s.rulesScrollContent}>
            {rules?.length ? (
              <View style={s.rulesList}>
                {rules.map((rule) => (
                  <View key={rule.uuid} style={[s.ruleRow, { borderColor: colors.border, backgroundColor: colors.bgSecondary }]}>
                    <View style={s.ruleTextBlock}>
                      <Text style={[s.ruleTitle, { color: colors.text }]} numberOfLines={1}>{rule.name || 'Rule'}</Text>
                      <Text style={[s.ruleMeta, { color: colors.textMuted }]} numberOfLines={1}>
                        {describeRule(rule)}
                      </Text>
                    </View>
                    <TouchableOpacity style={[s.ruleApplyBtn, { borderColor: colors.primary }]} onPress={() => onApplyRule(rule)}>
                      <Text style={[s.ruleApplyText, { color: colors.primary }]}>Apply</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[s.ruleEmptyText, { color: colors.textMuted }]}>No rules yet</Text>
            )}

            <TextInput
              style={[s.ruleInput, { color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
              placeholder="Rule name"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={[s.ruleInput, { color: colors.text, borderColor: colors.border }]}
              value={category}
              onChangeText={setCategory}
              placeholder="Bank category contains"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={[s.ruleInput, { color: colors.text, borderColor: colors.border }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Description contains"
              placeholderTextColor={colors.textMuted}
            />
            <View style={s.ruleInlineFields}>
              <TextInput
                style={[s.ruleInput, s.ruleSmallInput, { color: colors.text, borderColor: colors.border }]}
                value={mcc}
                onChangeText={setMcc}
                placeholder="MCC"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[s.ruleInput, s.ruleSmallInput, { color: colors.text, borderColor: colors.border }]}
                value={minAmount}
                onChangeText={setMinAmount}
                placeholder="Min"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[s.ruleInput, s.ruleSmallInput, { color: colors.text, borderColor: colors.border }]}
                value={maxAmount}
                onChangeText={setMaxAmount}
                placeholder="Max"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={s.directionRow}>
              {[
                ['expense', 'Expense'],
                ['income', 'Income'],
                ['any', 'Any'],
              ].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[
                    s.directionChip,
                    { borderColor: colors.border },
                    direction === value && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                  ]}
                  onPress={() => setDirection(value)}
                >
                  <Text style={[s.directionText, { color: direction === value ? colors.primary : colors.textSecondary }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sheetPlanStrip}>
              {plans.map((plan) => (
                <TouchableOpacity
                  key={plan.uuid}
                  style={[
                    s.sheetPlanChip,
                    { borderColor: colors.border },
                    selectedPlanUuid === plan.uuid && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                  ]}
                  onPress={() => {
                    setSelectedPlanUuid(plan.uuid);
                    setSelectedItemUuid('');
                  }}
                >
                  <Text style={[s.sheetPlanChipText, { color: selectedPlanUuid === plan.uuid ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                    {plan.name || 'Untitled'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TerminalItemPicker
              colors={colors}
              plan={selectedPlan}
              items={items}
              totals={totals}
              selectedItemUuid={selectedItemUuid}
              onSelect={setSelectedItemUuid}
            />

            <TouchableOpacity style={s.lockRow} onPress={() => setApplyExisting((value) => !value)}>
              <Text style={[s.checkboxBox, { borderColor: colors.border, color: colors.primary }]}>{applyExisting ? '✓' : ''}</Text>
              <Text style={[s.lockText, { color: colors.textSecondary }]}>Apply to currently unmapped facts after saving</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.lockRow} onPress={() => setRemapAssigned((value) => !value)}>
              <Text style={[s.checkboxBox, { borderColor: colors.border, color: colors.primary }]}>{remapAssigned ? '✓' : ''}</Text>
              <Text style={[s.lockText, { color: colors.textSecondary }]}>Also remap already assigned unlocked facts</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={s.sheetActions}>
            <TouchableOpacity style={[s.sheetDoneBtn, { backgroundColor: colors.primary }]} onPress={handleSave}>
              <Text style={s.sheetDoneText}>{seed?.transaction ? 'Create & apply' : 'Create rule'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TerminalItemPicker({ colors, plan, items, totals, selectedItemUuid, onSelect }) {
  const rows = useMemo(() => {
    if (!plan?.uuid) return [];
    const currentItems = planItems(items, plan.uuid);
    const terminal = terminalItemSet(currentItems);
    return flattenFinanceTree(currentItems).map((row) => ({
      ...row,
      isTerminal: terminal.has(row.item.uuid),
    }));
  }, [items, plan?.uuid]);

  if (!plan) {
    return <Text style={[s.ruleEmptyText, { color: colors.textMuted }]}>No finance lists</Text>;
  }

  return (
    <View style={[s.itemPicker, { borderColor: colors.border }]}>
      <ScrollView style={s.itemPickerScroll} nestedScrollEnabled>
        {rows.map((row) => {
          const selected = selectedItemUuid === row.item.uuid;
          return (
            <TouchableOpacity
              key={row.item.uuid}
              disabled={!row.isTerminal}
              style={[
                s.itemPickRow,
                { opacity: row.isTerminal ? 1 : 0.58 },
                selected && { backgroundColor: colors.primaryLight },
              ]}
              onPress={() => row.isTerminal && onSelect(row.item.uuid)}
            >
              <Text
                style={[
                  s.itemPickName,
                  { color: selected ? colors.primary : colors.text, paddingLeft: Math.min(row.depth * 14, 54) },
                ]}
                numberOfLines={1}
              >
                {row.hasChildren ? '▾ ' : '· '}{row.item.name || 'Без названия'}
              </Text>
              <Text style={[s.itemPickAmount, { color: colors.textMuted }]} numberOfLines={1}>
                {formatMoney(totals.get(row.item.uuid) || row.item.amount_cents || 0, plan.currency || 'RUB')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function describeRule(rule) {
  let conditions = [];
  try {
    const parsed = JSON.parse(rule?.conditions_json || '[]');
    conditions = Array.isArray(parsed) ? parsed : [];
  } catch {
    conditions = [];
  }
  if (!conditions.length) return 'No conditions';
  return conditions.map((condition) => {
    const field = String(condition.field || '').replace(/_/g, ' ');
    return `${field} ${condition.op || 'contains'} ${condition.value ?? ''}`.trim();
  }).join(rule.match_mode === 'any' ? ' OR ' : ' AND ');
}

function FinanceItemEditorSheet({
  visible,
  item,
  colors,
  currency,
  planKind,
  total,
  onClose,
  onPatchItem,
  onAddChild,
  onMove,
  onDelete,
}) {
  const [amountText, setAmountText] = useState('');

  useEffect(() => {
    setAmountText(amountInputValue(item?.amount_cents || 0));
  }, [item?.uuid]);

  if (!item) return null;

  const dueValue = planKind === 'monthly'
    ? (item.due_day == null ? '' : String(item.due_day))
    : (item.due_date || '');

  const handleAmountChange = (text) => {
    setAmountText(text);
    const cents = parseMoneyToCents(text);
    if (cents != null) onPatchItem(item.uuid, { amount_cents: cents });
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.sheetRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={[s.sheetTitle, { color: colors.text }]} numberOfLines={1}>
              {item.name || 'Строка затрат'}
            </Text>
            <Text style={[s.sheetTotal, { color: colors.textSecondary }]}>
              {formatMoney(total, currency)}
            </Text>
          </View>

          <TextInput
            style={[s.sheetNameInput, { color: colors.text, borderColor: colors.border }]}
            value={item.name || ''}
            onChangeText={(name) => onPatchItem(item.uuid, { name })}
            placeholder="Название"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <View style={s.sheetFields}>
            <FieldLabelInput
              label="Amount"
              value={amountText}
              colors={colors}
              onChangeText={handleAmountChange}
              keyboardType="decimal-pad"
              placeholder="0"
            />
            <FieldLabelInput
              label={planKind === 'monthly' ? 'Day' : 'Date'}
              value={dueValue}
              colors={colors}
              onChangeText={handleDateChange}
              keyboardType={planKind === 'monthly' ? 'number-pad' : 'default'}
              placeholder={planKind === 'monthly' ? '21' : 'YYYY-MM-DD'}
            />
          </View>

          <TextInput
            style={[s.sheetNoteInput, { color: colors.textSecondary, borderColor: colors.border }]}
            value={item.note || ''}
            onChangeText={(note) => onPatchItem(item.uuid, { note })}
            placeholder="Note"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <View style={s.sheetActions}>
            <SmallAction label="+ child" colors={colors} onPress={() => onAddChild(item.uuid)} />
            <SmallAction label="Move" colors={colors} onPress={() => onMove(item.uuid)} />
            <SmallAction label="Delete" colors={colors} onPress={() => onDelete(item)} danger />
            <TouchableOpacity style={[s.sheetDoneBtn, { backgroundColor: colors.primary }]} onPress={onClose}>
              <Text style={s.sheetDoneText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FieldLabelInput({ label, value, colors, onChangeText, keyboardType, placeholder }) {
  return (
    <View style={s.sheetFieldBlock}>
      <Text style={[s.sheetFieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[s.sheetFieldInput, { color: colors.text, borderColor: colors.border }]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
      />
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
  rulesBtn: { height: 38, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  rulesBtnText: { fontSize: 12, fontWeight: '800' },
  iconBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 17, fontWeight: '700' },
  addBtn: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, lineHeight: 26, fontWeight: '500' },
  modeSwitch: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 6, borderWidth: 1, borderRadius: 8, padding: 3, gap: 3 },
  modeBtn: { flex: 1, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  modeBtnText: { fontSize: 12, fontWeight: '800' },
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
  rowCard: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 6,
    marginHorizontal: 10,
    marginVertical: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  compactCollapseHit: { width: 20, height: 28, alignItems: 'center', justifyContent: 'center' },
  compactCollapseText: { fontSize: 13, lineHeight: 15, fontWeight: '800' },
  compactMain: { flex: 1, minWidth: 0 },
  compactTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactTitle: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: '600' },
  compactGroupTitle: { fontWeight: '800' },
  compactHiddenCount: { fontSize: 9.5, fontWeight: '800' },
  compactHint: { marginTop: 0, fontSize: 9.5, lineHeight: 11 },
  compactAmounts: { minWidth: 82, maxWidth: 120, alignItems: 'flex-end' },
  compactTotal: { fontSize: 11.5, fontWeight: '700' },
  compactGroupTotal: { fontWeight: '800' },
  compactDirectAmount: { marginTop: 0, fontSize: 9.5, lineHeight: 10 },
  factsRoot: { paddingTop: 4, paddingBottom: 18 },
  factsFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  filterChip: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  filterChipText: { fontSize: 12, fontWeight: '800' },
  monthInput: { minWidth: 92, height: 32, borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: '700' },
  factsLoading: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, fontWeight: '700' },
  factCard: { borderWidth: 1, borderRadius: 8, marginHorizontal: 10, marginVertical: 4, padding: 10, gap: 5 },
  factTopRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  factDate: { fontSize: 11, fontWeight: '700' },
  factAmount: { fontSize: 14, fontWeight: '900' },
  factDescription: { fontSize: 13.5, lineHeight: 17, fontWeight: '700' },
  factMeta: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  factBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  factMappingBadge: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  factMappingText: { fontSize: 11.5, fontWeight: '800' },
  factLock: { fontSize: 14, fontWeight: '700' },
  mapBtn: { borderRadius: 7, paddingHorizontal: 12, paddingVertical: 7 },
  mapBtnText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  smallAction: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 },
  smallActionText: { fontSize: 12, fontWeight: '700' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
  },
  mapSheet: { maxHeight: '88%' },
  rulesSheet: { maxHeight: '92%' },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(140, 150, 160, 0.55)',
    marginBottom: 2,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800' },
  sheetTotal: { fontSize: 12, fontWeight: '700' },
  sheetNameInput: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, minHeight: 36, fontSize: 14, fontWeight: '700' },
  sheetFields: { flexDirection: 'row', gap: 8 },
  sheetFieldBlock: { flex: 1 },
  sheetFieldLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 3 },
  sheetFieldInput: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, minHeight: 36, fontSize: 13 },
  sheetNoteInput: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, minHeight: 42, maxHeight: 90, fontSize: 12 },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  sheetDoneBtn: { marginLeft: 'auto', borderRadius: 7, paddingHorizontal: 16, paddingVertical: 8 },
  sheetDoneText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  factSheetDescription: { fontSize: 13.5, lineHeight: 18, fontWeight: '800' },
  sheetPlanStrip: { gap: 7, paddingVertical: 2 },
  sheetPlanChip: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, maxWidth: 170 },
  sheetPlanChipText: { fontSize: 12, fontWeight: '800' },
  itemPicker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden', maxHeight: 210 },
  itemPickerScroll: { maxHeight: 210 },
  itemPickRow: { minHeight: 34, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemPickName: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '800' },
  itemPickAmount: { maxWidth: 100, fontSize: 11, fontWeight: '700' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  checkboxBox: { width: 20, height: 20, borderWidth: 1, borderRadius: 5, textAlign: 'center', lineHeight: 18, fontSize: 13, fontWeight: '900' },
  lockText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '600' },
  closeText: { fontSize: 24, lineHeight: 26, fontWeight: '700' },
  rulesScroll: { maxHeight: 540 },
  rulesScrollContent: { gap: 8, paddingBottom: 6 },
  rulesList: { gap: 6 },
  ruleRow: { borderWidth: 1, borderRadius: 7, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleTextBlock: { flex: 1, minWidth: 0 },
  ruleTitle: { fontSize: 12.5, fontWeight: '800' },
  ruleMeta: { marginTop: 2, fontSize: 10.5, fontWeight: '600' },
  ruleApplyBtn: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  ruleApplyText: { fontSize: 11, fontWeight: '900' },
  ruleEmptyText: { fontSize: 12, fontWeight: '700' },
  ruleInput: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, minHeight: 36, fontSize: 12.5, fontWeight: '600' },
  ruleInlineFields: { flexDirection: 'row', gap: 7 },
  ruleSmallInput: { flex: 1, minWidth: 0 },
  directionRow: { flexDirection: 'row', gap: 7 },
  directionChip: { flex: 1, borderWidth: 1, borderRadius: 7, paddingVertical: 7, alignItems: 'center' },
  directionText: { fontSize: 11.5, fontWeight: '800' },
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
