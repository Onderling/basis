/**
 * basis-mobile v2 — circle Lists (RN mirror of web's openListsPanel, container UI).
 *
 * The composable model on mobile: a circle's CONTAINERS (lists + heterogeneous boards) + their children,
 * rendered nested via the SAME shared data layer (`makeCircleLists` → `projectContainer`) the web uses —
 * web≡mobile by construction (shared logic, per-platform renderer). "+ add" creates a CONTAINED child; on an
 * AMBIGUOUS container (a board: item OR sub-list, no default) it first shows the type PICKER. Row-actions
 * complete/remove. PERSISTENT via an AsyncStorage-backed DataSource (in-memory fallback).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { makeCircleLists } from '@onderling/kring-host/circleLists';

const typeLabel = (type) => t(`circle.container.type.${type}`);

export default function CircleListsScreen({ circleId, storeFor, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const svcRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [containers, setContainers] = useState([]);   // lists + boards
  const [openList, setOpenList] = useState(null);      // the opened container, or null = index
  const [tree, setTree] = useState(null);
  const [newName, setNewName] = useState('');
  const [pendingAdd, setPendingAdd] = useState(null);  // container node id awaiting an inline add
  const [pendingHint, setPendingHint] = useState(null);// the chosen child type for the pending add (from the picker)
  const [pendingPick, setPendingPick] = useState(null);// { node, kinds } — a container awaiting a TYPE choice
  const [addText, setAddText] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      // THE CIRCLE'S OWN STORE — the same one the waist ops write to and the rail carries. This screen
      // used to build a service over a DataSource of its own (`cc-circle-lists-cache`), so a list made in
      // the conversation was invisible here and one made here reached nobody: two stores for one circle,
      // which the architecture names as a defect outright.
      if (!alive) return;
      svcRef.current = makeCircleLists({ storeFor });
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const reloadContainers = useCallback(async () => {
    if (svcRef.current) setContainers(await svcRef.current.listContainers(circleId));
  }, [circleId]);
  const reloadTree = useCallback(async (listId) => {
    if (svcRef.current) setTree(await svcRef.current.tree(circleId, listId));
  }, [circleId]);

  useEffect(() => { if (ready) reloadContainers(); }, [ready, reloadContainers]);

  const createContainer = useCallback(async (kind) => {
    const v = newName.trim();
    if (!v || !svcRef.current) return;
    if (kind === 'board') await svcRef.current.createBoard(circleId, v);
    else await svcRef.current.createList(circleId, v);
    setNewName('');
    reloadContainers();
  }, [newName, circleId, reloadContainers]);

  const openOne = useCallback(async (c) => {
    setOpenList(c); setPendingAdd(null); setPendingPick(null); await reloadTree(c.id);
  }, [reloadTree]);
  const backToIndex = useCallback(() => {
    setOpenList(null); setPendingAdd(null); setPendingPick(null); setTree(null); reloadContainers();
  }, [reloadContainers]);

  // "+ add": an AMBIGUOUS container picks the type first; a defaulted one goes straight to the input.
  const onAdd = useCallback((node) => {
    if (!svcRef.current) return;
    const { ambiguous, kinds } = svcRef.current.addKinds(node.type);
    if (ambiguous) { setPendingPick({ node, kinds }); setPendingAdd(null); }
    else { setPendingAdd(node.id); setPendingHint(null); setPendingPick(null); }
    setAddText('');
  }, []);

  const submitAdd = useCallback(async () => {
    const v = addText.trim(); const target = pendingAdd; const hint = pendingHint;
    setPendingAdd(null); setPendingHint(null); setAddText('');
    if (v && target && svcRef.current && openList) {
      await svcRef.current.addItem(circleId, target, v, undefined, hint ? { hint } : undefined);
      reloadTree(openList.id);
    }
  }, [addText, pendingAdd, pendingHint, circleId, openList, reloadTree]);

  const onRowAction = useCallback(async (op, node) => {
    if (!svcRef.current || !openList) return;
    if (op === 'markComplete') await svcRef.current.markDone(circleId, node.id);
    else if (op === 'removeItem') await svcRef.current.remove(circleId, node.id);
    reloadTree(openList.id);
  }, [circleId, openList, reloadTree]);

  function renderNode(node, depth) {
    return (
      <View key={node.id}>
        <View style={[styles.node, { marginLeft: depth * 16 }]} testID={`list-node-${node.id}`}>
          <Text style={styles.nodeLabel}>{node.label}</Text>
          {(node.rowActions || []).map((op) => (
            <Chip key={op} label={t(`circle.container.action.${op}`)} onPress={() => onRowAction(op, node)} />
          ))}
          {node.canAdd ? <Chip accent label={t('circle.container.add')} onPress={() => onAdd(node)} /> : null}
        </View>
        {(node.children || []).map((c) => renderNode(c, depth + 1))}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="circle-lists">
      <View style={styles.header}>
        <Pressable onPress={openList ? backToIndex : onBack} testID="lists-back"><Text style={styles.back}>‹ {t('circle.lists.title')}</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {!openList ? (
          <>
            {containers.length === 0 ? <Text style={styles.empty}>{t('circle.lists.empty')}</Text> : null}
            {containers.map((c) => (
              <Pressable key={c.id} style={styles.listRow} onPress={() => openOne(c)} testID={`list-row-${c.id}`}>
                <Text style={styles.badge}>{typeLabel(c.type)}</Text>
                <Text style={styles.listRowText}>{c.text}</Text>
              </Pressable>
            ))}
            <View style={styles.newRow}>
              <TextInput
                style={styles.newInput} value={newName} onChangeText={setNewName}
                placeholder={t('circle.lists.new')} placeholderTextColor={theme.color.inkSoft}
                onSubmitEditing={() => createContainer('list')} testID="lists-new-input"
              />
              <Pressable style={styles.create} onPress={() => createContainer('list')} testID="lists-create-list"><Text style={styles.createText}>{typeLabel('list')}</Text></Pressable>
              <Pressable style={[styles.create, styles.createAlt]} onPress={() => createContainer('board')} testID="lists-create-board"><Text style={styles.createTextAlt}>{typeLabel('board')}</Text></Pressable>
            </View>
          </>
        ) : (
          <>
            {tree ? renderNode(tree, 0) : null}
            {pendingPick ? (
              <View style={styles.pick} testID="lists-pick">
                <Text style={styles.pickLabel}>{t('circle.lists.pick_type')}</Text>
                {pendingPick.kinds.map((k) => (
                  <Chip
                    key={k.type} accent label={typeLabel(k.type)} testID={`lists-pick-${k.type}`}
                    onPress={() => { setPendingAdd(pendingPick.node.id); setPendingHint(k.type); setPendingPick(null); setAddText(''); }}
                  />
                ))}
              </View>
            ) : null}
            {pendingAdd ? (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput} value={addText} onChangeText={setAddText} autoFocus
                  placeholder={pendingHint ? typeLabel(pendingHint) : t('circle.lists.add_prompt')} placeholderTextColor={theme.color.inkSoft}
                  onSubmitEditing={submitAdd} testID="lists-add-input"
                />
                <Pressable style={styles.create} onPress={submitAdd} testID="lists-add-submit"><Text style={styles.createText}>{t('circle.lists.create')}</Text></Pressable>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, onPress, accent, testID }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable style={[styles.chip, accent && styles.chipAccent]} onPress={onPress} testID={testID}>
      <Text style={[styles.chipText, accent && styles.chipTextAccent]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: theme.color.accent, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  empty: { fontSize: 14, color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.white },
  badge: { fontSize: 10, letterSpacing: 0.4, color: theme.color.accent, borderWidth: 1, borderColor: theme.color.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, textTransform: 'uppercase', overflow: 'hidden' },
  listRowText: { fontSize: 15, color: theme.color.ink },
  node: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 6 },
  nodeLabel: { flex: 1, fontSize: 15, color: theme.color.ink, minWidth: 120 },
  newRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  newInput: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  create: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  createText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  createAlt: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.accent },
  createTextAlt: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
  pick: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  pickLabel: { fontSize: 13, color: theme.color.inkSoft },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line },
  chipAccent: { borderColor: theme.color.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.inkSoft },
  chipTextAccent: { color: theme.color.accent },
});
