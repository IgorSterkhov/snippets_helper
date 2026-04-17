import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

function buildTree(folders) {
  const byId = new Map();
  const roots = [];
  const nodes = folders.map((f) => ({ ...f, children: [] }));
  for (const n of nodes) {
    if (n.id != null) byId.set(n.id, n);
  }
  for (const n of nodes) {
    if (n.parent_id != null && byId.has(n.parent_id)) {
      byId.get(n.parent_id).children.push(n);
    } else {
      roots.push(n);
    }
  }
  const byOrder = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
  const sortTree = (list) => {
    list.sort(byOrder);
    for (const x of list) sortTree(x.children);
  };
  sortTree(roots);
  return roots;
}

function FolderNode({ folder, depth, selectedId, onSelect, expandedIds, onToggleExpand }) {
  const { colors } = useTheme();
  const isSelected = selectedId === folder.uuid;
  const isExpanded = expandedIds.has(folder.uuid);
  const hasChildren = folder.children.length > 0;

  return (
    <View>
      <View style={[s.row, { paddingLeft: 4 + depth * 16, backgroundColor: isSelected ? colors.primaryLight : 'transparent' }]}>
        {hasChildren ? (
          <TouchableOpacity
            onPress={() => onToggleExpand(folder.uuid)}
            style={s.arrow}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{isExpanded ? '▼' : '▶'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.arrow} />
        )}
        <TouchableOpacity style={s.nameBtn} onPress={() => onSelect(folder.uuid)}>
          <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{folder.name}</Text>
        </TouchableOpacity>
      </View>
      {isExpanded && folder.children.map((child) => (
        <FolderNode
          key={child.uuid}
          folder={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </View>
  );
}

export default function FolderTree({ folders, selectedId, onSelect }) {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const tree = buildTree(folders);

  const onToggleExpand = (uuid) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  return (
    <View>
      {tree.map((folder) => (
        <FolderNode
          key={folder.uuid}
          folder={folder}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 12 },
  arrow: { width: 28, alignItems: 'center' },
  nameBtn: { flex: 1, paddingVertical: 2 },
  name: { fontSize: 14 },
});
