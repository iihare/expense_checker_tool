(() => {
  const STANDARD_ITEMS = [
    "場地費",
    "場地布置費",
    "設備使用或租借費",
    "書籍資料及文宣品印刷費",
    "鐘點費",
    "出席費",
    "裁判費",
    "租車費",
    "交通費",
    "住宿費",
    "報名費",
    "保險費"
  ];

  const FIELD_ALIASES = {
    unitPrice: ["單價"],
    quantity: ["數量"],
    budget: ["預算金額", "預算"],
    grant: ["本要點", "要點補助"],
    agency: ["他機關"],
    self: ["自付經費", "自付"],
    other: ["其他"]
  };

  // ── 表頭辨識設定（全部是「比例」或「字數」，沒有任何像素常數）──
  const HEADER_FIELD_ORDER = [
    "unitPrice", "quantity", "budget", "grant", "agency", "self", "other"
  ];
  const MIN_HEADER_FIELDS = 5;      // 至少辨識幾欄才接受
  const MAX_HEADER_LINES = 6;       // 同一欄表頭最多合併幾行
  const MAX_EXTRA_CHARS = 8;        // 合併後文字比關鍵字多出幾字以內才接受
  const FUZZY_MIN_LENGTH = 3;       // 關鍵字至少幾字才允許 1 字誤差
  const MAX_HEADER_TEXT_LENGTH = 8; // 表頭單行文字的字數上限（標題、說明文字會被排除）
  const COLUMN_OVERLAP = 0.5;       // 同欄判定：x 範圍重疊占較窄文字的比例

  function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[a.length][b.length];
  }

  // 回傳誤差字數：完全符合 0、差 1 字 1、不符合 null
  function aliasMatch(text, alias) {
    if (text.includes(alias)) return 0;
    if (alias.length < FUZZY_MIN_LENGTH) return null;

    for (let size = alias.length - 1; size <= alias.length + 1; size++) {
      for (let s = 0; s + size <= text.length; s++) {
        if (editDistance(text.slice(s, s + size), alias) <= 1) return 1;
      }
    }
    return null;
  }

  // 第一個「同一列有 3 個以上數字」的列，其上緣就是資料區起點。
  // 表頭一定在它上方；表格下方的總經費列、頁尾都不會被誤認。
  function findDataTop(items) {
    const rows = groupNumberRows(items, 0, true);
    const first = rows.find(row => row.numbers.length >= 3);
    return first ? Math.min(...first.numbers.map(n => n.y0)) : null;
  }

  // 資料區上方、字數短的文字才是表頭候選（標題、說明文字通常較長）
  function getHeaderZone(items, dataTop) {
    return items.filter(
      item =>
        item.cy < dataTop &&
        normalizeText(item.text).length <= MAX_HEADER_TEXT_LENGTH
    );
  }

  // 兩段文字的 x 範圍重疊夠多，就視為同一欄（比例判斷，與解析度無關）
  function isSameColumn(a, b) {
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0);
    return narrow > 0 && overlap >= narrow * COLUMN_OVERLAP;
  }

  // 跨欄文字（例如「自籌款」橫跨兩欄、較大的標題）會同時與兩個
  // 互不相連的欄位重疊，會把相鄰兩欄誤合併，必須先排除。
  // 一次只排除最寬的一個再重算，避免把正常欄位的文字一起誤刪。
  function removeBridgingItems(zoneItems) {
    let items = zoneItems.slice();

    while (true) {
      let widest = null;

      for (const a of items) {
        const nb = items.filter(b => b !== a && isSameColumn(a, b));
        let bridging = false;

        for (let x = 0; x < nb.length && !bridging; x++) {
          for (let y = x + 1; y < nb.length; y++) {
            if (!isSameColumn(nb[x], nb[y])) {
              bridging = true;
              break;
            }
          }
        }

        if (bridging && (!widest || a.x1 - a.x0 > widest.x1 - widest.x0)) {
          widest = a;
        }
      }

      if (!widest) return items;
      items = items.filter(item => item !== widest);
    }
  }

  // 依 x 範圍重疊分欄；同一欄的各行不論行距多少都會歸在一起
  function clusterByColumn(zoneItems) {
    const items = removeBridgingItems(zoneItems);
    const parent = items.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (isSameColumn(items[i], items[j])) parent[find(i)] = find(j);
      }
    }

    const groups = new Map();
    items.forEach((item, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(item);
    });

    return [...groups.values()].map(g => g.sort((a, b) => a.cy - b.cy));
  }

  // 一欄內，嘗試所有「連續 1～N 行」的組合，與每個欄位關鍵字比對。
  // 只看行的先後順序，不看行距。
  function matchClusterToFields(cluster) {
    const results = [];

    for (let s = 0; s < cluster.length; s++) {
      const last = Math.min(cluster.length, s + MAX_HEADER_LINES);

      for (let e = s; e < last; e++) {
        const win = cluster.slice(s, e + 1);
        const text = normalizeText(win.map(line => line.text).join(""));

        for (const field of HEADER_FIELD_ORDER) {
          for (const alias of FIELD_ALIASES[field]) {
            const a = normalizeText(alias);
            const errors = aliasMatch(text, a);
            if (errors === null) continue;

            const extra = text.length - a.length;
            if (extra > MAX_EXTRA_CHARS) continue;

            // 完全符合一定優於模糊符合；其次是多出的字越少越好
            results.push({ field, win, cost: errors * 10 + extra });
          }
        }
      }
    }

    return results;
  }

  // 欄位必須由左到右依固定順序出現；
  // 有欄位位置矛盾時，逐一移除「矛盾最多」的欄位。
  function dropOutOfOrder(matched) {
    const fields = HEADER_FIELD_ORDER.filter(f => matched[f]);

    while (fields.length) {
      const bad = fields.map(f => ({ f, n: 0 }));

      for (let i = 0; i < fields.length; i++) {
        for (let j = i + 1; j < fields.length; j++) {
          if (matched[fields[i]].cx >= matched[fields[j]].cx) {
            bad[i].n++;
            bad[j].n++;
          }
        }
      }

      const worst = bad.reduce((a, b) => (b.n > a.n ? b : a), bad[0]);
      if (worst.n === 0) break;
      fields.splice(fields.indexOf(worst.f), 1);
    }

    return fields;
  }

  function findHeaderAnchors(items) {
    const fail = (reason, kept = [], debug = {}) => ({
      success: false,
      reason,
      missing: HEADER_FIELD_ORDER.filter(f => !kept.includes(f)),
      debug
    });

    // 1. 資料區起點
    const dataTop = findDataTop(items);
    if (dataTop === null) {
      return fail("找不到含 3 個以上數字的資料列，無法界定表頭區");
    }

    // 2. 表頭區 → 分欄
    const zone = getHeaderZone(items, dataTop);
    const clusters = clusterByColumn(zone);

    // 3. 每欄各自比對，再依成本由低到高指派欄位（一欄只配一個欄位）
    const options = [];

    clusters.forEach((cluster, ci) => {
      const bestPerField = {};
      for (const r of matchClusterToFields(cluster)) {
        if (!bestPerField[r.field] || r.cost < bestPerField[r.field].cost) {
          bestPerField[r.field] = r;
        }
      }
      Object.values(bestPerField).forEach(r => options.push({ ...r, ci }));
    });

    options.sort((a, b) => a.cost - b.cost);

    const matched = {};
    const usedClusters = new Set();

    for (const opt of options) {
      if (matched[opt.field] || usedClusters.has(opt.ci)) continue;

      const x0 = Math.min(...opt.win.map(l => l.x0));
      const x1 = Math.max(...opt.win.map(l => l.x1));

      matched[opt.field] = {
        cx: (x0 + x1) / 2,
        ci: opt.ci,
        text: opt.win.map(l => l.text).join("|"),
        cost: opt.cost
      };
      usedClusters.add(opt.ci);
    }

    // 4. 順序檢查與數量檢查
    const kept = dropOutOfOrder(matched);

    const debug = {
      dataTop,
      zoneCount: zone.length,
      clusters: clusters.map(c => c.map(l => l.text).join("|")),
      matched: Object.fromEntries(
        kept.map(f => [f, { text: matched[f].text, cx: matched[f].cx }])
      )
    };

    if (kept.length < MIN_HEADER_FIELDS) {
      return fail(
        `只辨識到 ${kept.length} 個欄位（至少需要 ${MIN_HEADER_FIELDS} 個）`,
        kept,
        debug
      );
    }

    // 5. 缺少的欄位用已知欄位內插 / 外推
    const known = kept.map(field => ({
      field,
      index: HEADER_FIELD_ORDER.indexOf(field),
      x: matched[field].cx
    }));

    const spacings = [];
    for (let i = 0; i < known.length - 1; i++) {
      spacings.push(
        (known[i + 1].x - known[i].x) /
          (known[i + 1].index - known[i].index)
      );
    }
    const avgSpacing = median(spacings);

    const centers = {};
    const inferredFields = [];

    HEADER_FIELD_ORDER.forEach((field, index) => {
      if (kept.includes(field)) {
        centers[field] = matched[field].cx;
        return;
      }

      const left = [...known].reverse().find(k => k.index < index);
      const right = known.find(k => k.index > index);

      if (left && right) {
        centers[field] =
          left.x +
          ((right.x - left.x) * (index - left.index)) /
            (right.index - left.index);
      } else if (left) {
        centers[field] = left.x + avgSpacing * (index - left.index);
      } else {
        centers[field] = right.x - avgSpacing * (right.index - index);
      }

      inferredFields.push(field);
    });

    // 6. 表頭下緣：取「被採用的那幾欄」整欄文字的最下緣，
    //    多行表頭的最後一行也算在內。
    const headerY = Math.max(
      ...kept.map(f =>
        Math.max(...clusters[matched[f].ci].map(line => line.y1))
      )
    );

    const sortedFields = HEADER_FIELD_ORDER
      .map(field => ({ field, x: centers[field] }))
      .sort((a, b) => a.x - b.x);

    const boundaries = [];
    for (let i = 0; i < sortedFields.length - 1; i++) {
      boundaries.push((sortedFields[i].x + sortedFields[i + 1].x) / 2);
    }

    return {
      success: true,
      headerY,
      centers,
      sortedFields,
      boundaries,
      complete: inferredFields.length === 0,
      inferredFields,
      debug
    };
  }
  
  const MIN_CONFIDENCE = 0.75;

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, "")
      .replace(/[，,]/g, "")
      .replace(/預算金额/g, "預算金額")
      .replace(/金额/g, "金額")
      .replace(/经费/g, "經費")
      .replace(/申请/g, "申請")
      .replace(/补助/g, "補助")
      .replace(/单价/g, "單價")
      .replace(/数量/g, "數量")
      .replace(/预/g, "預")
      .replace(/费/g, "費")
      .replace(/纪/g, "紀")
      .replace(/录/g, "錄");
  }

  function getBox(item) {
    if (item.bbox) {
      const { x0, y0, x1, y1 } = item.bbox;
      return { x0, y0, x1, y1 };
    }

    if (Array.isArray(item.poly) && item.poly.length) {
      const xs = item.poly.map(point => point[0]);
      const ys = item.poly.map(point => point[1]);

      return {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys)
      };
    }

    return null;
  }

  function normalizeItems(items) {
    return (items || [])
      .map(item => {
        const box = getBox(item);
        if (!box) return null;

        return {
          text: String(item.text || "").trim(),
          confidence: Number(item.confidence ?? item.score ?? 0),
          ...box,
          cx: (box.x0 + box.x1) / 2,
          cy: (box.y0 + box.y1) / 2,
          height: box.y1 - box.y0
        };
      })
      .filter(item => item && item.text);
  }

  function parseNumber(text) {
    const normalized = String(text || "")
      .replace(/[，,]/g, "")
      .replace(/[^\d.-]/g, "");

    if (!normalized || normalized === "-" || normalized === ".") {
      return null;
    }

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function groupNumberRows(items, headerY, ignoreHeaderY = false) {
    const numericItems = items.filter(item => {
      if (!ignoreHeaderY && item.cy <= headerY) return false;

      // 只將純數字或金額文字視為數字欄位候選。
      return /^[\$￥]?\s*[\d,]+(?:\.\d+)?\s*元?$/.test(
        item.text.replace(/\s/g, "")
      );
    });

    const sorted = numericItems.sort((a, b) => a.cy - b.cy);
    const rows = [];

    for (const item of sorted) {
      let row = rows.find(
        candidate => Math.abs(candidate.cy - item.cy) <= 12
      );

      if (!row) {
        row = { cy: item.cy, numbers: [] };
        rows.push(row);
      }

      row.numbers.push(item);
      row.cy =
        row.numbers.reduce((sum, value) => sum + value.cy, 0) /
        row.numbers.length;
    }

    return rows;
  }

  function getColumnForX(x, boundaries, sortedFields) {
    let index = boundaries.findIndex(boundary => x < boundary);

    if (index === -1) {
      index = sortedFields.length - 1;
    }

    return sortedFields[index].field;
  }

  function isKnownItem(itemText) {
    const normalized = normalizeText(itemText);

    return STANDARD_ITEMS.some(name =>
      normalized.includes(normalizeText(name))
    );
  }

  // 取得頁面尺寸
  function getPageDimensions(page, items) {
    return {
      width:
        Number(page.width) ||
        Math.max(...items.map(item => item.x1)),
  
      height:
        Number(page.height) ||
        Math.max(...items.map(item => item.y1))
    };
  }
  
  
  // 將第一頁的表頭位置換算成目前頁面的座標
  function scaleHeaderToPage(header, page, items) {
    const { width, height } = getPageDimensions(page, items);
  
    const scaleX = width / header.referenceWidth;
    const scaleY = height / header.referenceHeight;
  
    const centers = {};
  
    for (const [field, x] of Object.entries(header.centers)) {
      centers[field] = x * scaleX;
    }
  
    const sortedFields = header.sortedFields.map(item => ({
      field: item.field,
      x: item.x * scaleX
    }));
  
    const boundaries = header.boundaries.map(
      boundary => boundary * scaleX
    );
  
    return {
      success: true,
      centers,
      headerY: header.headerY * scaleY,
      sortedFields,
      boundaries,
      complete: header.complete,
      inferredFields: header.inferredFields || []
    };
  }

  // ── 經費項目文字 → 數字列 的分配 ──
  // 依序排列的文字行，依序切成「每個數字列一段」，
  // 讓每一段文字的中心盡量對齊該列數字的中心。
  // 只看順序與中心位置，不依賴行距，也不依賴列高。
  function segmentLinesToRows(lines, rows, bias, emptyCost) {
    const n = lines.length;
    const m = rows.length;

    const prefix = [0];
    lines.forEach(line => prefix.push(prefix[prefix.length - 1] + line.cy));

    const groupCost = (j, a, b) => {
      if (a === b) return emptyCost;
      const center = (prefix[b] - prefix[a]) / (b - a);
      const diff = center - (rows[j].cy + bias);
      return diff * diff;
    };

    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(Infinity));
    const from = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    dp[0][0] = 0;

    for (let j = 1; j <= m; j++) {
      for (let b = 0; b <= n; b++) {
        for (let a = 0; a <= b; a++) {
          if (dp[j - 1][a] === Infinity) continue;
          const cost = dp[j - 1][a] + groupCost(j - 1, a, b);
          if (cost < dp[j][b]) {
            dp[j][b] = cost;
            from[j][b] = a;
          }
        }
      }
    }

    const bounds = new Array(m);
    let end = n;
    for (let j = m; j >= 1; j--) {
      const start = from[j][end];
      bounds[j - 1] = [start, end];
      end = start;
    }
    return bounds;
  }

  function assignItemTextToRows(candidates, numberRows) {
    const groups = numberRows.map(() => []);
    if (!candidates.length || !numberRows.length) return groups;

    const lines = candidates.slice().sort((a, b) => a.cy - b.cy);

    const gaps = numberRows
      .slice(1)
      .map((row, i) => row.cy - numberRows[i].cy);
    const typicalGap = gaps.length ? median(gaps) : 80;
    const emptyCost = Math.pow(typicalGap * 0.35, 2);

    const centerOf = ([a, b]) =>
      lines.slice(a, b).reduce((s, l) => s + l.cy, 0) / (b - a);

    // 第一輪：不修正偏移，估計「文字中心 − 數字中心」的典型偏移
    // （數字通常比多行文字的中心略高，這個偏移每份掃描檔都略有不同）
    const first = segmentLinesToRows(lines, numberRows, 0, emptyCost);
    const offsets = first
      .map((range, j) =>
        range[0] === range[1] ? null : centerOf(range) - numberRows[j].cy
      )
      .filter(v => v !== null);
    const bias = median(offsets);

    // 第二輪：扣除偏移後重新分配
    const bounds = segmentLinesToRows(lines, numberRows, bias, emptyCost);

    bounds.forEach((range, j) => {
      if (range[0] === range[1]) return;

      // 中心離數字列太遠，代表這段文字不可信，寧可留空讓使用者確認
      const shift = Math.abs(centerOf(range) - (numberRows[j].cy + bias));
      if (shift > typicalGap * 0.6) return;

      groups[j] = lines.slice(range[0], range[1]);
    });

    return groups;
  }
  
  function parsePage(page, options = {}) {
    const items = normalizeItems(page.items || []);
  
    if (!items.length) {
      return {
        success: false,
        message: "這一頁沒有可供解析的 OCR 文字。",
        rows: []
      };
    }
  
    // 優先使用外部提供的表頭資訊；
    // 沒有提供時，才自行尋找表頭。
    const header = options.header
      ? options.header
      : findHeaderAnchors(items);

    if (!header.success) {
      return {
        success: false,
        message: "無法完整辨識經費表表頭，暫不解析金額欄位。",
        missingHeaders: header.missing,
        rows: []
      };
    }

    //const numberRows = groupNumberRows(items, header.headerY);
    // 找出經費表下方的總經費區域
    const summaryItems = items.filter(item =>
      /活動總經費/.test(normalizeText(item.text))
    );
    
    const summaryY = summaryItems.length
      ? Math.min(...summaryItems.map(item => item.cy))
      : Infinity;
    
    // 只保留總經費區域之前的明細數字列
    const numberRows = groupNumberRows(
      items,
      header.headerY,
      options.ignoreHeaderY === true
    ).filter(row => row.cy < summaryY);
    
    if (!numberRows.length) {
      return {
        success: false,
        message: "找不到表頭下方的經費數字資料。",
        rows: []
      };
    }

    // 推估經費項目與單位欄的分界
    const possibleItemTexts = items.filter(item =>
      (options.ignoreHeaderY === true || item.cy > header.headerY) &&
      item.cx < header.centers.unitPrice &&
      !/^[\d,.$￥]+$/.test(item.text.replace(/\s/g, ""))
    );
    
    const xPositions = [
      ...new Set(possibleItemTexts.map(item => Math.round(item.cx)))
    ].sort((a, b) => a - b);
    
    let itemBoundary = header.centers.unitPrice;
    let largestGap = 0;
    
    for (let i = 0; i < xPositions.length - 1; i++) {
      const gap = xPositions[i + 1] - xPositions[i];
    
      if (gap > largestGap) {
        largestGap = gap;
        itemBoundary = (xPositions[i] + xPositions[i + 1]) / 2;
      }
    }
    
    const itemTextCandidates = items
      .filter(item =>
        item.cx < itemBoundary &&
        (options.ignoreHeaderY === true || item.cy > header.headerY) &&
        item.cy < summaryY &&
        !/^[\d,.$￥]+$/.test(item.text.replace(/\s/g, ""))
      )
      .sort((a, b) => a.cy - b.cy);
    
    // 依「順序＋中心對齊」把文字分配給各數字列
    const itemTextGroups = assignItemTextToRows(itemTextCandidates, numberRows);
   
    const rows = numberRows.map((numberRow, index) => {
      const values = {
        unitPrice: "",
        quantity: "",
        budget: "",
        grant: "",
        agency: "",
        self: "",
        other: ""
      };

      const fieldConfidence = {};
      const usedNumbers = new Set();

      for (const numberItem of numberRow.numbers) {
        const field = getColumnForX(
          numberItem.cx,
          header.boundaries,
          header.sortedFields
        );

        const value = parseNumber(numberItem.text);

        if (value === null) continue;

        // 同一欄位若出現多個數字，先保留辨識信心較高者。
        if (
          !usedNumbers.has(field) ||
          numberItem.confidence > fieldConfidence[field]
        ) {
          values[field] = value;
          fieldConfidence[field] = numberItem.confidence;
          usedNumbers.add(field);
        }
      }

      // 經費項目通常位於單價欄左側；合併同一列的文字片段。
      const itemParts = itemTextGroups[index]
        .sort((a, b) => {
          if (Math.abs(a.cy - b.cy) > 4) {
            return a.cy - b.cy;
          }
          return a.cx - b.cx;
        });
      
      const itemText = itemParts
        .map(item => item.text)
        .join("")
        .replace(/\s+/g, "")
        .trim();

      const needsClassification =
        !itemText || !isKnownItem(itemText);

      const missingFields = Object.keys(values).filter(
        field => values[field] === ""
      );

      const lowConfidenceFields = Object.keys(fieldConfidence).filter(
        field => fieldConfidence[field] < MIN_CONFIDENCE
      );

      const itemConfidence = itemParts.length
        ? itemParts.reduce(
            (sum, item) => sum + item.confidence,
            0
          ) / itemParts.length
        : 0;

      const needsReview =
        missingFields.length > 0 ||
        lowConfidenceFields.length > 0 ||
        itemConfidence < MIN_CONFIDENCE ||
        needsClassification;

      return {
        item: itemText,
        unitPrice: values.unitPrice,
        quantity: values.quantity,
        budget: values.budget,
        grant: values.grant,
        agency: values.agency,
        self: values.self,
        other: values.other,

        needsReview,
        needsClassification,
        originalItem: itemText,

        reviewInfo: {
          missingFields,
          lowConfidenceFields,
          itemConfidence
        }
      };
    });

    return {
      success: true,
      rows,
      header: {
        centers: header.centers,
        headerY: header.headerY,
        boundaries: header.boundaries,
        sortedFields: header.sortedFields,
        complete: header.complete,
        inferredFields: header.inferredFields || [],
    
        // 保留建立表頭時的頁面尺寸，
        // 供後續頁面換算欄位位置使用。
        referenceWidth: Number(page.width) || Math.max(...items.map(item => item.x1)),
        referenceHeight: Number(page.height) || Math.max(...items.map(item => item.y1))
      },
      message: `解析完成，共取得 ${rows.length} 筆候選經費資料。`
    };
  }

  // 解析整份文件（支援多頁 PDF）
  function parseDocument(documentData) {
    const pages = documentData?.pages || [];

    if (!pages.length) {
      return {
        success: false,
        rows: [],
        pageResults: [],
        message: "文件中沒有可供解析的頁面。"
      };
    }

    const allRows = [];
    const pageResults = [];

    // 最近一次成功使用的表頭（欄位位置會換算到後續頁面）
    let sharedHeader = null;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNumber = page.pageNumber || i + 1;
      const items = normalizeItems(page.items || []);

      if (!items.length) {
        pageResults.push({
          pageNumber,
          success: false,
          rowCount: 0,
          message: "這一頁沒有可供解析的 OCR 文字。"
        });
        continue;
      }

      const detected = findHeaderAnchors(items);

      let headerToUse;
      let headerSource;
      let ignoreHeaderY = false; // 每一頁各自決定，不會殘留到下一頁

      if (detected.success && (detected.complete || !sharedHeader)) {
        // 本頁有可用表頭（完整，或目前沒有更好的可用）
        const { width, height } = getPageDimensions(page, items);
        headerToUse = {
          ...detected,
          referenceWidth: width,
          referenceHeight: height
        };
        headerSource = detected.complete ? "own" : "own-inferred";

      } else if (sharedHeader) {
        const scaled = scaleHeaderToPage(sharedHeader, page, items);

        if (detected.success) {
          // 本頁表頭不完整：欄位位置沿用前頁，表頭下緣用本頁的
          headerToUse = { ...scaled, headerY: detected.headerY };
          headerSource = "shared-columns";
        } else {
          // 沒有表頭（一般的續頁）：整頁都是資料區
          headerToUse = scaled;
          headerSource = "inherited";
          ignoreHeaderY = true;
        }

      } else {
        pageResults.push({
          pageNumber,
          success: false,
          rowCount: 0,
          message: "尚未找到可供參考的完整經費表表頭。",
          reason: detected.reason,
          missingHeaders: detected.missing,
          debug: detected.debug
        });
        continue;
      }

      const parsed = parsePage(page, { header: headerToUse, ignoreHeaderY });

      if (!parsed.success) {
        pageResults.push({
          pageNumber,
          success: false,
          rowCount: 0,
          message: parsed.message,
          missingHeaders: parsed.missingHeaders || []
        });
        continue;
      }

      sharedHeader = parsed.header;

      const pageRows = parsed.rows.map(row => ({
        ...row,
        sourceFile: documentData.fileName || "",
        sourcePage: pageNumber
      }));

      allRows.push(...pageRows);

      pageResults.push({
        pageNumber,
        success: true,
        rowCount: pageRows.length,
        headerSource,
        inferredFields: headerToUse.inferredFields || [],
        message: parsed.message
      });
    }

    const success = allRows.length > 0;

    return {
      success,
      fileName: documentData.fileName || "",
      totalPages: pages.length,
      rows: allRows,
      pageResults,
      message: success
        ? `文件解析完成，共取得 ${allRows.length} 筆候選經費資料。`
        : "文件解析失敗，沒有取得任何經費資料。"
    };
  }
  window.ExpenseOCRParser = {
    parsePage,
    parseDocument,
    debugHeader: page => findHeaderAnchors(normalizeItems(page.items || []))
  };
})();
