/**
 * Hierarchy Viewer: a docked tree for the current page.
 * Adapted from the supplied hierarchy-viewer.js.
 */
Draw.loadPlugin(function(ui)
{
	if (ui.hierarchyViewer != null) return;

	var graph = ui.editor.graph;
	var model = graph.getModel();
	var format = ui.format;
	var host = ui.formatContainer;
	var supported = format != null && host != null && !ui.editor.chromeless &&
		!ui.editor.isChromelessView() && ui.formatWindow == null && Editor.currentTheme != 'sketch';
	var actionName = 'toggleHierarchyViewer';
	var storageKey = 'drawio-hierarchy-viewer-tab';
	var listeners = [];
	var disposed = false;
	var dirty = true;
	var pending = null;
	var editing = null;
	var dragging = null;
	var rows = new Map();
	var focusedCell = null;
	var tab = 'format';
	var action = ui.actions.addAction(actionName, function()
	{
		if (!supported || disposed) return;
		var showing = ui.isFormatPanelVisible() && tab == 'hierarchy';
		if (!ui.isFormatPanelVisible()) ui.toggleFormatPanel(true);
		selectTab(showing ? 'format' : 'hierarchy', true);
	});
	action.label = '階層・オブジェクトビューア' +
		(supported ? '' : '（通常の右サイドバーで利用可能）');
	action.setEnabled(supported);
	action.setToggleAction(true);
	action.setSelectedCallback(function()
	{
		return supported && !disposed && tab == 'hierarchy' && ui.isFormatPanelVisible();
	});

	var menu = ui.menus.get('extras') || ui.menus.get('view');
	var originalMenu = menu != null ? menu.funct : null;
	var menuWrapper = function(m, parent)
	{
		originalMenu.apply(this, arguments);
		if (!disposed) ui.menus.addMenuItems(m, ['-', actionName], parent);
	};
	if (menu != null) menu.funct = menuWrapper;

	ui.hierarchyViewer = {destroy: destroy};
	ui.destroyFunctions.push(destroy);
	if (!supported) return;

	var style = document.createElement('style');
	style.textContent =
		'.geHierarchyTabs{display:flex;height:34px;position:absolute;inset:0 0 auto;}' +
		'.geHierarchyTabs button{margin:0;border-radius:0;color:inherit;}' +
		'.geHierarchyPane{position:absolute;inset:34px 0 0;display:flex;flex-direction:column;white-space:normal;}' +
		'.geHierarchyTree{overflow:auto;flex:1;min-height:0;padding:4px 0;}' +
		'.geHierarchyRow{display:flex;align-items:center;gap:3px;min-height:30px;border:2px solid transparent;box-sizing:border-box;}' +
		'.geHierarchyRow:hover{background:light-dark(var(--highlight-color),var(--dark-highlight-color));}' +
		'.geHierarchyRow[aria-selected=true]{background:light-dark(var(--accent-color),var(--dark-accent-color));color:light-dark(var(--accent-text-color),var(--dark-accent-text-color));}' +
		'.geHierarchyRow:focus-visible,.geHierarchyTabs button:focus-visible{outline:2px solid Highlight;outline-offset:-2px;}' +
		'.geHierarchyLabel{flex:1;min-width:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}' +
		'.geHierarchyRow button{flex:none;margin:0;padding:2px;min-width:20px;color:inherit;background:transparent;border:0;}' +
		'.geHierarchyRow button:disabled{opacity:.35;}' +
		'.geHierarchyRow [draggable=true]{cursor:grab;}' +
		'.geHierarchyRow input{min-width:0;width:100%;box-sizing:border-box;}' +
		'.geHierarchyOrder{font-size:10px;opacity:.65;white-space:nowrap;padding-right:3px;}' +
		'.geHierarchyBefore{border-top-color:Highlight;}.geHierarchyAfter{border-bottom-color:Highlight;}' +
		'.geHierarchyInside{background:light-dark(var(--accent-color),var(--dark-accent-color))!important;}' +
		'.geHierarchyStatus{padding:4px 8px;font-size:11px;white-space:normal;}' +
		'.geHierarchyStatus:empty{display:none;}';
	document.head.appendChild(style);

	var originalOverflow = host.style.overflow;
	var originalGutter = host.style.scrollbarGutter;
	host.style.overflow = 'hidden';
	host.style.scrollbarGutter = 'auto';
	var formatPane = document.createElement('div');
	formatPane.className = 'geFormatContainer';
	formatPane.style.cssText = 'position:absolute;inset:34px 0 0;width:auto;';
	formatPane.setAttribute('role', 'tabpanel');
	formatPane.setAttribute('aria-label', '書式');
	while (host.firstChild != null) formatPane.appendChild(host.firstChild);
	format.container = formatPane;
	host.appendChild(formatPane);

	var tabs = document.createElement('div');
	tabs.className = 'geHierarchyTabs';
	tabs.setAttribute('role', 'tablist');
	tabs.setAttribute('aria-label', '右サイドバー');
	var tabButtons = {};
	['format', 'hierarchy'].forEach(function(name)
	{
		var button = document.createElement('button');
		button.className = 'geFormatTitle';
		button.type = 'button';
		button.textContent = name == 'format' ? '書式' : '階層';
		button.setAttribute('role', 'tab');
		button.dataset.hierarchyTab = name;
		button.onmousedown = function(evt) { evt.stopPropagation(); };
		button.onclick = function() { selectTab(name, true); };
		button.onkeydown = function(evt)
		{
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(evt.key) >= 0)
			{
				mxEvent.consume(evt);
				selectTab(evt.key == 'Home' ? 'format' : evt.key == 'End' ? 'hierarchy' :
					name == 'format' ? 'hierarchy' : 'format', false);
				tabButtons[tab].focus();
			}
		};
		tabButtons[name] = button;
		tabs.appendChild(button);
	});
	host.appendChild(tabs);

	var pane = document.createElement('div');
	pane.className = 'geHierarchyPane';
	pane.setAttribute('role', 'tabpanel');
	pane.setAttribute('aria-label', '階層');
	var tree = document.createElement('div');
	tree.className = 'geHierarchyTree';
	tree.setAttribute('role', 'tree');
	tree.setAttribute('aria-label', 'オブジェクト階層');
	tree.setAttribute('aria-multiselectable', 'true');
	tree.tabIndex = 0;
	pane.appendChild(tree);
	var status = document.createElement('div');
	status.className = 'geHierarchyStatus';
	status.setAttribute('role', 'status');
	pane.appendChild(status);
	host.appendChild(pane);

	function listen(source, event, fn)
	{
		source.addListener(event, fn);
		listeners.push([source, fn]);
	}

	function alive(cell)
	{
		return !disposed && cell != null && model.contains(cell);
	}

	function visible(cell)
	{
		for (var node = cell; node != null; node = model.getParent(node))
		{
			if (!graph.isCellVisible(node)) return false;
		}
		return true;
	}

	function unlocked(cell)
	{
		return alive(cell) && graph.isEnabled() && !graph.isCellLocked(cell) &&
			graph.getLockedGroupAncestor(model.getParent(cell)) == null;
	}

	function canRename(cell)
	{
		return unlocked(cell) && graph.isCellEditable(cell);
	}

	function canHide(cell)
	{
		// Layer visibility, including locked layers, follows LayersWindow.
		return alive(cell) && graph.isEnabled() && (model.isLayer(cell) || unlocked(cell));
	}

	function label(cell, seen)
	{
		if (cell == null) return '?';
		var raw = graph.convertValueToString(cell);
		if (graph.isReplacePlaceholders(cell)) raw = graph.replacePlaceholders(cell, raw);
		if (graph.isHtmlLabel(cell))
		{
			var text = document.createElement('div');
			text.innerHTML = Graph.sanitizeHtml(raw);
			raw = mxUtils.extractTextWithWhitespace(text.childNodes);
		}
		if (raw != null && String(raw).trim() != '') return String(raw);
		var fallback = (model.isLayer(cell) ? 'レイヤー ' : model.isEdge(cell) ? '接続線 ' : '図形 ') + cell.id;
		if (!model.isEdge(cell)) return fallback;
		seen = seen || new Set();
		if (seen.has(cell)) return fallback;
		seen.add(cell);
		var result = label(model.getTerminal(cell, true), seen) + ' → ' +
			label(model.getTerminal(cell, false), seen);
		seen.delete(cell);
		return result;
	}

	function change(fn)
	{
		var changes = model.currentEdit.changes;
		var start = changes.length;
		var succeeded = false;
		model.beginUpdate();
		try
		{
			fn();
			status.textContent = '';
			succeeded = true;
		}
		catch (err)
		{
			// Roll back only this operation, before it reaches the Undo history.
			while (changes.length > start) changes.pop().execute();
			status.textContent = '変更できませんでした: ' + err.message;
		}
		finally
		{
			model.endUpdate();
		}
		return succeeded;
	}

	function select(cell, evt)
	{
		if (!alive(cell)) return;
		if (model.isLayer(cell))
		{
			if (graph.isEnabled())
			{
				graph.setDefaultParent(cell);
				graph.view.setCurrentRoot(null);
				updateSelection();
			}
			return;
		}
		if (!visible(cell)) return;
		cell = graph.getLockedGroupAncestor(model.getParent(cell)) || cell;
		if (!visible(cell) || graph.isCellLocked(cell) || !graph.isCellSelectable(cell)) return;
		if (evt.shiftKey || evt.ctrlKey || evt.metaKey)
		{
			if (graph.isCellSelected(cell)) graph.removeSelectionCell(cell);
			else graph.addSelectionCell(cell);
		}
		else graph.setSelectionCell(cell);
		if (graph.view.getState(cell) != null) graph.scrollCellToVisible(cell);
	}

	function updateSelection()
	{
		rows.forEach(function(row, cell)
		{
			row.setAttribute('aria-selected', String(model.isLayer(cell) ?
				graph.getDefaultParent() == cell : graph.isCellSelected(cell)));
		});
	}

	function focusRow(cell)
	{
		var row = rows.get(cell);
		if (row != null)
		{
			if (rows.has(focusedCell)) rows.get(focusedCell).tabIndex = -1;
			focusedCell = cell;
			row.tabIndex = 0;
			row.focus({preventScroll: true});
		}
	}

	function rename(cell)
	{
		if (!canRename(cell)) return;
		if (editing != null) editing.finish(true);
		var row = rows.get(cell);
		if (row == null) return;
		var oldValue = graph.convertValueToString(cell);
		if (graph.isHtmlLabel(cell) || graph.isReplacePlaceholders(cell) || /%[^%]+%/.test(oldValue))
		{
			if (visible(cell)) graph.startEditingAtCell(cell);
			else status.textContent = '装飾・参照を含むラベルは、図形を表示してから編集してください。';
			return;
		}
		var input = document.createElement('input');
		input.type = 'text';
		input.value = oldValue;
		input.setAttribute('aria-label', '名前を変更');
		var labelSpan = row.querySelector('.geHierarchyLabel');
		labelSpan.textContent = '';
		labelSpan.appendChild(input);
		var root = model.getRoot();
		var page = ui.currentPage;
		var done = false;
		var composing = false;
		editing = {cell: cell, finish: function(save)
		{
			if (done) return;
			done = true;
			editing = null;
			if (save && !composing && root == model.getRoot() && page == ui.currentPage &&
				canRename(cell) && graph.convertValueToString(cell) == oldValue && input.value != oldValue)
			{
				change(function() { graph.cellLabelChanged(cell, input.value); });
			}
			dirty = true;
			queueRefresh();
		}};
		var finish = editing.finish;
		input.addEventListener('compositionstart', function() { composing = true; });
		input.addEventListener('compositionend', function() { composing = false; });
		input.onblur = function() { finish(true); };
		input.onkeydown = function(evt)
		{
			evt.stopPropagation();
			if (evt.isComposing || composing || evt.keyCode == 229) return;
			if (evt.key == 'Enter' || evt.key == 'Escape')
			{
				evt.preventDefault();
				finish(evt.key == 'Enter');
				refreshTree();
				focusRow(cell);
			}
		};
		input.onclick = function(evt) { evt.stopPropagation(); };
		input.focus();
		input.select();
	}

	function structural(cell, target)
	{
		if (!unlocked(cell)) return false;
		if (!target && !graph.isCellMovable(cell)) return false;
		for (var node = cell; node != null && !model.isLayer(node) && node != model.getRoot(); node = model.getParent(node))
		{
			var geo = model.getGeometry(node);
			if (graph.isPart(node) || graph.isTableRow(node) || graph.isTableCell(node) ||
				(model.isVertex(node) && (geo == null || geo.relative)) ||
				(graph.layoutManager != null && graph.layoutManager.getLayout(model.getParent(node)) != null)) return false;
		}
		return true;
	}

	function dropPlan(cell, target, mode, evt)
	{
		if (!alive(target) || !structural(cell) || !structural(target, true))
			return {error: 'ロック、移動禁止、表・部品・レイアウトの制約により移動できません。'};
		var parent = mode == 'inside' ? target : model.getParent(target);
		if (cell == target || model.isAncestor(cell, parent)) return {error: '自分自身や子孫へは移動できません。'};
		if (model.isLayer(cell) ? parent != model.getRoot() : parent == model.getRoot())
			return {error: 'レイヤーはルート直下でのみ並べ替えできます。'};
		if (parent != model.getRoot() && (!unlocked(parent) || graph.getLockedGroupAncestor(parent) != null ||
			(graph.layoutManager != null && graph.layoutManager.getLayout(parent) != null)))
			return {error: '移動先がロック中、またはレイアウト管理下です。'};
		var previous = model.getParent(cell);
		// Native drop validation still accepts existing groups with container=0.
		if ((mode == 'inside' || previous != parent) && !model.isLayer(parent) &&
			(graph.getCurrentCellStyle(parent).container == '0' || !graph.isSelectionContainer(parent) ||
			!graph.isValidDropTarget(parent, [cell], evt)))
			return {error: 'この図形は子を受け入れられません。'};
		if (previous != parent)
		{
			if (model.isEdge(cell)) return {error: '接続線は同じ親の中でのみ並べ替えできます。'};
			if (graph.view.getState(previous) == null || graph.view.getState(parent) == null ||
				!visible(cell) || !visible(parent)) return {error: '絶対位置を確認できないため移動できません。'};
		}
		var siblings = model.getChildren(parent) || [];
		var remaining = siblings.filter(function(sibling) { return sibling != cell; });
		var index = mode == 'inside' ? remaining.length : remaining.indexOf(target) + (mode == 'before' ? 1 : 0);
		return {parent: parent, previous: previous, index: index};
	}

	function move(cell, plan)
	{
		if (plan.previous == plan.parent && plan.parent.getIndex(cell) == plan.index) return;
		change(function()
		{
			if (plan.previous == plan.parent) model.add(plan.parent, cell, plan.index);
			else
			{
				var negative = graph.allowNegativeCoordinates;
				var autosize = graph.autoSizeCellsOnAdd;
				try
				{
					graph.allowNegativeCoordinates = true;
					graph.autoSizeCellsOnAdd = false;
					var transparent = graph.isTransparentBounds(cell);
					if (transparent)
					{
						var from = graph.view.getState(plan.previous).origin;
						var to = graph.view.getState(plan.parent).origin;
						// These groups have pinned geometry; translate their children instead.
						graph.translateCell(cell, from.x - to.x, from.y - to.y);
					}
					graph.cellsAdded([cell], plan.parent, plan.index, null, null, !transparent, false, false);
				}
				finally
				{
					graph.allowNegativeCoordinates = negative;
					graph.autoSizeCellsOnAdd = autosize;
				}
			}
		});
	}

	function clearDrop()
	{
		rows.forEach(function(row) { row.classList.remove('geHierarchyBefore', 'geHierarchyAfter', 'geHierarchyInside'); });
	}

	function dropMode(evt, row)
	{
		var rect = row.getBoundingClientRect();
		var ratio = (evt.clientY - rect.top) / rect.height;
		return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
	}

	function addRow(cell, depth, count, position)
	{
		var row = document.createElement('div');
		row.className = 'geHierarchyRow';
		row.style.paddingLeft = (depth - 1) * 12 + 'px';
		row.dataset.cellId = cell.id;
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-level', depth);
		row.setAttribute('aria-setsize', count);
		row.setAttribute('aria-posinset', position);
		if (model.getChildCount(cell) > 0) row.setAttribute('aria-expanded', 'true');
		row.tabIndex = cell == focusedCell ? 0 : -1;
		var name = label(cell);
		row.setAttribute('aria-label', name);
		row.addEventListener('focusin', function()
		{
			if (rows.has(focusedCell)) rows.get(focusedCell).tabIndex = -1;
			focusedCell = cell;
			row.tabIndex = 0;
		});
		function button(text, title, fn, enabled, kind)
		{
			var el = document.createElement('button');
			el.type = 'button';
			el.textContent = text;
			el.title = title;
			el.setAttribute('aria-label', title + ': ' + name);
			el.dataset.hierarchyAction = kind;
			el.disabled = !enabled;
			// The Format host cancels mousedown, which would suppress native dragging and focus.
			el.onmousedown = function(evt) { evt.stopPropagation(); };
			el.onclick = function(evt) { evt.stopPropagation(); fn(evt); };
			row.appendChild(el);
			return el;
		}
		var handle = button('⋮⋮', 'ドラッグして順序・階層を移動', function() {}, structural(cell), 'drag');
		handle.draggable = !handle.disabled;
		handle.ondragstart = function(evt)
		{
			if (editing != null || !structural(cell)) { evt.preventDefault(); return; }
			dragging = {cell: cell, root: model.getRoot(), page: ui.currentPage};
			evt.dataTransfer.effectAllowed = 'move';
			evt.dataTransfer.setData('application/x-drawio-hierarchy', cell.id);
			evt.stopPropagation();
		};
		handle.ondragend = function() { dragging = null; clearDrop(); queueRefresh(); };
		var selfVisible = model.isVisible(cell);
		var inheritedHidden = selfVisible && !visible(cell);
		var vis = button(selfVisible ? '◉' : '○', inheritedHidden ? '親が非表示（自身を非表示にする）' :
			selfVisible ? '非表示にする' : '表示する', function()
		{
			if (!canHide(cell)) return;
			change(function() { model.setVisible(cell, !model.isVisible(cell)); });
			graph.removeSelectionCells(graph.getSelectionCells().filter(function(selected) { return !visible(selected); }));
		}, canHide(cell), 'visibility');
		vis.setAttribute('aria-pressed', String(selfVisible));
		if (inheritedHidden) vis.style.opacity = '.45';
		var labelSpan = document.createElement('span');
		labelSpan.className = 'geHierarchyLabel';
		labelSpan.textContent = name;
		labelSpan.title = name + (inheritedHidden ? '（親が非表示）' : selfVisible ? '' : '（非表示）');
		if (model.isLayer(cell)) labelSpan.style.fontWeight = 'bold';
		row.appendChild(labelSpan);
		button('✎', '名前を変更 (F2)', function() { rename(cell); }, canRename(cell), 'rename');
		var badge = document.createElement('span');
		badge.className = 'geHierarchyOrder';
		badge.textContent = 'Z:' + model.getParent(cell).getIndex(cell) + '/' + (count - 1);
		badge.title = '同じ親の中の重なり順（大きいほど前面）';
		row.appendChild(badge);
		row.onclick = function(evt) { evt.stopPropagation(); focusRow(cell); select(cell, evt); };
		row.onkeydown = function(evt)
		{
			if (evt.target != row && evt.key != 'F2') return;
			var cells = Array.from(rows.keys());
			var index = cells.indexOf(cell);
			if (evt.key == 'F2') rename(cell);
			else if (evt.key == 'Enter' || evt.key == ' ') select(cell, evt);
			else if (evt.key == 'ArrowDown') focusRow(cells[Math.min(index + 1, cells.length - 1)]);
			else if (evt.key == 'ArrowUp') focusRow(cells[Math.max(0, index - 1)]);
			else if (evt.key == 'Home') focusRow(cells[0]);
			else if (evt.key == 'End') focusRow(cells[cells.length - 1]);
			else if (evt.key == 'ArrowLeft') focusRow(model.getParent(cell));
			else if (evt.key == 'ArrowRight' && model.getChildCount(cell) > 0) focusRow(cells[index + 1]);
			else return;
			mxEvent.consume(evt);
		};
		function activeDrag()
		{
			return dragging != null && dragging.root == model.getRoot() && dragging.page == ui.currentPage;
		}
		row.ondragover = function(evt)
		{
			clearDrop();
			evt.preventDefault();
			evt.stopPropagation();
			if (!activeDrag())
			{
				evt.dataTransfer.dropEffect = 'none';
				status.textContent = '同じページのドラッグハンドルから移動してください。';
				return;
			}
			var mode = dropMode(evt, row);
			var plan = dropPlan(dragging.cell, cell, mode, evt);
			evt.dataTransfer.dropEffect = plan.error ? 'none' : 'move';
			status.textContent = plan.error || '';
			if (!plan.error) row.classList.add('geHierarchy' + mode[0].toUpperCase() + mode.slice(1));
		};
		row.ondragleave = function(evt) { if (!row.contains(evt.relatedTarget)) clearDrop(); };
		row.ondrop = function(evt)
		{
			evt.preventDefault();
			evt.stopPropagation();
			clearDrop();
			if (!activeDrag()) return;
			var dragged = dragging.cell;
			dragging = null;
			var plan = dropPlan(dragged, cell, dropMode(evt, row), evt);
			status.textContent = plan.error || '';
			if (!plan.error) move(dragged, plan);
			queueRefresh();
		};
		rows.set(cell, row);
		tree.appendChild(row);
		var children = model.getChildCount(cell);
		for (var i = children - 1; i >= 0; i--) addRow(model.getChildAt(cell, i), depth + 1, children, children - i);
	}

	function refreshTree()
	{
		if (disposed || !dirty || editing != null || dragging != null || tab != 'hierarchy' || !ui.isFormatPanelVisible()) return;
		var focused = tree.contains(document.activeElement);
		var scroll = tree.scrollTop;
		rows.clear();
		tree.textContent = '';
		var root = model.getRoot();
		var count = model.getChildCount(root);
		for (var i = count - 1; i >= 0; i--) addRow(model.getChildAt(root, i), 1, count, count - i);
		if (!rows.has(focusedCell)) focusedCell = rows.keys().next().value;
		if (rows.has(focusedCell)) rows.get(focusedCell).tabIndex = 0;
		tree.tabIndex = rows.size == 0 ? 0 : -1;
		updateSelection();
		if (focused) focusRow(focusedCell);
		tree.scrollTop = scroll;
		dirty = false;
	}

	function queueRefresh()
	{
		if (!disposed && pending == null)
		{
			pending = window.setTimeout(function() { pending = null; refreshTree(); }, 0);
		}
	}

	function invalidate()
	{
		if (editing != null && (!canRename(editing.cell) || !model.contains(editing.cell))) editing.finish(false);
		dirty = true;
		queueRefresh();
	}

	function pageChanged()
	{
		if (editing != null) editing.finish(false);
		dragging = null;
		focusedCell = null;
		invalidate();
	}

	function selectTab(name, focus)
	{
		if (editing != null) editing.finish(false);
		try { localStorage.setItem(storageKey, name); }
		catch (err) { name = 'format'; }
		tab = name;
		formatPane.style.display = name == 'format' ? '' : 'none';
		pane.style.display = name == 'hierarchy' ? 'flex' : 'none';
		Object.keys(tabButtons).forEach(function(key)
		{
			var button = tabButtons[key];
			button.setAttribute('aria-selected', String(key == name));
			button.classList.toggle('geActiveFormatTitle', key == name);
			button.tabIndex = key == name ? 0 : -1;
		});
		if (name == 'format') format.refresh();
		else refreshTree();
		if (focus && name == 'hierarchy')
		{
			if (rows.size > 0) focusRow(focusedCell);
			else tree.focus();
		}
	}

	listen(model, mxEvent.CHANGE, invalidate);
	listen(graph.getSelectionModel(), mxEvent.CHANGE, updateSelection);
	listen(graph, 'enabledChanged', invalidate);
	listen(graph, mxEvent.ROOT, pageChanged);
	listen(ui.editor, 'pageSelected', pageChanged);
	listen(ui.editor, 'fileLoaded', pageChanged);
	listen(ui, 'lockedChanged', invalidate);
	listen(ui, 'formatWidthChanged', queueRefresh);
	try
	{
		var saved = localStorage.getItem(storageKey);
		if (saved == 'hierarchy') tab = saved;
	}
	catch (err) { tab = 'format'; }
	selectTab(tab, false);

	function destroy()
	{
		if (disposed) return;
		disposed = true;
		if (ui.editor != null) mxUtils.remove(destroy, ui.destroyFunctions);
		if (editing != null) editing.finish(false);
		if (pending != null) window.clearTimeout(pending);
		listeners.forEach(function(listener) { listener[0].removeListener(listener[1]); });
		if (menu != null && menu.funct == menuWrapper) menu.funct = originalMenu;
		if (supported)
		{
			format.container = host;
			while (formatPane.firstChild != null) host.appendChild(formatPane.firstChild);
			formatPane.remove();
			tabs.remove();
			pane.remove();
			style.remove();
			host.style.overflow = originalOverflow;
			host.style.scrollbarGutter = originalGutter;
		}
		rows.clear();
		ui.hierarchyViewer = null;
	}
});
