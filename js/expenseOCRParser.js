
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
    budget: ["預算金額"],
    grant: ["本要點", "本要點補助"],
    agency: ["他機關補助", "他機關"],
    self: ["自付經費", "自付"],
    other: ["其他"]
  };

  const MIN_CONFIDENCE = 0.75;

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, "")
      .replace(/[，,]/g, "")
      .replace(/預算金额/g, "預算金額")
      .replace(/预/g, "預")
      .replace(/金额/g, "金額")
      .replace(/经费/g, "經費")
      .replace(/申请/g, "申請")
      .replace(/补助/g, "補助")
      .replace(/单价/g, "單價")
      .replace(/数量/g, "數量");
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

  function findHeaderAnchors(items) {
    const candidates = {};

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      candidates[field] = items.filter(item => {
        const text = normalizeText(item.text);
        return aliases.some(alias => text.includes(normalizeText(alias)));
      });
    }

    // 優先使用「本要點」辨識補助欄，避免和他機關補助混淆。
    candidates.grant = items.filter(item =>
      normalizeText(item.text).includes("本要點")
    );

    const requiredFields = [
      "unitPrice",
      "quantity",
      "budget",
      "grant",
      "agency",
      "self",
      "other"
    ];

    const missing = requiredFields.filter(
      field => !candidates[field].length
    );

    if (missing.length) {
      return {
        success: false,
        missing,
        candidates
      };
    }

    const headerItems = requiredFields.flatMap(
      field => candidates[field]
    );

    const headerY =
      headerItems.reduce((sum, item) => sum + item.cy, 0) /
      headerItems.length;

    const centers = {};

    for (const field of requiredFields) {
      const nearest = candidates[field]
        .slice()
        .sort(
          (a, b) =>
            Math.abs(a.cy - headerY) - Math.abs(b.cy - headerY)
        )[0];

      centers[field] = nearest.cx;
    }

    // 所有欄位中心依 X 座標排序，取相鄰欄位中點作為欄位邊界。
    const sortedFields = requiredFields
      .map(field => ({ field, x: centers[field] }))
      .sort((a, b) => a.x - b.x);

    const boundaries = [];

    for (let i = 0; i < sortedFields.length - 1; i++) {
      boundaries.push(
        (sortedFields[i].x + sortedFields[i + 1].x) / 2
      );
    }

    return {
      success: true,
      headerY,
      centers,
      sortedFields,
      boundaries
    };
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

  function groupNumberRows(items, headerY) {
    const numericItems = items.filter(item => {
      if (item.cy <= headerY) return false;

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

  function parsePage(page, options = {}) {
    const items = normalizeItems(page.items || []);

    if (!items.length) {
      return {
        success: false,
        message: "這一頁沒有可供解析的 OCR 文字。",
        rows: []
      };
    }

    const header = findHeaderAnchors(items);

    if (!header.success) {
      return {
        success: false,
        message: "無法完整辨識經費表表頭，暫不解析金額欄位。",
        missingHeaders: header.missing,
        rows: []
      };
    }

    const numberRows = groupNumberRows(items, header.headerY);

    if (!numberRows.length) {
      return {
        success: false,
        message: "找不到表頭下方的經費數字資料。",
        rows: []
      };
    }

    // 推估經費項目與單位欄的分界
    const possibleItemTexts = items.filter(item =>
      item.cy > header.headerY &&
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

    const rows = numberRows.map(numberRow => {
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
      const itemParts = items
        .filter(item =>
          item.cx < itemBoundary &&
          Math.abs(item.cy - numberRow.cy) <= 32
        )
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
        headerY: header.headerY
      },
      message: `解析完成，共取得 ${rows.length} 筆候選經費資料。`
    };
  }

  window.ExpenseOCRParser = {
    parsePage
  };
})();
