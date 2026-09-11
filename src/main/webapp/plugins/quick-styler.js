/**
 * Quick Styler: properties and named styles in the existing popup menu.
 * Adapted from the supplied quick-styler.js.
 */
Draw.loadPlugin(function(ui)
{
	if (ui.quickStyler != null || ui.menus == null) return;
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var menus = ui.menus;
	var storageKey = 'drawio-quick-styler-styles';
	var disposed = false;
	var dialog = null;
	var managedDialog = null;
	var confirmationDialog = null;
	var graphContainer = graph.container;
	var properties = [
		{key: 'size', label: 'サイズ', items: [
			['autosize', 'テキストに合わせてサイズを調整する', '1', '0'],
			['aspect', '縦横比を固定する', 'fixed', '0']
		]},
		{key: 'label', label: 'ラベル', items: [
			['noLabel', 'ラベルを隠す', '1', '0'],
			['movableLabel', 'ラベルを移動できるようにする', '1', '0'],
			['editable', 'ラベルの編集を禁止する', '0', '1']
		]},
		{key: 'container', label: 'コンテナ', items: [
			['container', 'コンテナにする', '1', '0'],
			['expand', '子に合わせて親のサイズを拡張する', '1', '0'],
			['recursiveResize', '親のリサイズに合わせて子もリサイズする', '1', '0'],
			['collapsible', '折りたたみを許可する', '1', '0']
		]},
		{key: 'connections', label: '接続', items: [
			['snapToPoint', '接続ポイントにスナップする', '1', '0'],
			['constraintPoints', '接続ポイントを制限する'],
			['allowArrows', '接続用の矢印を隠す', '0', '1'],
			['connectable', '接続できなくする', '0', '1']
		]},
		{key: 'restrictions', label: '操作の制限', items: [
			['movable', '位置を固定する', '0', '1'],
			['resizable', 'リサイズを禁止する', '0', '1'],
			['rotatable', '回転を禁止する', '0', '1'],
			['cloneable', '複製を禁止する', '0', '1'],
			['deletable', '削除を禁止する', '0', '1']
		]}
	];
	var presets = [
		['all', '上下左右', '[[0.5,0],[1,0.5],[0.5,1],[0,0.5]]'],
		['h', '左右', '[[0,0.5],[1,0.5]]'],
		['v', '上下', '[[0.5,0],[0.5,1]]'],
		['none', '制限を解除（図形の標準へ戻す）', null]
	];
	var styleKeys = new Set([
		'fillColor', 'strokeColor', 'gradientColor', 'glass', 'strokeWidth', 'dashed',
		'dashPattern', 'rounded', 'opacity', 'shadow', 'shape', 'perimeter',
		'fontColor', 'fontSize', 'fontFamily', 'fontStyle', 'align', 'verticalAlign',
		'labelPosition', 'spacingLeft', 'spacingRight', 'spacingTop', 'spacingBottom',
		'whiteSpace', 'overflow', 'movable', 'resizable', 'rotatable', 'deletable',
		'editable', 'container', 'aspect', 'autosize'
	]);

	function validateStyle(style)
	{
		if (style == null || typeof style != 'object' || Array.isArray(style))
			throw new Error('保存済みスタイルの形式が不正です。');
		Object.keys(style).forEach(function(key)
		{
			if (!styleKeys.has(key) || typeof style[key] != 'string' || /[;\x00-\x1f]/.test(style[key]))
				throw new Error('保存済みスタイルに不正なキーまたは値があります。');
		});
		return style;
	}

	function savedStyles()
	{
		var raw = localStorage.getItem(storageKey);
		var saved = raw == null ? [] : JSON.parse(raw);
		if (!Array.isArray(saved)) throw new Error('保存済みスタイルを読み込めません。');
		var names = new Set();
		saved.forEach(function(item)
		{
			if (item == null || typeof item.name != 'string' || item.name.trim() == '' || names.has(item.name))
				throw new Error('保存済みスタイルの名前が不正、または重複しています。');
			names.add(item.name);
			validateStyle(item.style);
		});
		return saved;
	}

	function captureStyle(cell)
	{
		var result = Object.create(null);
		(model.getStyle(cell) || '').split(';').forEach(function(pair)
		{
			var index = pair.indexOf('=');
			var key = pair.substring(0, index);
			if (index > 0 && styleKeys.has(key)) result[key] = pair.substring(index + 1);
		});
		return validateStyle(result);
	}

	function editable(cell, editingProperty)
	{
		// Label editing can be re-enabled without granting other style changes.
		return model.contains(cell) && model.isVertex(cell) &&
			(graph.isCellEditable(cell) || (editingProperty && graph.isCellsEditable() &&
				graph.getCurrentCellStyle(cell).editable == '0')) &&
			!graph.isCellLocked(cell) && graph.getLockedGroupAncestor(model.getParent(cell)) == null &&
			!graph.isTableRow(cell) && !graph.isTableCell(cell) && !graph.isPart(cell);
	}

	function context()
	{
		return {cells: graph.getSelectionCells().slice(), root: model.getRoot(), page: ui.currentPage};
	}

	function invalid(ctx, editingProperty)
	{
		if (disposed || !graph.isEnabled()) return '読み取り専用では変更できません。';
		var current = graph.getSelectionCells();
		var selected = new Set(current);
		if (ctx.root != model.getRoot() || ctx.page != ui.currentPage || ctx.cells.length == 0 ||
			current.length != ctx.cells.length || !ctx.cells.every(function(cell) { return selected.has(cell); }))
			return '対象の選択またはページが変わりました。メニューを開き直してください。';
		if (!ctx.cells.every(function(cell) { return editable(cell, editingProperty); }))
			return '接続線、ロック中・ラベル編集禁止の図形、表の行・セル、部品には適用できません。';
		return null;
	}

	function checked(cell, prop)
	{
		var style = graph.getCurrentCellStyle(cell);
		var key = prop[0];
		if (key == 'container') return graph.isContainer(cell);
		if (key == 'autosize') return graph.isAutoSizeCell(cell);
		if (key == 'connectable') return !graph.isCellConnectable(cell);
		if (key == 'movableLabel') return graph.isLabelMovable(cell);
		if (key == 'expand') return style.expand != null ? style.expand != '0' : graph.isExtendParents() && !graph.isTable(cell);
		if (key == 'collapsible' && style.collapsible == null) return graph.isContainer(cell);
		var value = style[key];
		if (value == null)
		{
			value = ['resizable', 'movable', 'rotatable', 'cloneable', 'deletable',
				'editable', 'recursiveResize', 'allowArrows'].indexOf(key) >= 0 ? '1' : '0';
		}
		return String(value) == prop[2];
	}

	function constraint(cell)
	{
		var value = graph.getCurrentCellStyle(cell).points;
		if (value == null) return 'none';
		try
		{
			var normalized = JSON.stringify(JSON.parse(value));
			for (var i = 0; i < presets.length - 1; i++)
			{
				if (normalized == presets[i][2]) return presets[i][0];
			}
		}
		catch (err) { /* An unrecognized existing value remains custom. */ }
		return 'custom';
	}

	function common(cells, value)
	{
		if (cells.length == 0) return null;
		var first = value(cells[0]);
		for (var i = 1; i < cells.length; i++)
		{
			if (value(cells[i]) !== first) return null;
		}
		return first;
	}

	function apply(ctx, values)
	{
		var keys = Object.keys(values);
		var editingProperty = keys.length == 1 && keys[0] == 'editable';
		var error = invalid(ctx, editingProperty);
		if (error != null) { ui.handleError(new Error(error)); return; }
		graph.stopEditing(false);
		error = invalid(ctx, editingProperty);
		if (error != null) { ui.handleError(new Error(error)); return; }
		var changes = model.currentEdit.changes;
		var start = changes.length;
		model.beginUpdate();
		try
		{
			keys.forEach(function(key)
			{
				var targets = ctx.cells.filter(function(cell)
				{
					var style = model.getStyle(cell) || '';
					return mxUtils.setStyle(style, key, values[key]) != style;
				});
				if (targets.length == 0) return;
				graph.setCellStyles(key, values[key], targets);
				// Match the existing menu's treatment of HTML alignment and font sizing.
				if (key == 'align') graph.updateLabelElements(targets, function(elt)
				{
					elt.removeAttribute('align');
					elt.style.textAlign = null;
				});
				if (key == 'fontFamily') graph.updateLabelElements(targets, function(elt)
				{
					elt.removeAttribute('face');
					elt.style.fontFamily = null;
					if (elt.nodeName == 'PRE') graph.replaceElement(elt, 'div');
				});
				if (key == 'fontFamily' || key == 'fontSize') targets.forEach(function(cell)
				{
					if (model.getChildCount(cell) == 0) graph.autoSizeCell(cell, false);
				});
			});
			if (changes.length > start) ui.fireEvent(new mxEventObject('styleChanged',
				'keys', keys, 'values', keys.map(function(key) { return values[key]; }), 'cells', ctx.cells));
		}
		catch (err)
		{
			while (changes.length > start) changes.pop().execute();
			ui.handleError(err);
		}
		finally
		{
			model.endUpdate();
		}
	}

	function manage(cell)
	{
		if (disposed || !model.contains(cell)) return;
		if (dialog != null) { dialog.querySelector('input').focus(); return; }
		var snapshot;
		try { snapshot = captureStyle(cell); }
		catch (err) { ui.handleError(err); return; }
		var div = document.createElement('div');
		div.className = 'geQuickStylerDialog';
		div.style.cssText = 'padding:16px;box-sizing:border-box;white-space:normal;';
		div.setAttribute('role', 'form');
		div.setAttribute('aria-label', 'スタイルを管理');
		var heading = document.createElement('h3');
		heading.textContent = 'スタイルを管理';
		heading.style.margin = '0 0 12px';
		div.appendChild(heading);
		var source = document.createElement('div');
		source.textContent = '保存元: ' + graph.convertValueToString(cell) + ' (' + cell.id + ')';
		source.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;';
		source.title = source.textContent;
		div.appendChild(source);
		var note = document.createElement('div');
		note.textContent = '明示された外観・文字・移動・編集などの設定を保存します。';
		note.style.cssText = 'font-size:11px;margin-bottom:12px;';
		div.appendChild(note);
		var input = document.createElement('input');
		input.type = 'text';
		input.placeholder = '名前を入力';
		input.setAttribute('aria-label', 'スタイル名');
		input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px;';
		div.appendChild(input);
		var list = document.createElement('datalist');
		list.id = 'quick-styler-names-' + mxObjectIdentity.get(ui);
		input.setAttribute('list', list.id);
		div.appendChild(list);
		var message = document.createElement('div');
		message.setAttribute('role', 'status');
		message.style.cssText = 'font-size:11px;min-height:28px;';
		div.appendChild(message);
		var composing = false;
		var confirming = false;
		var alive = true;
		function refresh()
		{
			try
			{
				var saved = savedStyles();
				list.textContent = '';
				saved.forEach(function(item)
				{
					var option = document.createElement('option');
					option.value = item.name;
					list.appendChild(option);
				});
				message.textContent = Object.keys(snapshot).length == 0 ? '保存対象の設定がありません。' : '';
			}
			catch (err) { message.textContent = '保存データを読み込めません: ' + err.message; }
			buttons();
		}
		function buttons()
		{
			saveButton.disabled = confirming || input.value.trim() == '' || Object.keys(snapshot).length == 0;
			deleteButton.disabled = confirming || input.value.trim() == '';
		}
		function update(remove)
		{
			if (!alive || disposed || confirming || composing) return;
			var name = input.value.trim();
			if (name == '' || (!remove && Object.keys(snapshot).length == 0)) return;
			try
			{
				var saved = savedStyles();
				var exists = saved.some(function(item) { return item.name == name; });
				if (remove && !exists) { message.textContent = 'その名前のスタイルはありません。'; return; }
				function write()
				{
					confirming = false;
					if (!alive || disposed) return;
					try
					{
						// Re-read before writing so another window's unrelated styles survive.
						var latest = savedStyles();
						var index = latest.findIndex(function(item) { return item.name == name; });
						if (!exists && index >= 0) throw new Error('同名のスタイルが追加されました。確認してから保存し直してください。');
						if (remove) latest = latest.filter(function(item) { return item.name != name; });
						else if (index < 0) latest.push({name: name, style: snapshot});
						else latest[index] = {name: name, style: snapshot};
						localStorage.setItem(storageKey, JSON.stringify(latest));
						input.value = '';
						refresh();
						message.textContent = remove ? '削除しました。' : '保存しました。';
					}
					catch (err) { message.textContent = '保存できませんでした: ' + err.message; }
					buttons();
					input.focus();
				}
				if (exists)
				{
					confirming = true;
					buttons();
					ui.confirm('「' + name + '」を' + (remove ? '削除' : '上書き') + 'しますか？', write, function()
					{
						confirming = false;
						if (alive) { buttons(); input.focus(); }
					});
					confirmationDialog = ui.dialog;
					var onClose = confirmationDialog.onDialogClose;
					confirmationDialog.onDialogClose = function()
					{
						if (onClose != null && onClose.apply(this, arguments) === false) return false;
						confirmationDialog = null;
						confirming = false;
						if (alive && !disposed) { buttons(); input.focus(); }
					};
				}
				else write();
			}
			catch (err) { message.textContent = '保存データを読み込めません: ' + err.message; }
		}
		function close()
		{
			if (alive && !confirming) ui.hideDialog(true, false, div);
		}
		var controls = document.createElement('div');
		controls.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
		var saveButton = mxUtils.button('保存', function() { update(false); });
		saveButton.className = 'geBtn gePrimaryBtn';
		var deleteButton = mxUtils.button('削除', function() { update(true); });
		deleteButton.className = 'geBtn';
		var closeButton = mxUtils.button('閉じる', close);
		closeButton.className = 'geBtn';
		[saveButton, deleteButton, closeButton].forEach(function(button) { controls.appendChild(button); });
		div.appendChild(controls);
		input.oninput = buttons;
		input.addEventListener('compositionstart', function() { composing = true; });
		input.addEventListener('compositionend', function() { composing = false; });
		div.onkeydown = function(evt)
		{
			evt.stopPropagation();
			if (evt.isComposing || composing || evt.keyCode == 229) return;
			if (evt.key == 'Escape') { evt.preventDefault(); close(); }
			else if (evt.key == 'Enter' && evt.target == input) { evt.preventDefault(); update(false); }
		};
		dialog = div;
		ui.showDialog(div, 360, 250, true, true, function()
		{
			alive = false;
			dialog = null;
			managedDialog = null;
		});
		managedDialog = ui.dialog;
		refresh();
		input.focus();
	}

	var originalPopup = menus.createPopupMenu;
	var popup = function(menu, cell, evt)
	{
		if (!disposed && cell != null && model.isVertex(cell))
		{
			var ctx = context();
			var reason = invalid(ctx);
			function item(title, fn, parent, state, key, enabled)
			{
				enabled = enabled == null ? reason == null : enabled;
				var el = menu.addItem(title + (state === null ? '（混在）' : ''), null, fn,
					parent, null, enabled);
				if (state === true) menu.addCheckmark(el, Editor.checkmarkImage);
				el.setAttribute('role', state !== undefined ? 'menuitemcheckbox' : 'menuitem');
				if (state !== undefined) el.setAttribute('aria-checked', state === null ? 'mixed' : String(state));
				el.setAttribute('aria-disabled', String(!enabled));
				if (key != null) el.dataset.quickStyler = key;
				if (reason != null && !enabled) el.title = reason;
				el.tabIndex = -1;
				el.onfocus = function() { el.style.outline = '2px solid Highlight'; };
				el.onblur = function() { el.style.outline = ''; };
				if (parent != null) parent.setAttribute('aria-haspopup', 'menu');
				el.onkeydown = function(evt)
				{
					var owner = parent || menu;
					var siblings = Array.from(owner.tbody.rows).filter(function(row) { return row.dataset.quickStyler != null; });
					var index = siblings.indexOf(el);
					if (evt.key == 'ArrowDown' || evt.key == 'ArrowUp' || evt.key == 'Home' || evt.key == 'End')
					{
						index = evt.key == 'Home' ? 0 : evt.key == 'End' ? siblings.length - 1 :
							(index + (evt.key == 'ArrowDown' ? 1 : siblings.length - 1)) % siblings.length;
						siblings[index].focus();
					}
					else if (evt.key == 'ArrowLeft' && parent != null)
					{
						menu.hideSubmenu(parent);
						parent.div.remove();
						parent.focus();
					}
					else if (evt.key == 'Escape' || evt.key == 'Tab')
					{
						menu.hideMenu();
						graphContainer.focus();
					}
					else if (evt.key == 'Enter' || evt.key == ' ' || evt.key == 'ArrowRight')
					{
						if (el.div != null)
						{
							menu.hideSubmenu(owner);
							menu.showSubmenu(owner, el);
							owner.activeRow = el;
							el.tbody.querySelector('[data-quick-styler]').focus();
						}
						else if (enabled && fn != null && evt.key != 'ArrowRight')
						{
							menu.hideMenu();
							graphContainer.focus();
							fn();
						}
					}
					else return;
					mxEvent.consume(evt);
				};
				return el;
			}
			var propertyParent = item('プロパティ', null, null, undefined, 'properties', true);
			properties.forEach(function(group)
			{
				var parent = item(group.label, null, propertyParent, undefined, 'group-' + group.key, true);
				group.items.forEach(function(prop)
				{
					if (prop[0] == 'constraintPoints')
					{
						var current = common(ctx.cells, constraint);
						var pointParent = item(prop[1] + (current == 'custom' ? '（カスタム）' : ''),
							null, parent, current === null ? null : undefined, prop[0], true);
						presets.forEach(function(preset)
						{
							item(preset[1], function() { apply(ctx, {points: preset[2]}); }, pointParent,
								current === preset[0], 'points-' + preset[0]);
						});
					}
					else
					{
						var state = common(ctx.cells, function(cell) { return checked(cell, prop); });
						item(prop[1], function()
						{
							var values = {};
							values[prop[0]] = state === true ? prop[3] : prop[2];
							apply(ctx, values);
						}, parent, state, prop[0], prop[0] == 'editable' ? invalid(ctx, true) == null : reason == null);
					}
				});
			});
			var styleParent = item('スタイル', null, null, undefined, 'styles', true);
			item('スタイルを管理', function() { manage(cell); }, styleParent, undefined, 'manage', true);
			try
			{
				var saved = savedStyles();
				if (saved.length > 0) menu.addSeparator(styleParent);
				saved.forEach(function(saved)
				{
					item(saved.name, function()
					{
						try { apply(ctx, validateStyle(saved.style)); }
						catch (err) { ui.handleError(err); }
					}, styleParent, undefined, 'saved-' + saved.name,
						reason == null && Object.keys(saved.style).length > 0);
				});
			}
			catch (err) { item('保存データを読み込めません（管理画面を確認）', null, styleParent, undefined, 'storage-error', false); }
			menu.addSeparator();
		}
		originalPopup.apply(this, arguments);
	};
	menus.createPopupMenu = popup;
	function keyboardMenu(evt)
	{
		if (disposed || graph.isEditing() || ui.dialog != null ||
			(evt.key != 'ContextMenu' && !(evt.key == 'F10' && evt.shiftKey))) return;
		var cell = graph.getSelectionCell();
		var state = graph.view.getState(cell);
		if (cell == null || !model.isVertex(cell) || state == null) return;
		var offset = mxUtils.getOffset(graphContainer);
		var menu = graph.popupMenuHandler;
		menu.popup(offset.x + state.x - graphContainer.scrollLeft,
			offset.y + state.y - graphContainer.scrollTop, cell, evt);
		menu.tbody.querySelector('[data-quick-styler="properties"]').focus();
		mxEvent.consume(evt);
	}
	graphContainer.addEventListener('keydown', keyboardMenu);
	ui.quickStyler = {destroy: function destroy()
	{
		if (disposed) return;
		disposed = true;
		if (ui.editor != null) mxUtils.remove(destroy, ui.destroyFunctions);
		if (menus.createPopupMenu == popup) menus.createPopupMenu = originalPopup;
		graphContainer.removeEventListener('keydown', keyboardMenu);
		[confirmationDialog, managedDialog].forEach(function(owned)
		{
			if (owned == null) return;
			if (ui.editor != null) ui.hideDialog(true, false, owned.container.firstChild);
			else
			{
				owned.close(true);
				mxUtils.remove(owned, ui.dialogs);
				ui.dialog = ui.dialogs.length > 0 ? ui.dialogs[ui.dialogs.length - 1] : null;
			}
		});
		ui.quickStyler = null;
	}};
	ui.destroyFunctions.push(ui.quickStyler.destroy);
});
