/**
 * draw.io Handle Scaler Plugin
 * 
 * 頂点（選択時のサイズ変更・回転ハンドル）や、接続ポイント（コネクタ接続用の点）の
 * 表示サイズおよび判定サイズを大きくして、操作性を向上させます。
 */
(function() {
    'use strict';

    var PLUGIN_NAME = 'Handle Scaler';
    var PATCH_VERSION = 2;
    var VERTEX_HANDLER_MARKER = '__handleScalerVertexHandlerPatched';
    var EDGE_HANDLER_MARKER = '__handleScalerEdgeHandlerPatched';
    var ELBOW_HANDLER_MARKER = '__handleScalerElbowHandlerPatched';
    var CONSTRAINT_HANDLER_MARKER = '__handleScalerConstraintHandlerPatched';
    var GRAPH_LISTENER_MARKER = '__handleScalerGraphListeners';

    /**
     * @param {string} message
     */
    function log(message) {
        if (typeof console !== 'undefined' && console.log) {
            console.log(PLUGIN_NAME + ': ' + message);
        }
    }

    /**
     * @param {string} message
     */
    function warn(message) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(PLUGIN_NAME + ': ' + message);
        }
    }

    /**
     * @returns {boolean}
     */
    function hasDrawPluginLoader() {
        return typeof Draw !== 'undefined' && Draw.loadPlugin != null;
    }

    /**
     * @param {Object} prototype
     * @param {string} marker
     * @param {string} methodName
     * @returns {Function}
     */
    function getOriginalMethod(prototype, marker, methodName) {
        var patch = prototype != null ? prototype[marker] : null;

        if (patch != null && Object.prototype.hasOwnProperty.call(patch, methodName)) {
            return patch[methodName];
        }

        return prototype != null ? prototype[methodName] : null;
    }

    /**
     * @param {Object} prototype
     * @param {string} marker
     * @param {string} methodName
     * @param {Function} original
     */
    function rememberOriginalMethod(prototype, marker, methodName, original) {
        var patch = prototype[marker];

        if (patch == null || patch.version !== PATCH_VERSION) {
            patch = { version: PATCH_VERSION };
            prototype[marker] = patch;
        }

        patch[methodName] = original;
    }

    /**
     * @param {Object} source
     * @param {Function} listener
     */
    function removeListener(source, listener) {
        if (source != null &&
            listener != null &&
            typeof source.removeListener === 'function') {
            source.removeListener(listener);
        }
    }

    var CONFIG = {
        handleSize: 10,       // 頂点の選択・リサイズハンドルのサイズ（デフォルト: 6〜7）
        edgeStartHandleSize: 26,  // コネクタ開始点ハンドルのサイズ（現行 draw.io 標準: 18〜22）
        edgeMiddleHandleSize: 22, // コネクタ中間点・経路変更ハンドルのサイズ（現行 draw.io 標準: 18）
        edgeEndHandleSize: 26,    // コネクタ終了点ハンドルのサイズ（現行 draw.io 標準: 18〜22）
        labelHandleSize: 6,    // テキストラベルの移動ハンドルのサイズ（デフォルト: 4）
        connectHandleSize: 10, // コネクタ接続用トリガーハンドルのサイズ（デフォルト: 8）
        pointImageSize: 6,     // コネクションポイント（青/緑の点）のサイズ（デフォルト: 5）
        roundHandles: false,   // ハンドルを丸型（円形）にするかどうか
        minHandleScale: 0.25,  // ズーム時のハンドルサイズの下限倍率（初期値の何倍まで縮小するか）
        maxHandleScale: 4,     // ズーム時のハンドルサイズの上限倍率（初期値の何倍まで拡大するか）
        maxPointScale: 2       // ズーム時の接続ポイントサイズの上限倍率（初期値の何倍まで拡大するか）
    };

    if (!hasDrawPluginLoader()) {
        warn('Draw.loadPlugin is not available.');
        return;
    }

    Draw.loadPlugin(function(ui) {
        var graph = ui.editor.graph;

        // --- ヘルパー関数 ---

        /**
         * ズーム比に応じたサイズ計算（100%〜800%で緩やかに最大サイズへ変化）
         * @param {number} baseSize
         * @param {number} maxSize
         * @param {number} scale
         * @param {number} minSize
         * @returns {number}
         */
        var getScaledSize = function(baseSize, maxSize, scale, minSize) {
            var size;
            if (scale >= 1) {
                var targetMaxScale = 8; // 800% で最大サイズに到達
                var t = (scale - 1) / (targetMaxScale - 1);
                t = Math.min(1, Math.max(0, t)); // 0〜1にクランプ
                size = baseSize + (maxSize - baseSize) * t;
            } else {
                size = baseSize * scale;
            }
            return Math.max(minSize || 4, Math.round(size));
        };

        /**
         * 設定に応じた sizer ハンドルの形状を生成する
         * @param {mxRectangle} bounds
         * @param {number} index
         * @param {string} fillColor
         * @returns {mxShape}
         */
        var getSizerShape = function(bounds, index, fillColor) {
            if (CONFIG.roundHandles) {
                return new mxEllipse(bounds, fillColor || mxConstants.HANDLE_FILLCOLOR, mxConstants.HANDLE_STROKECOLOR);
            } else {
                return new mxRectangleShape(bounds, fillColor || mxConstants.HANDLE_FILLCOLOR, mxConstants.HANDLE_STROKECOLOR);
            }
        };

        /**
         * sizers ハンドル配列の各 bounds サイズを最新の設定値に書き換える
         * @param {Array} sizers
         * @param {mxShape} labelShape
         * @param {mxShape} rotationShape
         */
        var updateSizersBounds = function(sizers, labelShape, rotationShape) {
            if (sizers == null) return;
            for (var i = 0; i < sizers.length; i++) {
                var sizer = sizers[i];
                if (sizer != null) {
                    if (labelShape && sizer === labelShape) {
                        sizer.bounds.width = mxConstants.LABEL_HANDLE_SIZE;
                        sizer.bounds.height = mxConstants.LABEL_HANDLE_SIZE;
                    } else if (rotationShape && sizer === rotationShape) {
                        sizer.bounds.width = mxConstants.HANDLE_SIZE + 3;
                        sizer.bounds.height = mxConstants.HANDLE_SIZE + 3;
                    } else {
                        sizer.bounds.width = mxConstants.HANDLE_SIZE;
                        sizer.bounds.height = mxConstants.HANDLE_SIZE;
                    }
                }
            }
        };

        var currentEdgeHandleSizes = {
            start: CONFIG.edgeStartHandleSize,
            middle: CONFIG.edgeMiddleHandleSize,
            end: CONFIG.edgeEndHandleSize
        };

        var getEdgeHandleSize = function(role) {
            return currentEdgeHandleSizes[role] || currentEdgeHandleSizes.middle || mxConstants.HANDLE_SIZE;
        };

        var getScaledHandleSize = function(baseSize, scale) {
            var minSize = Math.max(4, Math.round(baseSize * CONFIG.minHandleScale));
            var maxSize = Math.round(baseSize * CONFIG.maxHandleScale);
            return getScaledSize(baseSize, maxSize, scale, minSize);
        };

        var getScaledPointSize = function(scale) {
            return getScaledSize(
                CONFIG.pointImageSize,
                Math.round(CONFIG.pointImageSize * CONFIG.maxPointScale),
                scale,
                3
            );
        };

        var getEdgeHandleRole = function(handler, index, isTarget) {
            if (isTarget) {
                return 'end';
            }

            if (index === 0) {
                return 'start';
            }

            if (index != null && handler != null && handler.state != null &&
                handler.state.absolutePoints != null && index >= handler.state.absolutePoints.length - 1) {
                return 'end';
            }

            return 'middle';
        };

        var setShapeSize = function(shape, size, keepCenter, redraw) {
            if (shape == null || shape.bounds == null) return;
            if (shape.bounds.width === size && shape.bounds.height === size) return;

            if (keepCenter) {
                var cx = shape.bounds.getCenterX ? shape.bounds.getCenterX() : shape.bounds.x + shape.bounds.width / 2;
                var cy = shape.bounds.getCenterY ? shape.bounds.getCenterY() : shape.bounds.y + shape.bounds.height / 2;
                shape.bounds = new mxRectangle(Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
            } else {
                shape.bounds.width = size;
                shape.bounds.height = size;
            }

            if (redraw && typeof shape.redraw === 'function') {
                shape.redraw();
            }
        };

        var getEdgeHandleImage = function(handler, index, isTarget) {
            if (handler == null) return null;

            var isSource = index != null && index === 0;
            var terminalState = handler.state && typeof handler.state.getVisibleTerminalState === 'function' ?
                handler.state.getVisibleTerminalState(isSource) : null;
            var terminalIndex = index != null && handler.state != null && handler.state.absolutePoints != null &&
                (index === 0 || index >= handler.state.absolutePoints.length - 1 ||
                    (typeof mxElbowEdgeHandler !== 'undefined' && handler.constructor === mxElbowEdgeHandler && index === 2));
            var constraint = terminalIndex && handler.graph && typeof handler.graph.getConnectionConstraint === 'function' ?
                handler.graph.getConnectionConstraint(handler.state, terminalState, isSource) : null;
            var point = constraint != null && terminalState != null && handler.graph &&
                typeof handler.graph.getConnectionPoint === 'function' ?
                handler.graph.getConnectionPoint(terminalState, constraint) : null;

            if (point != null) {
                return isTarget ? handler.endFixedHandleImage : handler.fixedHandleImage;
            } else if (constraint != null && terminalState != null) {
                return isTarget ? handler.endTerminalHandleImage : handler.terminalHandleImage;
            }

            return isTarget ? handler.endHandleImage : handler.handleImage;
        };

        var createEdgeHandleShape = function(handler, index, isTarget) {
            var size = getEdgeHandleSize(getEdgeHandleRole(handler, index, isTarget));
            var image = getEdgeHandleImage(handler, index, isTarget);

            if (image != null) {
                var imageShape = new mxImageShape(new mxRectangle(0, 0, size, size), image.src);
                imageShape.preserveImageAspect = false;
                return imageShape;
            }

            return getSizerShape(new mxRectangle(0, 0, size, size), index, mxConstants.HANDLE_FILLCOLOR);
        };

        var setEdgeHandleImageSize = function(name, size) {
            if (typeof mxEdgeHandler === 'undefined' || mxEdgeHandler.prototype == null) return;

            var image = mxEdgeHandler.prototype[name];
            if (image == null) return;

            if (typeof mxImage !== 'undefined' && image.src != null) {
                mxEdgeHandler.prototype[name] = new mxImage(image.src, size, size);
            } else {
                image.width = size;
                image.height = size;
            }
        };

        var updateEdgeHandleImages = function() {
            var sourceSize = getEdgeHandleSize('start');
            var middleSize = getEdgeHandleSize('middle');
            var targetSize = getEdgeHandleSize('end');

            setEdgeHandleImageSize('handleImage', Math.max(sourceSize, middleSize));
            setEdgeHandleImageSize('terminalHandleImage', sourceSize);
            setEdgeHandleImageSize('fixedHandleImage', sourceSize);
            setEdgeHandleImageSize('endHandleImage', targetSize);
            setEdgeHandleImageSize('endTerminalHandleImage', targetSize);
            setEdgeHandleImageSize('endFixedHandleImage', targetSize);
        };

        var updateEdgeHandleBounds = function(handler, redraw) {
            if (handler == null) return;

            if (handler.bends != null) {
                for (var i = 0; i < handler.bends.length; i++) {
                    var role = (i === 0) ? 'start' : ((i === handler.bends.length - 1) ? 'end' : 'middle');
                    setShapeSize(handler.bends[i], getEdgeHandleSize(role), true, redraw);
                }
            }

            if (handler.virtualBends != null) {
                for (var j = 0; j < handler.virtualBends.length; j++) {
                    setShapeSize(handler.virtualBends[j], getEdgeHandleSize('middle'), true, redraw);
                }
            }
        };

        // --- プロトタイプオーバーライド ---

        // 1. ハンドル形状設定のオーバーライド
        if (typeof mxVertexHandler !== 'undefined' && mxVertexHandler.prototype) {
            var originalVertexSizer = getOriginalMethod(
                mxVertexHandler.prototype,
                VERTEX_HANDLER_MARKER,
                'createSizerShape'
            );
            rememberOriginalMethod(
                mxVertexHandler.prototype,
                VERTEX_HANDLER_MARKER,
                'createSizerShape',
                originalVertexSizer
            );

            mxVertexHandler.prototype.createSizerShape = function(bounds, index, fillColor) {
                if (index !== mxEvent.ROTATION_HANDLE) {
                    return getSizerShape(bounds, index, fillColor);
                }
                return originalVertexSizer.apply(this, arguments);
            };
        }
        if (typeof mxEdgeHandler !== 'undefined' && mxEdgeHandler.prototype) {
            rememberOriginalMethod(
                mxEdgeHandler.prototype,
                EDGE_HANDLER_MARKER,
                'createSizerShape',
                getOriginalMethod(mxEdgeHandler.prototype, EDGE_HANDLER_MARKER, 'createSizerShape')
            );
            rememberOriginalMethod(
                mxEdgeHandler.prototype,
                EDGE_HANDLER_MARKER,
                'createHandleShape',
                getOriginalMethod(mxEdgeHandler.prototype, EDGE_HANDLER_MARKER, 'createHandleShape')
            );

            mxEdgeHandler.prototype.createSizerShape = function(bounds, index, fillColor) {
                return getSizerShape(bounds, index, fillColor);
            };

            mxEdgeHandler.prototype.createHandleShape = function(index, source, isTarget) {
                return createEdgeHandleShape(this, index, isTarget);
            };
        }
        if (typeof mxElbowEdgeHandler !== 'undefined' && mxElbowEdgeHandler.prototype &&
            typeof mxElbowEdgeHandler.prototype.createVirtualBend === 'function') {
            var originalElbowCreateVirtualBend = getOriginalMethod(
                mxElbowEdgeHandler.prototype,
                ELBOW_HANDLER_MARKER,
                'createVirtualBend'
            );
            rememberOriginalMethod(
                mxElbowEdgeHandler.prototype,
                ELBOW_HANDLER_MARKER,
                'createVirtualBend',
                originalElbowCreateVirtualBend
            );

            mxElbowEdgeHandler.prototype.createVirtualBend = function() {
                var bend = originalElbowCreateVirtualBend.apply(this, arguments);
                setShapeSize(bend, getEdgeHandleSize('middle'), false, false);
                return bend;
            };
        }

        // 2. ズーム時に既存のハンドルの大きさが追従するように redraw を拡張
        if (typeof mxVertexHandler !== 'undefined' && mxVertexHandler.prototype) {
            var originalVertexRedraw = getOriginalMethod(
                mxVertexHandler.prototype,
                VERTEX_HANDLER_MARKER,
                'redraw'
            );
            rememberOriginalMethod(
                mxVertexHandler.prototype,
                VERTEX_HANDLER_MARKER,
                'redraw',
                originalVertexRedraw
            );

            mxVertexHandler.prototype.redraw = function() {
                updateSizersBounds(this.sizers, this.labelShape, this.rotationShape);
                originalVertexRedraw.apply(this, arguments);
            };
        }
        if (typeof mxEdgeHandler !== 'undefined' && mxEdgeHandler.prototype) {
            var originalEdgeRedrawHandles = getOriginalMethod(
                mxEdgeHandler.prototype,
                EDGE_HANDLER_MARKER,
                'redrawHandles'
            );
            rememberOriginalMethod(
                mxEdgeHandler.prototype,
                EDGE_HANDLER_MARKER,
                'redrawHandles',
                originalEdgeRedrawHandles
            );

            mxEdgeHandler.prototype.redrawHandles = function() {
                updateEdgeHandleBounds(this, false);
                originalEdgeRedrawHandles.apply(this, arguments);
                updateEdgeHandleBounds(this, true);
            };
        }

        // 3. 接続ポイントの判定範囲（tolerance）の動的スケーリング拡張
        var originalPointImageSrc = null;
        if (typeof mxConstraintHandler !== 'undefined' && mxConstraintHandler.prototype) {
            var oldPointImage = mxConstraintHandler.prototype.pointImage;
            originalPointImageSrc = oldPointImage ? oldPointImage.src : (typeof mxClient !== 'undefined' ? mxClient.imageBasePath : '') + '/point.gif';

            var originalGetTolerance = getOriginalMethod(
                mxConstraintHandler.prototype,
                CONSTRAINT_HANDLER_MARKER,
                'getTolerance'
            );
            rememberOriginalMethod(
                mxConstraintHandler.prototype,
                CONSTRAINT_HANDLER_MARKER,
                'getTolerance',
                originalGetTolerance
            );

            mxConstraintHandler.prototype.getTolerance = function(me) {
                var tol = originalGetTolerance ? originalGetTolerance.apply(this, arguments) : this.graph.getTolerance();
                var scale = (this.graph && this.graph.view) ? (this.graph.view.scale || 1) : 1;
                var currentPointSize = getScaledPointSize(scale);
                return Math.max(tol, Math.ceil(currentPointSize / 2) + 2);
            };
        }

        var originalConnectImageSrc = null;
        if (typeof mxConnectionHandler !== 'undefined' && mxConnectionHandler.prototype) {
            var oldConnectImage = mxConnectionHandler.prototype.connectImage;
            if (oldConnectImage) {
                originalConnectImageSrc = oldConnectImage.src;
            }
        }

        // --- ズーム連動処理 ---

        var previousScale = null;
        var updateSizes = function() {
            var scale = (graph && graph.view) ? (graph.view.scale || 1) : 1;
            if (scale === previousScale) return;
            previousScale = scale;

            // 各種ハンドルのサイズをズーム倍率に合わせて動的変更
            if (typeof mxConstants !== 'undefined') {
                mxConstants.HANDLE_SIZE = getScaledHandleSize(CONFIG.handleSize, scale);
                mxConstants.LABEL_HANDLE_SIZE = getScaledHandleSize(CONFIG.labelHandleSize, scale);
                mxConstants.CONNECT_HANDLE_SIZE = getScaledHandleSize(CONFIG.connectHandleSize, scale);
                currentEdgeHandleSizes.start = getScaledHandleSize(CONFIG.edgeStartHandleSize, scale);
                currentEdgeHandleSizes.middle = getScaledHandleSize(CONFIG.edgeMiddleHandleSize, scale);
                currentEdgeHandleSizes.end = getScaledHandleSize(CONFIG.edgeEndHandleSize, scale);
                updateEdgeHandleImages();
            }

            // 接続ポイントのサイズをズーム倍率に合わせて動的変更
            var currentPointSize = getScaledPointSize(scale);
            if (typeof mxConstraintHandler !== 'undefined' && mxConstraintHandler.prototype && originalPointImageSrc) {
                mxConstraintHandler.prototype.pointImage = new mxImage(originalPointImageSrc, currentPointSize, currentPointSize);
            }
            if (typeof mxConnectionHandler !== 'undefined' && mxConnectionHandler.prototype && originalConnectImageSrc) {
                mxConnectionHandler.prototype.connectImage = new mxImage(originalConnectImageSrc, currentPointSize, currentPointSize);
            }

            // 選択中セルの表示ハンドラをリフレッシュ
            if (graph && graph.selectionCellsHandler && typeof graph.selectionCellsHandler.refresh === 'function') {
                graph.selectionCellsHandler.refresh();
            }
        };

        // 初期実行
        updateSizes();

        var previousGraphListeners = graph != null ? graph[GRAPH_LISTENER_MARKER] : null;

        if (previousGraphListeners != null) {
            removeListener(
                graph != null ? graph.view : null,
                previousGraphListeners.updateSizes
            );
            removeListener(
                graph != null && graph.getSelectionModel ? graph.getSelectionModel() : null,
                previousGraphListeners.updateSizes
            );
        }

        // ズームイベントリスナーの登録
        if (graph && graph.view) {
            graph.view.addListener(mxEvent.SCALE, updateSizes);
            graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, updateSizes);
        }

        if (graph != null) {
            graph[GRAPH_LISTENER_MARKER] = {
                version: PATCH_VERSION,
                updateSizes: updateSizes
            };
        }

        log('loaded (handleSize=' + CONFIG.handleSize +
            ', minHandleScale=' + CONFIG.minHandleScale +
            ', maxHandleScale=' + CONFIG.maxHandleScale +
            ', edgeStart=' + CONFIG.edgeStartHandleSize +
            ', edgeMiddle=' + CONFIG.edgeMiddleHandleSize +
            ', edgeEnd=' + CONFIG.edgeEndHandleSize +
            ', pointSize=' + CONFIG.pointImageSize +
            ', maxPointScale=' + CONFIG.maxPointScale +
            ', dynamicZoom=true)');
    });
})();
