/**
 * Hierarchy Viewer: integrates full hierarchy tree into the native LayersWindow (Illustrator style).
 */
Draw.loadPlugin(function(ui)
{
	if (ui.hierarchyViewer != null) return;

	var graph = ui.editor.graph;
	var model = graph.getModel();
	var actionName = 'toggleHierarchyViewer';
	var disposed = false;
	var expandedCells = new Set();
	var collapsedLayers = new Set();

	// Restore right sidebar if it was modified previously
	if (ui.formatContainer != null)
	{
		ui.formatContainer.classList.remove('geHierarchyViewerActive');
	}

	var eyeSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:block;pointer-events:none;"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 6c3.79 0 7.17 2.13 8.82 5.5C19.17 14.87 15.79 17 12 17s-7.17-2.13-8.82-5.5C4.83 8.13 8.21 6 12 6m0-2C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 5c1.38 0 2.5 1.12 2.5 2.5S13.38 14 12 14s-2.5-1.12-2.5-2.5S10.62 9 12 9m0-2c-2.48 0-4.5 2.02-4.5 4.5S9.52 16 12 16s4.5-2.02 4.5-4.5S14.48 7 12 7z"/></svg>';
	var eyeOffSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:block;pointer-events:none;"><path d="M0 0h24v24H0V0zm0 0h24v24H0V0zm0 0h24v24H0V0zm0 0h24v24H0V0z" fill="none"/><path d="M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.22-1.42 2.27-2.41 3.12l1.41 1.41c1.39-1.23 2.49-2.77 3.18-4.53C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.57l1.65 1.65C10.66 6.09 11.32 6 12 6zm-1.07 1.14L13 9.21c.57.25 1.03.71 1.28 1.28l2.07 2.07c.08-.34.14-.7.14-1.07C16.5 9.01 14.48 7 12 7c-.37 0-.72.05-1.07.14zM2.01 3.87l2.68 2.68C3.06 7.83 1.77 9.53 1 11.5 2.73 15.89 7 19 12 19c1.52 0 2.98-.29 4.32-.82l3.42 3.42 1.41-1.41L3.42 2.45 2.01 3.87zm7.5 7.5l2.61 2.61c-.04.01-.08.02-.12.02-1.38 0-2.5-1.12-2.5-2.5 0-.05.01-.08.01-.13zm-3.4-3.4l1.75 1.75c-.23.55-.36 1.15-.36 1.78 0 2.48 2.02 4.5 4.5 4.5.63 0 1.23-.13 1.77-.36l.98.98c-.88.24-1.8.38-2.75.38-3.79 0-7.17-2.13-8.82-5.5.7-1.43 1.72-2.61 2.93-3.53z"/></svg>';

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
		return alive(cell) && graph.isEnabled() && (model.isLayer(cell) || unlocked(cell));
	}

	var shapeNames = {
		'rectangle': '四角形',
		'ellipse': '楕円',
		'doubleEllipse': '二重円',
		'rhombus': '菱形',
		'triangle': '三角形',
		'cylinder': '円柱',
		'cylinder3': '円柱',
		'cloud': '雲',
		'process': 'プロセス',
		'actor': 'アクター',
		'umlActor': 'アクター',
		'document': 'ドキュメント',
		'internalStorage': '内部ストレージ',
		'dataStorage': 'データストレージ',
		'cube': '立方体',
		'step': 'ステップ',
		'trapezoid': '台形',
		'tape': 'テープ',
		'note': 'ノート',
		'note2': 'ノート',
		'card': 'カード',
		'callout': '吹き出し',
		'wedgeCallout': '吹き出し',
		'hexagon': '六角形',
		'parallelogram': '平行四辺形',
		'swimlane': 'コンテナ',
		'folder': 'フォルダー',
		'table': '表',
		'tableRow': '行',
		'tableCell': 'セル',
		'link': 'リンク',
		'zigzag': 'ジグザグ',
		'flexArrow': '矢印',
		'singleArrow': '単一矢印',
		'doubleArrow': '双方向矢印',
		'cross': '十字',
		'or': 'OR',
		'xor': 'XOR',
		'image': '画像',
		'text': 'テキスト',
		'line': '直線',
		'partialRectangle': '四角形'
	};

	function getShapeName(cell)
	{
		var rawStyle = model.getStyle(cell);
		if (rawStyle == null || rawStyle === '') return '図形';
		var styleNames = mxUtils.getStylenames(rawStyle);
		if (mxUtils.indexOf(styleNames, 'group') >= 0) return 'グループ';
		if (mxUtils.indexOf(styleNames, 'text') >= 0) return 'テキスト';

		var style = graph.getCellStyle(cell) || {};
		var shape = style.shape;

		// In draw.io defaultVertex style has shape='label' (mxConstants.SHAPE_LABEL).
		// Standard vertices (rectangle, rounded rectangle, square, text) inherit this.
		// Treat shape='label' as unspecified unless an explicit custom shape is defined.
		var isDefaultLabel = (shape === 'label');
		if (isDefaultLabel)
		{
			shape = null;
		}

		if (shape == null)
		{
			for (var i = 0; i < styleNames.length; i++)
			{
				if (shapeNames[styleNames[i]] != null)
				{
					shape = styleNames[i];
					break;
				}
			}
		}

		if (shape == null || shape === 'rectangle')
		{
			if (style.aspect === 'fixed')
			{
				return (style.rounded == '1' || style.rounded === 1) ? '角丸正方形' : '正方形';
			}
			if (style.rounded == '1' || style.rounded === 1) return '角丸四角形';
			if (shape === 'rectangle' || isDefaultLabel || rawStyle.indexOf('rounded=') >= 0 || rawStyle.indexOf('whiteSpace=') >= 0)
			{
				return '四角形';
			}
			return '図形';
		}

		if (shape === 'ellipse' && style.aspect === 'fixed') return '円';
		if (shapeNames[shape] != null) return shapeNames[shape];

		if (typeof shape === 'string' && shape !== 'label')
		{
			var parts = shape.split('.');
			var last = parts[parts.length - 1];
			if (last.length > 0)
			{
				return last.charAt(0).toUpperCase() + last.slice(1);
			}
		}

		return '図形';
	}

	function formatCellId(id)
	{
		if (id == null) return '';
		var parts = String(id).split('-');
		return parts[parts.length - 1];
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
		if (raw != null && String(raw).trim() != '')
		{
			var clean = String(raw).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
			if (clean !== '') return clean;
		}
		var prefix = model.isLayer(cell) ? 'レイヤー ' :
			model.isEdge(cell) ? '接続線 ' :
			(getShapeName(cell) + ' ');
		var fallback = prefix + formatCellId(cell.id);
		if (!model.isEdge(cell)) return fallback;
		seen = seen || new Set();
		if (seen.has(cell)) return fallback;
		seen.add(cell);
		var sourceLabel = label(model.getTerminal(cell, true), seen);
		var targetLabel = label(model.getTerminal(cell, false), seen);
		var result = (sourceLabel + ' → ' + targetLabel).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
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
			succeeded = true;
		}
		catch (err)
		{
			// Roll back only this operation, before it reaches the Undo history.
			while (changes.length > start) changes.pop().execute();
		}
		finally
		{
			model.endUpdate();
		}
		return succeeded;
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

	function select(cell, evt)
	{
		if (!alive(cell)) return;
		if (model.isLayer(cell))
		{
			if (graph.isEnabled())
			{
				graph.setDefaultParent(cell);
				graph.view.setCurrentRoot(null);
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

	function dropMode(evt, row)
	{
		var rect = row.getBoundingClientRect();
		var ratio = (evt.clientY - rect.top) / rect.height;
		return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
	}

	var style = document.createElement('style');
	style.textContent =
		'.geHierarchyRow{display:flex;align-items:center;gap:3px;min-height:28px;height:28px;border:1px solid transparent;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-size:12px;padding-right:8px;position:relative;}' +
		'.geHierarchyRow:hover{background:light-dark(var(--highlight-color,#e5f3ff),var(--dark-highlight-color,#2b3748));}' +
		'.geHierarchyRow[aria-selected=true]{background:light-dark(var(--accent-color,#d9ebff),var(--dark-accent-color,#1e3a5f));color:light-dark(var(--accent-text-color,#000),var(--dark-accent-text-color,#fff));}' +
		'.geHierarchyLabel{flex:1;min-width:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}' +
		'.geHierarchyLayerContent{display:flex;align-items:center;min-width:0;flex:1;}' +
		'.geHierarchyLayerTitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:4px;padding:4px;cursor:pointer;}' +
		'.geHierarchyRow button{flex:none;margin:0;padding:2px;min-width:18px;height:20px;display:inline-flex;align-items:center;justify-content:center;color:inherit;background:transparent;border:0;border-radius:2px;box-sizing:border-box;cursor:pointer;}' +
		'.geHierarchyRow button:hover:not(:disabled){background:light-dark(rgba(0,0,0,.08),rgba(255,255,255,.12));}' +
		'.geHierarchyRow button:disabled{opacity:.35;cursor:default;}' +
		'.geHierarchyRow [draggable=true]{cursor:grab;}' +
		'.geHierarchyRow input:not([type="checkbox"]){min-width:0;width:100%;box-sizing:border-box;font-size:inherit;font-family:inherit;}' +
		'.geHierarchyBefore{border-top:2px solid Highlight!important;}' +
		'.geHierarchyAfter{border-bottom:2px solid Highlight!important;}' +
		'.geHierarchyInside{background:light-dark(var(--accent-color,#0078d4),var(--dark-accent-color,#0078d4))!important;color:#fff!important;}' +
		'.geHierarchyToggle{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:9px;color:gray;user-select:none;flex-shrink:0;}' +
		'.geHierarchyToggle:hover{color:inherit;}' +
		'.geHierarchySpacer{width:16px;height:16px;flex-shrink:0;}';
	document.head.appendChild(style);

	var origLayersWindow = window.LayersWindow;

	var CustomLayersWindow = function(editorUi, x, y, w, h)
	{
		// Default size: width 260px, height 360px (allows comfortable hierarchy tree viewing)
		w = w || 260;
		h = h || 360;

		var graph = editorUi.editor.graph;
		var model = graph.getModel();

		var div = document.createElement('div');
		div.style.userSelect = 'none';
		div.style.height = '100%';
		div.style.marginBottom = '10px';
		div.style.overflow = 'auto';

		var listDiv = document.createElement('div');
		listDiv.style.position = 'absolute';
		listDiv.style.overflow = 'auto';
		listDiv.style.left = '0px';
		listDiv.style.right = '0px';
		listDiv.style.top = '0px';
		listDiv.style.bottom = '32px';
		div.appendChild(listDiv);

		var dragSource = null;
		var dropIndex = null;
		var draggingCell = null;
		var editing = null;
		var dropRow = null;
		var selectedRows = [];
		var refreshTimer = null;
		var dirty = false;
		var destroyed = false;
		var wnd = null;

		mxEvent.addListener(div, 'dragover', function(evt)
		{
			evt.dataTransfer.dropEffect = 'move';
			dropIndex = 0;
			evt.stopPropagation();
			evt.preventDefault();
		});

		mxEvent.addListener(div, 'drop', function(evt)
		{
			evt.stopPropagation();
			evt.preventDefault();
		});

		var layerCount = null;
		var selectionLayer = null;
		var layerDivs = new mxDictionary();
		var cellDivs = new mxDictionary();
		var ldiv = document.createElement('div');
		ldiv.className = 'geToolbarContainer geDialogToolbar';

		var link = document.createElement('a');
		link.className = 'geButton';

		var addLink = link.cloneNode(false);
		addLink.style.backgroundImage = 'url(' + Editor.plusImage + ')';
		addLink.setAttribute('title', mxResources.get('addLayer'));

		mxEvent.addListener(addLink, 'click', function(evt)
		{
			if (graph.isEnabled())
			{
				selectLayers(false);
				model.beginUpdate();
				var cell;

				try
				{
					cell = graph.addCell(new mxCell(mxResources.get('untitledLayer')), model.root);
					graph.setDefaultParent(cell);
				}
				finally
				{
					model.endUpdate();
				}

				renameLayer(cell);
			}

			mxEvent.consume(evt);
		});

		if (!graph.isEnabled())
		{
			addLink.classList.add('mxDisabled');
		}

		ldiv.appendChild(addLink);

		function renameLayer(layer)
		{
			if (graph.isEnabled() && layer != null)
			{
				if (refreshTimer != null) refresh();
				var ldivRow = layerDivs.get(layer);

				if (ldivRow != null)
				{
					var span = ldivRow.querySelector('.geHierarchyLayerTitle') || ldivRow.getElementsByTagName('div')[1];

					if (span != null)
					{
						var oldValue = mxUtils.getTextContent(span);
						span.style.textOverflow = '';
						span.style.cursor = 'text';
						span.contentEditable = 'true';
						span.focus();
						document.execCommand('selectAll', false, null);

						ldivRow.removeAttribute('draggable');
						ldivRow.style.cursor = '';

						var stopEditing = function(applyValue)
						{
							if (span.contentEditable == 'true')
							{
								span.contentEditable = 'false';
								var newValue = mxUtils.getTextContent(span);

								if (applyValue && newValue != oldValue)
								{
									if (newValue.length > 0)
									{
										graph.cellLabelChanged(layer, newValue);
									}
									else
									{
										graph.cellLabelChanged(layer, mxResources.get('untitledLayer'));
									}
								}
								else
								{
									refresh();
								}
							}
						};

						mxEvent.addListener(span, 'keydown', function(evt)
						{
							if (evt.keyCode == 13 || evt.keyCode == 27)
							{
								stopEditing(evt.keyCode == 13);
								mxEvent.consume(evt);
							}
						});

						mxEvent.addListener(span, 'blur', function(evt)
						{
							stopEditing(true);
							mxEvent.consume(evt);
						});
					}
				}
			}
		}

		function rename(cell)
		{
			if (!canRename(cell)) return;
			if (model.isLayer(cell))
			{
				renameLayer(cell);
				return;
			}
			if (editing != null) editing.finish(true);
			var row = cellDivs.get(cell);
			if (row == null) return;
			var oldValue = graph.convertValueToString(cell);
			if (graph.isHtmlLabel(cell) || graph.isReplacePlaceholders(cell) || /%[^%]+%/.test(oldValue))
			{
				if (visible(cell)) graph.startEditingAtCell(cell);
				return;
			}
			var input = document.createElement('input');
			input.type = 'text';
			input.value = oldValue;
			input.setAttribute('aria-label', '名前を変更');
			var labelSpan = row.querySelector('.geHierarchyLabel');
			if (labelSpan == null) return;
			labelSpan.textContent = '';
			labelSpan.appendChild(input);
			var root = model.getRoot();
			var done = false;
			var composing = false;
			editing = {cell: cell, finish: function(save)
			{
				if (done) return;
				done = true;
				editing = null;
				if (save && !composing && root == model.getRoot() &&
					canRename(cell) && graph.convertValueToString(cell) == oldValue && input.value != oldValue)
				{
					change(function() { graph.cellLabelChanged(cell, input.value); });
				}
				refresh();
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
				}
			};
			input.onclick = function(evt) { evt.stopPropagation(); };
			input.focus();
			input.select();
		}

		var menuLink = link.cloneNode(false);
		menuLink.style.backgroundImage = 'url(' + Editor.menuImage + ')';
		ldiv.appendChild(menuLink);

		function isLayersVisible(layers)
		{
			var isVis = true;
			for (var i = 0; i < layers.length; i++)
			{
				if (!model.isVisible(layers[i]))
				{
					isVis = false;
					break;
				}
			}
			return isVis;
		}

		function selectLayers(selected)
		{
			var divs = layerDivs.getValues();
			for (var i = 0; i < divs.length; i++)
			{
				var cb = divs[i].getElementsByTagName('input')[0];
				if (cb != null)
				{
					cb.checked = (selected != null) ? selected : !cb.checked;
				}
			}
		}

		function isLayerSelected(layer)
		{
			var ldivRow = layerDivs.get(layer);
			if (ldivRow != null)
			{
				var cb = ldivRow.getElementsByTagName('input')[0];
				return cb != null && cb.checked;
			}
			return false;
		}

		function getSelectedLayers(exclude, ignoreCheckbox)
		{
			var layers = [];
			for (var i = 0; i < model.getChildCount(model.root); i++)
			{
				var layer = model.getChildAt(model.root, i);
				if (layer != exclude && (ignoreCheckbox || isLayerSelected(layer)))
				{
					layers.push(layer);
				}
			}
			return layers;
		}

		function setLayersLocked(layers, locked)
		{
			graph.setCellStyles('locked', (locked) ? '1' : '0', layers);
			if (locked)
			{
				for (var i = 0; i < layers.length; i++)
				{
					graph.removeSelectionCells(model.getDescendants(layers[i]));
				}
			}
		}

		mxEvent.addListener(menuLink, 'click', function(evt)
		{
			if (graph.isEnabled())
			{
				editorUi.editor.graph.popupMenuHandler.hideMenu();

				var selectedLayers = getSelectedLayers();
				var index = model.root.getIndex(selectionLayer);
				var enabled = selectedLayers.length > 0 && graph.isEnabled();
				var nothingIsSelected = mxResources.get('nothingIsSelected');
				var layer = graph.getLayerForCells(graph.getSelectionCells());
				var labelText = graph.convertValueToString(selectionLayer) || mxResources.get('background');

				var menu = new mxPopupMenu(mxUtils.bind(this, function(menu, parent)
				{
					var layersSubmenu = menu.addItem(mxResources.get('layers'), null, null, parent);

					menu.addItem(mxResources.get('selectAll'), null, mxUtils.bind(this, function()
					{
						refresh();
						selectLayers(true);
					}), layersSubmenu);

					menu.addItem(mxResources.get('selectNone'), null, mxUtils.bind(this, function()
					{
						refresh();
						selectLayers(false);
					}), layersSubmenu, null, selectedLayers.length > 0).setAttribute('title',
						selectedLayers.length > 0 ? mxResources.get('selectNone') : nothingIsSelected);

					menu.addItem(mxResources.get('invertSelection'), null, mxUtils.bind(this, function()
					{
						refresh();
						selectLayers();
					}), layersSubmenu);

					menu.addSeparator(layersSubmenu);

					menu.addItem(mxResources.get('show'), null, mxUtils.bind(this, function()
					{
						graph.setCellsVisible(selectedLayers, true);
					}), layersSubmenu, null, enabled).setAttribute('title', selectedLayers.length > 0 ?
							mxResources.get('show') : nothingIsSelected);
					menu.addItem(mxResources.get('hide'), null, mxUtils.bind(this, function()
					{
						graph.setCellsVisible(selectedLayers, false);
					}), layersSubmenu, null, enabled).setAttribute('title', selectedLayers.length > 0 ?
							mxResources.get('hide') : nothingIsSelected);

					menu.addSeparator(layersSubmenu);

					menu.addItem(mxResources.get('lock'), null, mxUtils.bind(this, function()
					{
						setLayersLocked(getSelectedLayers(), true);
					}), layersSubmenu, null, enabled).setAttribute('title', selectedLayers.length > 0 ?
							mxResources.get('lock') : nothingIsSelected);

					menu.addItem(mxResources.get('unlock'), null, mxUtils.bind(this, function()
					{
						setLayersLocked(getSelectedLayers(), false);
					}), layersSubmenu, null, enabled).setAttribute('title', selectedLayers.length > 0 ?
							mxResources.get('unlock') : nothingIsSelected);

					var layerSubmenu = menu.addItem(mxResources.get('currentLayer'), null, null, parent);

					menu.addItem(mxResources.get('duplicate'), null, mxUtils.bind(this, function()
					{
						selectLayers(false);
						var newCell = null;
						model.beginUpdate();
						try
						{
							newCell = graph.cloneCell(selectionLayer);
							graph.cellLabelChanged(newCell, mxResources.get('copyOf', [labelText]));
							newCell = graph.addCell(newCell, model.root, index + 1);
							newCell.setVisible(true);
						}
						finally
						{
							model.endUpdate();
						}

						if (newCell != null && !graph.isCellLocked(newCell))
						{
							graph.setDefaultParent(newCell);
							graph.selectAll(newCell);
						}
					}), layerSubmenu);

					menu.addItem(mxResources.get('addLayer'), null, mxUtils.bind(this, function(evt2)
					{
						if (graph.isEnabled())
						{
							selectLayers(false);
							model.beginUpdate();
							var cell;

							try
							{
								cell = graph.addCell(new mxCell(mxResources.get('untitledLayer')),
									model.root, index + ((mxEvent.isShiftDown(evt2) ? 0 : 1)));
								graph.setDefaultParent(cell);
							}
							finally
							{
								model.endUpdate();
							}

							renameLayer(cell);
						}

						mxEvent.consume(evt2);
					}), layerSubmenu);

					menu.addSeparator(layerSubmenu);

					menu.addItem(mxResources.get('rename'), null, mxUtils.bind(this, function()
					{
						renameLayer(selectionLayer);
					}), layerSubmenu);

					menu.addItem(mxResources.get('editData'), null, mxUtils.bind(this, function()
					{
						editorUi.showDataDialog(selectionLayer);
					}), layerSubmenu);

					if (layerCount > 1)
					{
						menu.addSeparator(layerSubmenu);

						menu.addItem(mxResources.get('toFront'), null, mxUtils.bind(this, function()
						{
							graph.addCell(selectionLayer, model.root, layerCount - 1);
						}), layerSubmenu, null, index >= 0 && index < layerCount - 1);

						menu.addItem(mxResources.get('toBack'), null, mxUtils.bind(this, function()
						{
							graph.addCell(selectionLayer, model.root, 0);
						}), layerSubmenu, null, index > 0);

						if (layerCount > 2)
						{
							menu.addItem(mxResources.get('bringForward'), null, mxUtils.bind(this, function()
							{
								graph.addCell(selectionLayer, model.root, index + 1);
							}), layerSubmenu, null, index >= 0 && index < layerCount - 1);

							menu.addItem(mxResources.get('sendBackward'), null, mxUtils.bind(this, function()
							{
								graph.addCell(selectionLayer, model.root, index - 1);
							}), layerSubmenu, null, index > 0);
						}
					}

					menu.addSeparator(layerSubmenu);

					menu.addItem(mxResources.get('selectObjectsInLayer'), null, mxUtils.bind(this, function()
					{
						graph.clearSelection();
						graph.selectAll(selectionLayer);
					}), layerSubmenu, null, selectionLayer.children != null &&
						selectionLayer.children.length > 0);

					var moveSubmenu = menu.addItem(mxResources.get('moveSelectionTo', ['']),
						null, null, parent, null, !graph.isSelectionEmpty());

					if (graph.isSelectionEmpty())
					{
						moveSubmenu.setAttribute('title', mxResources.get('nothingIsSelected'));
					}

					for (var i = layerCount - 1; i >= 0; i--)
					{
						(mxUtils.bind(this, function(child)
						{
							var locked = mxUtils.getValue(graph.getCurrentCellStyle(child), 'locked', '0') == '1';

							var item = menu.addItem(graph.convertValueToString(child) ||
								mxResources.get('background'), null, mxUtils.bind(this, function()
							{
								if (!locked)
								{
									graph.moveCells(graph.getSelectionCells(), 0, 0, false, child);
								}
							}), moveSubmenu, null, !locked);

							if (locked)
							{
								item.setAttribute('title', mxResources.get('locked'));
							}

							if (child == layer)
							{
								menu.addCheckmark(item, Editor.checkmarkImage);
							}
						}))(model.getChildAt(model.root, i));
					}
				}));

				menu.smartSeparators = true;
				menu.showDisabled = true;
				menu.autoExpand = true;

				menu.hideMenu = mxUtils.bind(this, function()
				{
					mxPopupMenu.prototype.hideMenu.apply(menu, arguments);
					menu.destroy();
				});

				var clientX = mxEvent.getClientX(evt);
				var clientY = mxEvent.getClientY(evt);
				menu.popup(clientX, clientY, null, evt);

				editorUi.setCurrentMenu(menu);
				mxEvent.consume(evt);
			}
		});

		if (!graph.isEnabled())
		{
			menuLink.classList.add('mxDisabled');
		}

		var removeLink = link.cloneNode(false);
		removeLink.style.backgroundImage = 'url(' + Editor.trashImage + ')';
		removeLink.setAttribute('title', mxResources.get('delete'));
		ldiv.appendChild(removeLink);

		mxEvent.addListener(removeLink, 'click', function(evt)
		{
			if (graph.isEnabled())
			{
				model.beginUpdate();
				try
				{
					var index = model.root.getIndex(selectionLayer);
					var layers = getSelectedLayers();

					if (layers.length == 0)
					{
						layers.push(selectionLayer);
					}

					graph.removeCells(layers, false);

					if (model.getChildCount(model.root) == 0)
					{
						model.add(model.root, new mxCell());
						graph.setDefaultParent(null);
					}
					else if (index > 0 && index <= model.getChildCount(model.root))
					{
						graph.setDefaultParent(model.getChildAt(model.root, index - 1));
					}
					else
					{
						graph.setDefaultParent(null);
					}
				}
				finally
				{
					model.endUpdate();
				}
			}

			mxEvent.consume(evt);
		});

		if (!graph.isEnabled())
		{
			removeLink.classList.add('mxDisabled');
		}

		div.appendChild(ldiv);

		var dot = document.createElement('span');
		dot.setAttribute('title', mxResources.get('allSelectedObjectsInThisLayer'));
		dot.innerHTML = '&#8226;';
		dot.style.padding = '0 2px';
		dot.style.fontSize = '16pt';
		dot.style.order = '1';

		function updateLayerDot()
		{
			if (destroyed || (wnd != null && !wnd.isVisible())) return;
			var ldivRow = layerDivs.get(graph.getLayerForCells(graph.getSelectionCells()));
			if (ldivRow != null)
			{
				ldivRow.appendChild(dot);
			}
			else if (dot.parentNode != null)
			{
				dot.parentNode.removeChild(dot);
			}

			var selectedCells = graph.getSelectionCells();
			selectedRows.forEach(function(row)
			{
				row.removeAttribute('aria-selected');
			});
			selectedRows = [];
			for (var i = 0; i < selectedCells.length; i++)
			{
				var cRow = cellDivs.get(selectedCells[i]);
				if (cRow != null)
				{
					cRow.setAttribute('aria-selected', 'true');
					selectedRows.push(cRow);
				}
			}
		}

		function clearDrop()
		{
			if (dropRow != null)
			{
				dropRow.classList.remove('geHierarchyBefore', 'geHierarchyAfter', 'geHierarchyInside');
				dropRow = null;
			}
		}

		function button(content, title, fn, enabled, kind)
		{
			var el = document.createElement('button');
			el.type = 'button';
			if (typeof content === 'string' && content.charAt(0) === '<')
			{
				el.innerHTML = content;
			}
			else
			{
				el.textContent = content;
			}
			el.title = title;
			el.setAttribute('aria-label', title);
			el.dataset.hierarchyAction = kind;
			el.disabled = !enabled;
			el.onmousedown = function(evt) { evt.stopPropagation(); };
			el.onclick = function(evt) { evt.stopPropagation(); if (fn) fn(evt); };
			return el;
		}

		function renderChildCell(cell, depth)
		{
			var row = document.createElement('div');
			row.className = 'geHierarchyRow';
			row.style.paddingLeft = (depth * 14 + 4) + 'px';
			row.dataset.cellId = cell.id;
			row.setAttribute('role', 'treeitem');
			var name = label(cell);
			row.setAttribute('aria-label', name);

			var childCount = model.getChildCount(cell);
			var isExpanded = expandedCells.has(cell.id);

			if (childCount > 0)
			{
				var toggle = document.createElement('span');
				toggle.className = 'geHierarchyToggle';
				toggle.textContent = isExpanded ? '▼' : '▶';
				toggle.setAttribute('title', isExpanded ? '折りたたむ' : '展開する');
				mxEvent.addListener(toggle, 'click', function(evt)
				{
					if (expandedCells.has(cell.id))
					{
						expandedCells.delete(cell.id);
					}
					else
					{
						expandedCells.add(cell.id);
					}
					refresh();
					mxEvent.consume(evt);
				});
				row.appendChild(toggle);
			}
			else
			{
				var spacer = document.createElement('span');
				spacer.className = 'geHierarchySpacer';
				row.appendChild(spacer);
			}

			var handle = button('⋮⋮', 'ドラッグして順序・階層を移動', function() {}, structural(cell), 'drag');
			handle.draggable = !handle.disabled;
			handle.ondragstart = function(evt)
			{
				if (editing != null || !structural(cell)) { evt.preventDefault(); return; }
				draggingCell = cell;
				evt.dataTransfer.effectAllowed = 'move';
				evt.dataTransfer.setData('application/x-drawio-hierarchy', cell.id);
				evt.stopPropagation();
			};
			handle.ondragend = function()
			{
				draggingCell = null;
				clearDrop();
				refresh();
			};
			row.appendChild(handle);

			var selfVisible = model.isVisible(cell);
			var inheritedHidden = selfVisible && !visible(cell);
			var visIcon = selfVisible ? eyeSvg : eyeOffSvg;
			var visTitle = inheritedHidden ? '親が非表示（自身を非表示にする）' :
				selfVisible ? '非表示にする' : '表示する';
			var vis = button(visIcon, visTitle, function()
			{
				if (!canHide(cell)) return;
				change(function() { model.setVisible(cell, !model.isVisible(cell)); });
				graph.removeSelectionCells(graph.getSelectionCells().filter(function(selected) { return !visible(selected); }));
				refresh();
			}, canHide(cell), 'visibility');
			vis.setAttribute('aria-pressed', String(selfVisible));
			if (inheritedHidden)
			{
				vis.style.opacity = '.4';
			}
			else if (!selfVisible)
			{
				vis.style.opacity = '.5';
			}
			row.appendChild(vis);

			var labelSpan = document.createElement('span');
			labelSpan.className = 'geHierarchyLabel';
			labelSpan.textContent = name;
			labelSpan.title = name + (inheritedHidden ? '（親が非表示）' : selfVisible ? '' : '（非表示）');
			labelSpan.ondblclick = function(evt)
			{
				evt.stopPropagation();
				evt.preventDefault();
				rename(cell);
			};
			row.appendChild(labelSpan);

			row.onclick = function(evt)
			{
				evt.stopPropagation();
				select(cell, evt);
			};

			row.ondblclick = function(evt)
			{
				if (evt.target.tagName !== 'BUTTON' && evt.target.tagName !== 'INPUT')
				{
					evt.stopPropagation();
					evt.preventDefault();
					rename(cell);
				}
			};

			row.ondragover = function(evt)
			{
				clearDrop();
				evt.preventDefault();
				evt.stopPropagation();
				if (draggingCell == null) return;
				var mode = dropMode(evt, row);
				var plan = dropPlan(draggingCell, cell, mode, evt);
				evt.dataTransfer.dropEffect = plan.error ? 'none' : 'move';
				if (!plan.error)
				{
					dropRow = row;
					row.classList.add('geHierarchy' + mode[0].toUpperCase() + mode.slice(1));
				}
			};

			row.ondragleave = function(evt)
			{
				if (!row.contains(evt.relatedTarget)) clearDrop();
			};

			row.ondrop = function(evt)
			{
				evt.preventDefault();
				evt.stopPropagation();
				clearDrop();
				if (draggingCell == null) return;
				var dragged = draggingCell;
				draggingCell = null;
				var plan = dropPlan(dragged, cell, dropMode(evt, row), evt);
				if (!plan.error)
				{
					move(dragged, plan);
				}
				refresh();
			};

			cellDivs.put(cell, row);
			listDiv.appendChild(row);

			if (isExpanded && childCount > 0)
			{
				for (var c = childCount - 1; c >= 0; c--)
				{
					renderChildCell(model.getChildAt(cell, c), depth + 1);
				}
			}
		}

		function refresh()
		{
			clearTimeout(refreshTimer);
			refreshTimer = null;
			if (destroyed) return;
			dirty = true;
			if (wnd != null && !wnd.isVisible()) return;
			dirty = false;
			var scrollTop = listDiv.scrollTop;
			clearDrop();
			selectedRows = [];
			if (graph.isEnabled())
			{
				removeLink.classList.remove('mxDisabled');
				menuLink.classList.remove('mxDisabled');
				addLink.classList.remove('mxDisabled');
			}
			else
			{
				removeLink.classList.add('mxDisabled');
				menuLink.classList.add('mxDisabled');
				addLink.classList.add('mxDisabled');
			}

			layerCount = model.getChildCount(model.root);
			mxEvent.release(listDiv);
			listDiv.textContent = '';
			var newLayerDivs = new mxDictionary();
			cellDivs = new mxDictionary();

			function addLayer(index, labelText, child, defaultParent, selected)
			{
				var ldivRow = document.createElement('div');
				ldivRow.className = 'geToolbarContainer geHierarchyRow';
				ldivRow.style.overflow = 'hidden';
				ldivRow.style.position = 'relative';
				ldivRow.style.height = '30px';
				ldivRow.style.display = 'flex';
				ldivRow.style.padding = '0 8px';
				ldivRow.style.alignItems = 'center';
				ldivRow.style.justifyContent = 'flex-start';
				ldivRow.style.borderWidth = '0px 0px 1px 0px';
				ldivRow.style.borderStyle = 'solid';
				ldivRow.style.whiteSpace = 'nowrap';
				ldivRow.style.cursor = 'move';
				ldivRow.setAttribute('draggable', 'true');
				ldivRow.setAttribute('title', labelText + ' (' + child.getId() + ')');
				newLayerDivs.put(child, ldivRow);

				var childCount = model.getChildCount(child);
				var isExpanded = !collapsedLayers.has(child.id);

				if (childCount > 0)
				{
					var toggle = document.createElement('span');
					toggle.className = 'geHierarchyToggle';
					toggle.textContent = isExpanded ? '▼' : '▶';
					toggle.setAttribute('title', isExpanded ? '折りたたむ' : '展開する');
					mxEvent.addListener(toggle, 'click', function(evt)
					{
						if (collapsedLayers.has(child.id))
						{
							collapsedLayers.delete(child.id);
						}
						else
						{
							collapsedLayers.add(child.id);
						}
						refresh();
						mxEvent.consume(evt);
					});
					ldivRow.appendChild(toggle);
				}
				else
				{
					var spacer = document.createElement('span');
					spacer.className = 'geHierarchySpacer';
					ldivRow.appendChild(spacer);
				}

				var cb = document.createElement('input');
				cb.setAttribute('type', 'checkbox');
				cb.style.cursor = 'pointer';
				cb.style.order = '2';
				cb.style.width = 'auto';
				cb.style.flexShrink = '0';
				cb.checked = selected;
				cb.style.display = (graph.isEnabled()) ? '' : 'none';
				ldivRow.appendChild(cb);

				var contentDiv = document.createElement('div');
				contentDiv.className = 'geHierarchyLayerContent';
				contentDiv.style.display = 'flex';
				contentDiv.style.alignItems = 'center';
				contentDiv.style.minWidth = '0';
				contentDiv.style.flex = '1';

				mxEvent.addListener(cb, 'click', function(evt)
				{
					if (mxEvent.isShiftDown(evt))
					{
						selectLayers(cb.checked);
					}
				});

				var title = document.createElement('div');
				title.className = 'geHierarchyLayerTitle';
				mxUtils.write(title, labelText);
				title.style.whiteSpace = 'nowrap';
				title.style.overflow = 'hidden';
				title.style.textOverflow = 'ellipsis';
				title.style.marginRight = '4px';
				title.style.padding = '4px';
				title.style.minWidth = '0';
				title.style.flex = '1';

				mxEvent.addListener(ldivRow, 'dragover', function(evt)
				{
					if (draggingCell != null)
					{
						clearDrop();
						var plan = dropPlan(draggingCell, child, 'inside', evt);
						evt.dataTransfer.dropEffect = plan.error ? 'none' : 'move';
						if (!plan.error)
						{
							dropRow = ldivRow;
							ldivRow.classList.add('geHierarchyInside');
						}
					}
					else
					{
						evt.dataTransfer.dropEffect = 'move';
						dropIndex = index;
					}
					evt.stopPropagation();
					evt.preventDefault();
				});

				mxEvent.addListener(ldivRow, 'dragleave', function()
				{
					ldivRow.classList.remove('geHierarchyInside');
				});

				mxEvent.addListener(ldivRow, 'dragstart', function(evt)
				{
					if (title.contentEditable != 'true')
					{
						dragSource = ldivRow;
						if (mxClient.IS_FF)
						{
							evt.dataTransfer.setData('Text', '<layer/>');
						}
					}
				});

				mxEvent.addListener(ldivRow, 'dragend', function(evt)
				{
					var layers = getSelectedLayers();

					if (dragSource != null && dropIndex != null &&
						model.getChildCount(model.root) > 1)
					{
						layers = (layers.length == 0) ? [child] : layers;

						model.beginUpdate();
						try
						{
							for (var k = 0; k < layers.length; k++)
							{
								graph.addCell(layers[k], model.root, dropIndex);
							}
						}
						finally
						{
							model.endUpdate();
						}
					}

					dragSource = null;
					dropIndex = null;
					clearDrop();
					evt.stopPropagation();
					evt.preventDefault();
				});

				mxEvent.addListener(ldivRow, 'drop', function(evt)
				{
					clearDrop();
					if (draggingCell != null)
					{
						var dragged = draggingCell;
						draggingCell = null;
						var plan = dropPlan(dragged, child, 'inside', evt);
						if (!plan.error)
						{
							move(dragged, plan);
						}
						refresh();
						evt.stopPropagation();
						evt.preventDefault();
					}
				});

				var visibleVal = model.isVisible(child);
				var inp = document.createElement('img');
				inp.className = 'geAdaptiveAsset';
				inp.style.width = '16px';
				inp.style.padding = '0px 6px 0 0';
				inp.style.cursor = 'pointer';
				inp.style.flexShrink = '0';
				inp.setAttribute('title', mxResources.get(visibleVal ? 'hide' : 'show'));

				if (visibleVal)
				{
					inp.setAttribute('src', Editor.visibleImage);
					mxUtils.setOpacity(contentDiv, 90);
				}
				else
				{
					inp.setAttribute('src', Editor.hiddenImage);
					mxUtils.setOpacity(contentDiv, 40);
				}

				if (!graph.isEnabled())
				{
					mxUtils.setOpacity(inp, 50);
				}

				contentDiv.appendChild(inp);

				mxEvent.addListener(inp, 'click', function(evt)
				{
					if (graph.isEnabled())
					{
						if (mxEvent.isShiftDown(evt))
						{
							var others = getSelectedLayers(child, true);
							graph.setCellsVisible(others, !isLayersVisible(others));
						}
						else
						{
							graph.setCellsVisible([child], !visibleVal);
						}
					}

					mxEvent.consume(evt);
				});

				var btn = inp.cloneNode(false);
				var cellStyle = graph.getCurrentCellStyle(child);
				btn.setAttribute('title', mxResources.get('lockUnlock'));
				var locked = mxUtils.getValue(cellStyle, 'locked', '0') == '1';

				if (locked)
				{
					btn.setAttribute('src', Editor.lockedImage);
					mxUtils.setOpacity(btn, 90);
					ldivRow.style.color = 'red';
				}
				else
				{
					btn.setAttribute('src', Editor.unlockedImage);
					mxUtils.setOpacity(btn, 40);
				}

				if (graph.isEnabled())
				{
					btn.style.cursor = 'pointer';
				}

				mxEvent.addListener(btn, 'click', function(evt)
				{
					if (graph.isEnabled())
					{
						setLayersLocked(mxEvent.isShiftDown(evt) ?
							getSelectedLayers(null, true) : [child],
							!locked);
						mxEvent.consume(evt);
					}
				});

				contentDiv.appendChild(btn);
				contentDiv.appendChild(title);
				ldivRow.appendChild(contentDiv);

				mxEvent.addListener(ldivRow, 'dblclick', function(evt)
				{
					var nodeName = mxEvent.getSource(evt).nodeName;

					if (nodeName != 'INPUT' && nodeName != 'IMG' &&
						title.contentEditable != 'true')
					{
						renameLayer(child);
						mxEvent.consume(evt);
					}
				});

				if (graph.getDefaultParent() == child)
				{
					ldivRow.classList.add('geActivePage');
					ldivRow.style.fontWeight = (graph.isEnabled()) ? 'bold' : '';
					selectionLayer = child;
				}

				mxEvent.addListener(ldivRow, 'click', function(evt)
				{
					if (graph.isEnabled() && title.contentEditable != 'true' &&
						mxEvent.getSource(evt) != cb)
					{
						graph.setDefaultParent(defaultParent);
						graph.view.setCurrentRoot(null);

						if (mxEvent.isShiftDown(evt))
						{
							graph.clearSelection();
							graph.selectAll(selectionLayer);
						}

						mxEvent.consume(evt);
					}
				});

				listDiv.appendChild(ldivRow);

				// Render children of this layer if expanded
				if (isExpanded && childCount > 0)
				{
					for (var j = childCount - 1; j >= 0; j--)
					{
						renderChildCell(model.getChildAt(child, j), 1);
					}
				}
			}

			for (var i = layerCount - 1; i >= 0; i--)
			{
				(mxUtils.bind(this, function(child)
				{
					addLayer(i, graph.convertValueToString(child) ||
						mxResources.get('background'), child, child,
						isLayerSelected(child));
				}))(model.getChildAt(model.root, i));
			}

			layerDivs = newLayerDivs;
			updateLayerDot();
			listDiv.scrollTop = scrollTop;
		}

		function scheduleRefresh()
		{
			if (destroyed) return;
			dirty = true;
			if (refreshTimer == null && wnd.isVisible())
				refreshTimer = setTimeout(refresh, 0);
		}

		refresh();
		model.addListener(mxEvent.CHANGE, scheduleRefresh);
		graph.addListener('defaultParentChanged', scheduleRefresh);
		editorUi.addListener('lockedChanged', scheduleRefresh);
		graph.selectionModel.addListener(mxEvent.CHANGE, updateLayerDot);

		this.window = wnd = new mxWindow(mxResources.get('layers'), div, x, y, w, h, true, true);
		this.window.minimumSize = new mxRectangle(0, 0, 200, 200);
		this.window.destroyOnClose = false;
		this.window.setMaximizable(false);
		this.window.setResizable(true);
		this.window.setClosable(true);
		this.window.setVisible(true);

		this.init = function()
		{
			listDiv.scrollTop = listDiv.scrollHeight - listDiv.clientHeight;
		};

		this.window.addListener(mxEvent.SHOW, mxUtils.bind(this, function()
		{
			if (dirty) refresh();
			else updateLayerDot();
			this.window.fit();
		}));
		this.window.addListener(mxEvent.DESTROY, function()
		{
			destroyed = true;
			clearTimeout(refreshTimer);
			model.removeListener(scheduleRefresh);
			graph.removeListener(scheduleRefresh);
			editorUi.removeListener(scheduleRefresh);
			graph.selectionModel.removeListener(updateLayerDot);
			selectedRows = [];
			clearDrop();
		});

		this.refreshLayers = refresh;
		editorUi.installResizeHandler(this, true);
	};

	window.LayersWindow = CustomLayersWindow;

	// If layersWindow already exists on ui.actions, replace it with CustomLayersWindow
	if (ui.actions != null && ui.actions.layersWindow != null)
	{
		var oldWin = ui.actions.layersWindow;
		var wasVis = oldWin.window.isVisible();
		var bx = oldWin.window.getX();
		var by = oldWin.window.getY();
		var bw = Math.max(oldWin.window.getWidth(), 260);
		var bh = Math.max(oldWin.window.getHeight(), 360);
		oldWin.destroy();
		ui.actions.layersWindow = new CustomLayersWindow(ui, bx, by, bw, bh);
		ui.actions.layersWindow.window.addListener('show', function()
		{
			ui.fireEvent(new mxEventObject('layers'));
		});
		ui.actions.layersWindow.window.addListener('hide', function()
		{
			ui.fireEvent(new mxEventObject('layers'));
		});
		if (ui.installWindowPersistence != null)
		{
			ui.installWindowPersistence('layers', ui.actions.layersWindow);
		}
		ui.actions.layersWindow.window.setVisible(wasVis);
	}

	var action = ui.actions.addAction(actionName, function()
	{
		if (disposed) return;
		if (ui.actions.layersWindow == null)
		{
			var act = ui.actions.get('layers');
			if (act != null)
			{
				act.funct();
			}
		}
		else
		{
			if (!ui.actions.layersWindow.window.isVisible())
			{
				ui.actions.layersWindow.window.setVisible(true);
			}
			if (ui.actions.layersWindow.window.activate != null)
			{
				ui.actions.layersWindow.window.activate();
			}
		}
	});
	action.label = '階層・オブジェクトビューア';
	action.setEnabled(true);
	action.setToggleAction(true);
	action.setSelectedCallback(function()
	{
		return !disposed && ui.actions.layersWindow != null && ui.actions.layersWindow.window.isVisible();
	});

	function destroy()
	{
		if (disposed) return;
		disposed = true;
		if (ui.editor != null) mxUtils.remove(destroy, ui.destroyFunctions);
		if (window.LayersWindow == CustomLayersWindow) window.LayersWindow = origLayersWindow;
		if (ui.actions.layersWindow instanceof CustomLayersWindow)
		{
			ui.actions.layersWindow.destroy();
			ui.actions.layersWindow = null;
		}
		style.remove();
		ui.hierarchyViewer = null;
	}

	ui.hierarchyViewer = {destroy: destroy};
	ui.destroyFunctions.push(destroy);
});
