import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

function buildTree(folders) {
  const map = new Map();
  const roots = [];
  for (const f of folders) map.set(f.uuid, { ...f, children: [] });
  for (const f of folders) {
    const node = map.get(f.uuid);
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function FolderNode({ folder, depth, selectedId, onSelect, expandedIds, onToggleExpand }) {
  const { colors } = useTheme();
  const isSelected = selectedId === folder.uuid;
  const isExpanded = expandedIds.has(folder.uuid);
  const hasChildren = folder.children.length > 0;

  return (
    <View>
      <TouchableOpacity
        style={[s.row, { paddingLeft: 12 + depth * 16, backgroundColor: isSelected ? colors.primaryLight : 'transparent' }]}
        onPress={() => onSelect(folder.uuid)}
      >
        {hasChildren ? (
          <TouchableOpacity onPress={() => onToggleExpand(folder.uuid)} style={s.arrow}>
            <Text style={{ color: colors.textMuted }}>{isExpanded ? '▼' : '▶'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.arrow} />
        )}
        <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{folder.name}</Text>
      </TouchableOpacity>
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
  arrow: { width: 20, alignItems: 'center' },
  name: { fontSize: 14, flex: 1 },
});
