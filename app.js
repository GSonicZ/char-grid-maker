/* =========================================================================
   Character Grid Maker
   Single-file vanilla JS app. No build step, no external dependencies -
   just open index.html or host these 3 files on GitHub Pages.
   ========================================================================= */

(function () {
  "use strict";

  /* ---------------- Constants ---------------- */

  var IMG_SIZE = 100;        // fixed size (px) for every character image tile
  var ICON_SIZE = 48;        // fixed size (px) for row/column header icons
  var ROWHEAD_WIDTH = 90;    // width of the left "row header" column
  var HEADER_ROW_HEIGHT = 90; // height of the top "column header" row
  var STORAGE_KEY = "charGridMaker.state.v1";

  /* ---------------- State ---------------- */

  var idCounter = 0;

  var state = loadState();
  if (!state || !Array.isArray(state.rows) || !Array.isArray(state.cols)) {
    state = defaultState();
  }

  var activeCell = null;     // {row, col} ids of the last-clicked cell (paste target)
  var activeHeader = null;   // {kind, id} of the last-clicked header icon (paste target)
  var pendingTarget = null;  // where a file picked via the hidden <input> should go
  var cropperCtx = null;     // active cropper session, see openCropperGeneric()
  var dragState = null;      // active pointer-drag session inside the crop modal

  function genId(prefix) {
    idCounter += 1;
    return prefix + "_" + Date.now().toString(36) + "_" + idCounter;
  }

  function newHeader(label) {
    return { id: genId("h"), label: label || "", icon: null };
  }

  function defaultState() {
    return {
      title: "1",
      perLine: 3,
      bgColor: "#000000",
      lineColor: "#ffffff",
      textColor: "#ffffff",
      rows: [newHeader(""), newHeader("")],
      cols: [newHeader(""), newHeader("")],
      cells: {} // "rowId::colId" -> array of image refs
    };
  }

  function cellKey(rowId, colId) {
    return rowId + "::" + colId;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Most likely quota exceeded because of many embedded images.
      console.warn("Could not auto-save (browser storage full?). Use 'Save Project' to back up your work.", err);
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  /* ---------------- DOM refs ---------------- */

  var gridTable = document.getElementById("gridTable");
  var perLineInput = document.getElementById("perLineInput");
  var bgColorInput = document.getElementById("bgColorInput");
  var lineColorInput = document.getElementById("lineColorInput");
  var textColorInput = document.getElementById("textColorInput");
  var addRowBtn = document.getElementById("addRowBtn");
  var addColBtn = document.getElementById("addColBtn");
  var exportPngBtn = document.getElementById("exportPngBtn");
  var saveProjectBtn = document.getElementById("saveProjectBtn");
  var loadProjectBtn = document.getElementById("loadProjectBtn");
  var resetBtn = document.getElementById("resetBtn");
  var fileInputHidden = document.getElementById("fileInputHidden");
  var projectFileInputHidden = document.getElementById("projectFileInputHidden");

  var cropModal = document.getElementById("cropModal");
  var cropCanvas = document.getElementById("cropCanvas");
  var cropZoomInput = document.getElementById("cropZoomInput");
  var cropApplyBtn = document.getElementById("cropApplyBtn");
  var cropCancelBtn = document.getElementById("cropCancelBtn");
  var cropRemoveBtn = document.getElementById("cropRemoveBtn");

  /* ---------------- Small DOM helper ---------------- */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
      });
    }
    return node;
  }

  /* ---------------- Image helpers ---------------- */

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not load image")); };
      img.src = src;
    });
  }

  // "Cover fit" crop: centered, scaled up just enough to fill the square.
  function computeCoverFit(imgEl, size) {
    var scale = Math.max(size / imgEl.naturalWidth, size / imgEl.naturalHeight);
    return { scale: scale, offsetX: size / 2, offsetY: size / 2 };
  }

  // Renders imgEl onto a size x size canvas using the given crop transform
  // and returns a PNG data URL. This is what actually locks images to a
  // fixed pixel size while still letting the source crop differ.
  function renderCrop(imgEl, crop, size) {
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    var w = imgEl.naturalWidth * crop.scale;
    var h = imgEl.naturalHeight * crop.scale;
    ctx.drawImage(imgEl, crop.offsetX - w / 2, crop.offsetY - h / 2, w, h);
    return canvas.toDataURL("image/png");
  }

  /* ---------------- Mutating actions ---------------- */

  function addImagesToCell(rowId, colId, fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return Promise.resolve();

    var key = cellKey(rowId, colId);
    var chain = files.reduce(function (prevPromise, file) {
      return prevPromise.then(function () {
        return readFileAsDataURL(file)
          .then(loadImage)
          .then(function (imgEl) {
            var crop = computeCoverFit(imgEl, IMG_SIZE);
            var cropped = renderCrop(imgEl, crop, IMG_SIZE);
            var ref = { id: genId("img"), original: imgEl.src, crop: crop, cropped: cropped };
            if (!state.cells[key]) state.cells[key] = [];
            state.cells[key].push(ref);
          })
          .catch(function (err) { console.error("Could not add image", err); });
      });
    }, Promise.resolve());

    return chain.then(function () {
      saveState();
      renderTable();
    });
  }

  function removeCellImage(rowId, colId, imgId) {
    var key = cellKey(rowId, colId);
    var arr = state.cells[key];
    if (!arr) return;
    var idx = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === imgId) { idx = i; break; } }
    if (idx >= 0) arr.splice(idx, 1);
    if (arr.length === 0) delete state.cells[key];
    saveState();
    renderTable();
  }

  function addHeaderIcon(kind, headerId, file) {
    if (!file || file.type.indexOf("image/") !== 0) return Promise.resolve();
    var list = kind === "row" ? state.rows : state.cols;
    var header = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === headerId) { header = list[i]; break; } }
    if (!header) return Promise.resolve();

    return readFileAsDataURL(file)
      .then(loadImage)
      .then(function (imgEl) {
        var crop = computeCoverFit(imgEl, ICON_SIZE);
        var cropped = renderCrop(imgEl, crop, ICON_SIZE);
        header.icon = { id: genId("icon"), original: imgEl.src, crop: crop, cropped: cropped };
        saveState();
        renderTable();
      })
      .catch(function (err) { console.error("Could not set header icon", err); });
  }

  function addRow() {
    state.rows.push(newHeader(""));
    saveState();
    renderTable();
  }

  function addCol() {
    state.cols.push(newHeader(""));
    saveState();
    renderTable();
  }

  function deleteHeader(kind, headerId) {
    var list = kind === "row" ? state.rows : state.cols;
    if (list.length <= 1) {
      alert("You need to keep at least one " + kind + ".");
      return;
    }
    var hasData = Object.keys(state.cells).some(function (key) {
      var parts = key.split("::");
      var matches = kind === "row" ? parts[0] === headerId : parts[1] === headerId;
      return matches && state.cells[key].length > 0;
    });
    if (hasData && !confirm("This will delete every image in this " + kind + ". Continue?")) {
      return;
    }
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === headerId) { idx = i; break; } }
    if (idx >= 0) list.splice(idx, 1);
    Object.keys(state.cells).forEach(function (key) {
      var parts = key.split("::");
      var matches = kind === "row" ? parts[0] === headerId : parts[1] === headerId;
      if (matches) delete state.cells[key];
    });
    closeCropModal();
    if (activeCell && (kind === "row" ? activeCell.row === headerId : activeCell.col === headerId)) {
      activeCell = null;
    }
    if (activeHeader && activeHeader.kind === kind && activeHeader.id === headerId) {
      activeHeader = null;
    }
    saveState();
    renderTable();
  }

  /* ---------------- Label editing ---------------- */

  function startEditingLabel(span) {
    var kind = span.getAttribute("data-kind");
    var id = span.getAttribute("data-id");
    var current;
    if (kind === "corner") {
      current = state.title || "";
    } else {
      var list = kind === "row" ? state.rows : state.cols;
      var obj = null;
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { obj = list[i]; break; } }
      current = obj ? (obj.label || "") : "";
    }

    var input = document.createElement("input");
    input.type = "text";
    input.value = current;
    input.maxLength = 24;
    input.className = kind === "corner" ? "label-input" : "label-input";
    span.replaceWith(input);
    input.focus();
    input.select();

    var cancelled = false;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { input.blur(); }
      else if (e.key === "Escape") { cancelled = true; input.blur(); }
    });
    input.addEventListener("blur", function () {
      if (!cancelled) {
        var val = input.value.trim();
        if (kind === "corner") {
          state.title = val;
        } else {
          var list2 = kind === "row" ? state.rows : state.cols;
          for (var j = 0; j < list2.length; j++) {
            if (list2[j].id === id) { list2[j].label = val; break; }
          }
        }
        saveState();
      }
      renderTable();
    });
  }

  /* ---------------- Rendering ---------------- */

  function buildCornerCell() {
    var cell = el("div", { class: "corner-cell" });
    var label = el("span", { class: "label-text", "data-kind": "corner" });
    if (state.title) {
      label.textContent = state.title;
    } else {
      label.textContent = "title";
      label.classList.add("placeholder");
    }
    cell.appendChild(label);
    return cell;
  }

  function buildHeaderCell(headerObj, kind) {
    var hasIcon = !!(headerObj.icon && headerObj.icon.cropped);

    var cell = el("div", { class: "header-cell header-cell-" + kind, "data-kind": kind, "data-id": headerObj.id });

    var delBtn = el("button", { class: "del-header-btn", type: "button", "data-kind": kind, "data-id": headerObj.id, title: "Delete" });
    delBtn.textContent = "\u00D7";
    cell.appendChild(delBtn);

    var iconBox = el("div", { class: "icon-box", "data-kind": kind, "data-id": headerObj.id, "data-has-icon": hasIcon ? "true" : "false" });
    if (hasIcon) {
      var img = el("img", { src: headerObj.icon.cropped, alt: "" });
      iconBox.appendChild(img);
    } else {
      iconBox.textContent = "+";
    }
    cell.appendChild(iconBox);

    var label = el("span", { class: "label-text", "data-kind": kind, "data-id": headerObj.id });
    if (headerObj.label) {
      label.textContent = headerObj.label;
    } else {
      label.textContent = "label";
      label.classList.add("placeholder");
    }
    cell.appendChild(label);

    return cell;
  }

  function buildDataCell(rowObj, colObj) {
    var key = cellKey(rowObj.id, colObj.id);
    var images = state.cells[key] || [];

    var cell = el("div", { class: "cell", "data-row": rowObj.id, "data-col": colObj.id });
    cell.style.gridTemplateColumns = "repeat(" + state.perLine + ", " + IMG_SIZE + "px)";

    images.forEach(function (ref) {
      var tile = el("div", { class: "img-tile", "data-row": rowObj.id, "data-col": colObj.id, "data-img": ref.id });
      var img = el("img", { src: ref.cropped, alt: "" });
      var del = el("button", { class: "del-img-btn", type: "button", "data-row": rowObj.id, "data-col": colObj.id, "data-img": ref.id, title: "Remove" });
      del.textContent = "\u00D7";
      tile.appendChild(img);
      tile.appendChild(del);
      cell.appendChild(tile);
    });

    var addTile = el("div", { class: "add-tile", "data-row": rowObj.id, "data-col": colObj.id, title: "Add image" });
    addTile.textContent = "+";
    cell.appendChild(addTile);

    return cell;
  }

  function applyThemeVars() {
    var root = document.documentElement.style;
    root.setProperty("--bg-color", state.bgColor);
    root.setProperty("--line-color", state.lineColor);
    root.setProperty("--text-color", state.textColor);
  }

  function setActiveCell(row, col) {
    activeCell = { row: row, col: col };
    activeHeader = null;
    updateActiveHighlights();
  }

  function setActiveHeader(kind, id) {
    activeHeader = { kind: kind, id: id };
    activeCell = null;
    updateActiveHighlights();
  }

  function updateActiveHighlights() {
    var prev = gridTable.querySelectorAll(".active");
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove("active");
    if (activeCell) {
      var foundCell = gridTable.querySelector(
        '.cell[data-row="' + activeCell.row + '"][data-col="' + activeCell.col + '"]'
      );
      if (foundCell) foundCell.classList.add("active");
    } else if (activeHeader) {
      var foundHeader = gridTable.querySelector(
        '.header-cell[data-kind="' + activeHeader.kind + '"][data-id="' + activeHeader.id + '"]'
      );
      if (foundHeader) foundHeader.classList.add("active");
    }
  }

  function renderTable() {
    applyThemeVars();

    var cellWidth = state.perLine * IMG_SIZE;
    gridTable.style.gridTemplateColumns =
      ROWHEAD_WIDTH + "px " + state.cols.map(function () { return cellWidth + "px"; }).join(" ");
    gridTable.style.gridTemplateRows =
      HEADER_ROW_HEIGHT + "px " + state.rows.map(function () { return "auto"; }).join(" ");

    gridTable.innerHTML = "";
    gridTable.appendChild(buildCornerCell());
    state.cols.forEach(function (col) { gridTable.appendChild(buildHeaderCell(col, "col")); });
    state.rows.forEach(function (row) {
      gridTable.appendChild(buildHeaderCell(row, "row"));
      state.cols.forEach(function (col) { gridTable.appendChild(buildDataCell(row, col)); });
    });

    updateActiveHighlights();
  }

  /* ---------------- Crop / reposition modal ---------------- */

  function openCropperGeneric(original, crop, outputSize, onApply, onRemove) {
    loadImage(original).then(function (imgEl) {
      var base = computeCoverFit(imgEl, outputSize);
      cropperCtx = {
        imgEl: imgEl,
        outputSize: outputSize,
        baseScale: base.scale,
        scale: crop.scale,
        offsetX: crop.offsetX,
        offsetY: crop.offsetY,
        onApply: onApply,
        onRemove: onRemove
      };

      cropZoomInput.min = "1";
      cropZoomInput.max = "4";
      cropZoomInput.step = "0.01";
      var mult = cropperCtx.baseScale > 0 ? cropperCtx.scale / cropperCtx.baseScale : 1;
      cropZoomInput.value = String(Math.min(4, Math.max(1, mult)));

      cropCanvas.width = outputSize;
      cropCanvas.height = outputSize;
      var displaySize = Math.max(200, Math.min(320, outputSize * 3));
      cropCanvas.style.width = displaySize + "px";
      cropCanvas.style.height = displaySize + "px";

      clampOffsets();
      drawCropCanvas();
      cropModal.classList.remove("hidden");
    }).catch(function (err) {
      console.error(err);
      alert("Could not load this image for editing.");
    });
  }

  function openCropperForCellImage(rowId, colId, imgId) {
    var key = cellKey(rowId, colId);
    var arr = state.cells[key];
    if (!arr) return;
    var ref = null;
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === imgId) { ref = arr[i]; break; } }
    if (!ref) return;

    setActiveCell(rowId, colId);

    openCropperGeneric(ref.original, ref.crop, IMG_SIZE,
      function (newCrop, newCropped) {
        ref.crop = newCrop;
        ref.cropped = newCropped;
        saveState();
        renderTable();
      },
      function () { removeCellImage(rowId, colId, imgId); }
    );
  }

  function openCropperForHeaderIcon(kind, headerId) {
    var list = kind === "row" ? state.rows : state.cols;
    var header = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === headerId) { header = list[i]; break; } }
    if (!header || !header.icon) return;

    setActiveHeader(kind, headerId);

    openCropperGeneric(header.icon.original, header.icon.crop, ICON_SIZE,
      function (newCrop, newCropped) {
        header.icon.crop = newCrop;
        header.icon.cropped = newCropped;
        saveState();
        renderTable();
      },
      function () { header.icon = null; saveState(); renderTable(); }
    );
  }

  function drawCropCanvas() {
    if (!cropperCtx) return;
    var ctx = cropCanvas.getContext("2d");
    var size = cropperCtx.outputSize;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    var w = cropperCtx.imgEl.naturalWidth * cropperCtx.scale;
    var h = cropperCtx.imgEl.naturalHeight * cropperCtx.scale;
    ctx.drawImage(cropperCtx.imgEl, cropperCtx.offsetX - w / 2, cropperCtx.offsetY - h / 2, w, h);
  }

  // Keeps the image covering the whole crop frame (no empty corners).
  function clampOffsets() {
    if (!cropperCtx) return;
    var size = cropperCtx.outputSize;
    var w = cropperCtx.imgEl.naturalWidth * cropperCtx.scale;
    var h = cropperCtx.imgEl.naturalHeight * cropperCtx.scale;
    var minX = size - w / 2, maxX = w / 2;
    var minY = size - h / 2, maxY = h / 2;
    cropperCtx.offsetX = Math.min(maxX, Math.max(minX, cropperCtx.offsetX));
    cropperCtx.offsetY = Math.min(maxY, Math.max(minY, cropperCtx.offsetY));
  }

  function closeCropModal() {
    cropModal.classList.add("hidden");
    cropperCtx = null;
    dragState = null;
  }

  cropZoomInput.addEventListener("input", function () {
    if (!cropperCtx) return;
    var mult = parseFloat(cropZoomInput.value);
    if (isNaN(mult)) mult = 1;
    cropperCtx.scale = cropperCtx.baseScale * mult;
    clampOffsets();
    drawCropCanvas();
  });

  cropCanvas.addEventListener("pointerdown", function (e) {
    if (!cropperCtx) return;
    cropCanvas.setPointerCapture(e.pointerId);
    cropCanvas.style.cursor = "grabbing";
    dragState = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: cropperCtx.offsetX,
      startOffsetY: cropperCtx.offsetY
    };
  });
  cropCanvas.addEventListener("pointermove", function (e) {
    if (!dragState || !cropperCtx) return;
    var rect = cropCanvas.getBoundingClientRect();
    var ratio = cropperCtx.outputSize / rect.width;
    var dx = (e.clientX - dragState.startClientX) * ratio;
    var dy = (e.clientY - dragState.startClientY) * ratio;
    cropperCtx.offsetX = dragState.startOffsetX + dx;
    cropperCtx.offsetY = dragState.startOffsetY + dy;
    clampOffsets();
    drawCropCanvas();
  });
  function endDrag() {
    dragState = null;
    cropCanvas.style.cursor = "grab";
  }
  cropCanvas.addEventListener("pointerup", endDrag);
  cropCanvas.addEventListener("pointercancel", endDrag);

  cropApplyBtn.addEventListener("click", function () {
    if (!cropperCtx) return;
    var cropped = cropCanvas.toDataURL("image/png");
    var newCrop = { scale: cropperCtx.scale, offsetX: cropperCtx.offsetX, offsetY: cropperCtx.offsetY };
    var onApply = cropperCtx.onApply;
    closeCropModal();
    onApply(newCrop, cropped);
  });
  cropCancelBtn.addEventListener("click", closeCropModal);
  cropRemoveBtn.addEventListener("click", function () {
    if (!cropperCtx) return;
    var onRemove = cropperCtx.onRemove;
    if (confirm("Remove this image?")) {
      closeCropModal();
      onRemove();
    }
  });

  /* ---------------- PNG export ---------------- */

  function drawHeaderContent(ctx, headerObj, x, y, w, h, imgMap) {
    var cx = x + w / 2;
    var iconBottom = y + h / 2;

    if (headerObj.icon) {
      var imgEl = imgMap.get(headerObj.icon.cropped);
      var iconY = headerObj.label ? (y + h / 2 - ICON_SIZE / 2 - 6) : (y + h / 2 - ICON_SIZE / 2);
      if (imgEl) ctx.drawImage(imgEl, cx - ICON_SIZE / 2, iconY, ICON_SIZE, ICON_SIZE);
      iconBottom = iconY + ICON_SIZE;
    }

    if (headerObj.label) {
      var prevFont = ctx.font, prevAlign = ctx.textAlign, prevBaseline = ctx.textBaseline;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      var textY = headerObj.icon ? (iconBottom + 4) : (y + h / 2 - 7);
      ctx.fillText(headerObj.label, cx, textY, w - 8);
      ctx.font = prevFont; ctx.textAlign = prevAlign; ctx.textBaseline = prevBaseline;
    }
  }

  function exportPNG() {
    var cellWidth = state.perLine * IMG_SIZE;

    var rowHeights = state.rows.map(function (row) {
      var maxCount = 0;
      state.cols.forEach(function (col) {
        var arr = state.cells[cellKey(row.id, col.id)];
        if (arr) maxCount = Math.max(maxCount, arr.length);
      });
      var lines = Math.max(1, Math.ceil(maxCount / state.perLine));
      return lines * IMG_SIZE;
    });

    var totalWidth = ROWHEAD_WIDTH + state.cols.length * cellWidth;
    var totalHeight = HEADER_ROW_HEIGHT + rowHeights.reduce(function (a, b) { return a + b; }, 0);

    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, totalWidth);
    canvas.height = Math.max(1, totalHeight);
    var ctx = canvas.getContext("2d");

    // Preload every image (header icons + cell images) that will be drawn.
    var toLoad = [];
    state.rows.forEach(function (r) { if (r.icon) toLoad.push(r.icon.cropped); });
    state.cols.forEach(function (c) { if (c.icon) toLoad.push(c.icon.cropped); });
    state.rows.forEach(function (r) {
      state.cols.forEach(function (c) {
        var arr = state.cells[cellKey(r.id, c.id)];
        if (arr) arr.forEach(function (im) { toLoad.push(im.cropped); });
      });
    });

    var imgMap = new Map();
    var uniqueSrcs = toLoad.filter(function (src, idx) { return toLoad.indexOf(src) === idx; });

    return Promise.all(uniqueSrcs.map(function (src) {
      return loadImage(src).then(function (imgEl) { imgMap.set(src, imgEl); });
    })).then(function () {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(0, 0, totalWidth, totalHeight);
      ctx.strokeStyle = state.lineColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = state.textColor;

      // Corner cell
      ctx.strokeRect(0, 0, ROWHEAD_WIDTH, HEADER_ROW_HEIGHT);
      if (state.title) {
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(state.title, ROWHEAD_WIDTH / 2, HEADER_ROW_HEIGHT / 2, ROWHEAD_WIDTH - 8);
      }

      // Column headers
      state.cols.forEach(function (col, j) {
        var x = ROWHEAD_WIDTH + j * cellWidth;
        ctx.strokeRect(x, 0, cellWidth, HEADER_ROW_HEIGHT);
        drawHeaderContent(ctx, col, x, 0, cellWidth, HEADER_ROW_HEIGHT, imgMap);
      });

      // Rows
      var y = HEADER_ROW_HEIGHT;
      state.rows.forEach(function (row, i) {
        var rh = rowHeights[i];
        ctx.strokeRect(0, y, ROWHEAD_WIDTH, rh);
        drawHeaderContent(ctx, row, 0, y, ROWHEAD_WIDTH, rh, imgMap);

        state.cols.forEach(function (col, j) {
          var x = ROWHEAD_WIDTH + j * cellWidth;
          ctx.strokeRect(x, y, cellWidth, rh);
          var arr = state.cells[cellKey(row.id, col.id)] || [];
          arr.forEach(function (im, idx) {
            var cIdx = idx % state.perLine;
            var rIdx = Math.floor(idx / state.perLine);
            var imgEl = imgMap.get(im.cropped);
            if (imgEl) ctx.drawImage(imgEl, x + cIdx * IMG_SIZE, y + rIdx * IMG_SIZE, IMG_SIZE, IMG_SIZE);
          });
        });

        y += rh;
      });

      var link = document.createElement("a");
      link.download = (state.title || "character-grid").replace(/[^a-z0-9_-]+/gi, "_") + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    }).catch(function (err) {
      console.error(err);
      alert("Something went wrong while exporting the PNG. Check the console for details.");
    });
  }

  /* ---------------- Save / load project file ---------------- */

  function saveProjectToFile() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = (state.title || "character-grid").replace(/[^a-z0-9_-]+/gi, "_") + ".json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function loadProjectFromFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.rows) || !Array.isArray(parsed.cols) || typeof parsed.cells !== "object") {
          throw new Error("Invalid project file shape");
        }
        state = parsed;
        if (typeof state.perLine !== "number" || state.perLine < 1) state.perLine = 3;
        if (!state.bgColor) state.bgColor = "#000000";
        if (!state.lineColor) state.lineColor = "#ffffff";
        if (!state.textColor) state.textColor = "#ffffff";
        activeCell = null;
        syncToolbarInputs();
        saveState();
        renderTable();
      } catch (err) {
        console.error(err);
        alert("Could not load this file - it does not look like a valid project file.");
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- Toolbar wiring ---------------- */

  function syncToolbarInputs() {
    perLineInput.value = state.perLine;
    bgColorInput.value = state.bgColor;
    lineColorInput.value = state.lineColor;
    textColorInput.value = state.textColor;
  }

  perLineInput.addEventListener("change", function () {
    var v = parseInt(perLineInput.value, 10);
    if (isNaN(v)) v = 3;
    v = Math.max(1, Math.min(8, v));
    perLineInput.value = v;
    state.perLine = v;
    saveState();
    renderTable();
  });

  bgColorInput.addEventListener("input", function () {
    state.bgColor = bgColorInput.value;
    saveState();
    applyThemeVars();
  });
  lineColorInput.addEventListener("input", function () {
    state.lineColor = lineColorInput.value;
    saveState();
    applyThemeVars();
  });
  textColorInput.addEventListener("input", function () {
    state.textColor = textColorInput.value;
    saveState();
    applyThemeVars();
  });

  addRowBtn.addEventListener("click", addRow);
  addColBtn.addEventListener("click", addCol);
  exportPngBtn.addEventListener("click", exportPNG);
  saveProjectBtn.addEventListener("click", saveProjectToFile);
  loadProjectBtn.addEventListener("click", function () { projectFileInputHidden.click(); });

  resetBtn.addEventListener("click", function () {
    if (confirm("This clears the current table. Export or save first if you want to keep it. Continue?")) {
      state = defaultState();
      activeCell = null;
      syncToolbarInputs();
      saveState();
      renderTable();
    }
  });

  fileInputHidden.addEventListener("change", function () {
    var files = fileInputHidden.files;
    var target = pendingTarget;
    pendingTarget = null;
    var task = Promise.resolve();
    if (target) {
      if (target.type === "cell") {
        task = addImagesToCell(target.row, target.col, files);
      } else if (target.type === "header-icon" && files[0]) {
        task = addHeaderIcon(target.kind, target.id, files[0]);
      }
    }
    task.then(function () { fileInputHidden.value = ""; });
  });

  projectFileInputHidden.addEventListener("change", function () {
    var file = projectFileInputHidden.files[0];
    if (file) loadProjectFromFile(file);
    projectFileInputHidden.value = "";
  });

  /* ---------------- Table interaction (event delegation) ---------------- */

  gridTable.addEventListener("click", function (e) {
    var addTile = e.target.closest(".add-tile");
    if (addTile) {
      var targetRow = addTile.getAttribute("data-row"), targetCol = addTile.getAttribute("data-col");
      setActiveCell(targetRow, targetCol);
      pendingTarget = { type: "cell", row: targetRow, col: targetCol };
      fileInputHidden.click();
      return;
    }

    var delImgBtn = e.target.closest(".del-img-btn");
    if (delImgBtn) {
      removeCellImage(delImgBtn.getAttribute("data-row"), delImgBtn.getAttribute("data-col"), delImgBtn.getAttribute("data-img"));
      return;
    }

    var imgTile = e.target.closest(".img-tile");
    if (imgTile) {
      openCropperForCellImage(imgTile.getAttribute("data-row"), imgTile.getAttribute("data-col"), imgTile.getAttribute("data-img"));
      return;
    }

    var delHeaderBtn = e.target.closest(".del-header-btn");
    if (delHeaderBtn) {
      deleteHeader(delHeaderBtn.getAttribute("data-kind"), delHeaderBtn.getAttribute("data-id"));
      return;
    }

    var iconBox = e.target.closest(".icon-box");
    if (iconBox) {
      var kind = iconBox.getAttribute("data-kind");
      var id = iconBox.getAttribute("data-id");
      if (iconBox.getAttribute("data-has-icon") === "true") {
        openCropperForHeaderIcon(kind, id);
      } else {
        setActiveHeader(kind, id);
        pendingTarget = { type: "header-icon", kind: kind, id: id };
        fileInputHidden.click();
      }
      return;
    }

    var labelSpan = e.target.closest(".label-text");
    if (labelSpan) {
      startEditingLabel(labelSpan);
      return;
    }

    var cellEl = e.target.closest(".cell");
    if (cellEl) {
      setActiveCell(cellEl.getAttribute("data-row"), cellEl.getAttribute("data-col"));
      return;
    }

    // Clicking elsewhere in a header cell (its padding, not the icon/label/delete
    // button specifically) still marks it as the paste target for that header's icon.
    var headerCellEl = e.target.closest(".header-cell");
    if (headerCellEl) {
      setActiveHeader(headerCellEl.getAttribute("data-kind"), headerCellEl.getAttribute("data-id"));
    }
  });

  // Drag & drop and paste both need to know whether the user is pointing at a
  // data cell (which can hold many images) or a header cell (a single icon).
  function findDropTarget(e) {
    if (!e.target || !e.target.closest) return null;
    var cellEl = e.target.closest(".cell");
    if (cellEl) return { type: "cell", el: cellEl };
    var headerEl = e.target.closest(".header-cell");
    if (headerEl) return { type: "header", el: headerEl };
    return null;
  }

  gridTable.addEventListener("dragover", function (e) {
    var target = findDropTarget(e);
    if (target) {
      e.preventDefault();
      target.el.classList.add("drag-over");
    }
  });
  gridTable.addEventListener("dragleave", function (e) {
    var target = findDropTarget(e);
    if (target) target.el.classList.remove("drag-over");
  });
  gridTable.addEventListener("drop", function (e) {
    var target = findDropTarget(e);
    if (!target) return;
    e.preventDefault();
    target.el.classList.remove("drag-over");
    var files = Array.prototype.filter.call(e.dataTransfer.files || [], function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return;

    if (target.type === "cell") {
      var row = target.el.getAttribute("data-row"), col = target.el.getAttribute("data-col");
      setActiveCell(row, col);
      addImagesToCell(row, col, files);
    } else {
      var kind = target.el.getAttribute("data-kind"), id = target.el.getAttribute("data-id");
      setActiveHeader(kind, id);
      addHeaderIcon(kind, id, files[0]); // a header only ever holds one icon
    }
  });

  document.addEventListener("paste", function (e) {
    if (!activeCell && !activeHeader) return;
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.kind === "file" && item.type.indexOf("image/") === 0) {
        var f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    if (activeCell) {
      addImagesToCell(activeCell.row, activeCell.col, files);
    } else {
      addHeaderIcon(activeHeader.kind, activeHeader.id, files[0]); // a header only ever holds one icon
    }
  });

  /* ---------------- Init ---------------- */

  syncToolbarInputs();
  renderTable();

})();
