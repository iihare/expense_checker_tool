
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
      .replace(/金额/g, "金額")
      .replace(/经费/g, "經費")
      .replace(/申请/g, "申請")
      .replace(/补助/g, "補助")
      .replace(/单价/g, "單價")
      .replace(/数量/g, "數量")
      .replace(/预/g, "預")
      .replace(/费/g, "費")
      .replace(/纪/g, "費")
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

  function findHeaderAnchors(items) {
    const candidates = {};
  
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      candidates[field] = items.filter(item => {
        const text = normalizeText(item.text);
  
        return aliases.some(alias =>
          text.includes(normalizeText(alias))
        );
      });
    }
  
    // 本要點欄位只採用包含「本要點」的文字，
    // 避免和其他補助欄位混淆。
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
  
    // 找出最可能的表頭高度。
    // 每個候選位置都作為一次參考，統計附近能對應到幾個欄位。
    const HEADER_TOLERANCE = 35;
  
    const possibleYs = requiredFields.flatMap(field =>
      candidates[field].map(item => item.cy)
    );
  
    let bestHeader = null;
  
    for (const y of possibleYs) {
      const matched = {};
      let matchedCount = 0;
      let totalDistance = 0;
  
      for (const field of requiredFields) {
        const nearest = candidates[field]
          .slice()
          .sort(
            (a, b) =>
              Math.abs(a.cy - y) - Math.abs(b.cy - y)
          )[0];
  
        const distance = Math.abs(nearest.cy - y);
  
        if (distance <= HEADER_TOLERANCE) {
          matched[field] = nearest;
          matchedCount++;
          totalDistance += distance;
        }
      }
  
      // 優先選擇能辨識最多欄位的高度；
      // 欄位數相同時，選擇垂直距離總和較小者。
      if (
        !bestHeader ||
        matchedCount > bestHeader.matchedCount ||
        (
          matchedCount === bestHeader.matchedCount &&
          totalDistance < bestHeader.totalDistance
        )
      ) {
        bestHeader = {
          matched,
          matchedCount,
          totalDistance
        };
      }
    }
  
    // 必須找到全部七個欄位，才接受這個表頭。
    if (
      !bestHeader ||
      bestHeader.matchedCount !== requiredFields.length
    ) {
      return {
        success: false,
        missing: requiredFields.filter(
          field => !bestHeader?.matched[field]
        ),
        candidates
      };
    }
  
    const centers = {};
    const headerItems = [];
  
    for (const field of requiredFields) {
      const nearest = bestHeader.matched[field];
  
      centers[field] = nearest.cx;
      headerItems.push(nearest);
    }
  
    // 使用七個欄位代表文字的平均高度。
    const headerY =
      headerItems.reduce((sum, item) => sum + item.cy, 0) /
      headerItems.length;
  
    // 所有欄位中心依 X 座標排序，
    // 取相鄰欄位中點作為欄位邊界。
    const sortedFields = requiredFields
      .map(field => ({
        field,
        x: centers[field]
      }))
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
      boundaries
    };
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
    //暫時加入由此開始
    console.log("經費文字區塊診斷：");

    numberRows.forEach((numberRow, index) => {
      const nearbyItems = items
        .filter(item =>
          item.cx < header.centers.unitPrice &&
          Math.abs(item.cy - numberRow.cy) <= 120
        )
        .sort((a, b) => a.cy - b.cy);
    
      console.log(`第 ${index + 1} 筆數字列，Y=${numberRow.cy}`);
    
      console.table(
        nearbyItems.map(item => ({
          text: item.text,
          x: Math.round(item.cx),
          y: Math.round(item.cy),
          height: Math.round(item.height),
          confidence: item.confidence
        }))
      );
    }); //暫時加入到此為止

    // 將經費項目文字依照垂直位置分組
    const itemTextGroups = numberRows.map(() => []);
    
    const itemTextCandidates = items
      .filter(item =>
        item.cx < itemBoundary &&
        (options.ignoreHeaderY === true || item.cy > header.headerY) &&
        item.cy < summaryY &&
        !/^[\d,.$￥]+$/.test(item.text.replace(/\s/g, ""))
      )
      .sort((a, b) => a.cy - b.cy);

    // 計算相鄰數字列的最小垂直間距
    const rowGaps = numberRows
      .slice(1)
      .map((row, index) =>
        row.cy - numberRows[index].cy
      );
    
    const minRowGap = rowGaps.length
      ? Math.min(...rowGaps)
      : 84;
    
    // 依照數字列間距動態決定文字分組距離
    const maxTextGap = Math.min(40, minRowGap * 0.48);
    
    console.log("文字分組最大距離：", maxTextGap);
    
    // 將垂直距離接近的文字視為同一個文字區塊
    const textBlocks = [];
    
    for (const item of itemTextCandidates) {
      let block = textBlocks.find(candidate => {
        const lastItem = candidate[candidate.length - 1];
        return Math.abs(item.cy - lastItem.cy) <= maxTextGap;
      });
    
      if (!block) {
        block = [];
        textBlocks.push(block);
      }
    
      block.push(item);
    }
    
    // 將每個文字區塊分配給中心位置最接近的數字列
    for (const block of textBlocks) {
      const blockCenter =
        block.reduce((sum, item) => sum + item.cy, 0) / block.length;
    
      let nearestIndex = -1;
      let nearestDistance = Infinity;
    
      numberRows.forEach((numberRow, index) => {
        const distance = Math.abs(blockCenter - numberRow.cy);
    
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
    
      // 避免表頭或其他無關文字被分配到經費項目
      if (nearestIndex !== -1 && nearestDistance <= 80) {
        itemTextGroups[nearestIndex].push(...block);
      }
    }
   
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
  
    // 保存最近一次成功辨識的表頭資訊
    let sharedHeader = null;
    let isContinuationPage = false;
  
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNumber = page.pageNumber || i + 1;
  
      const items = normalizeItems(page.items || []);
  
      // 沒有 OCR 文字，記錄失敗並繼續下一頁
      if (!items.length) {
        pageResults.push({
          pageNumber,
          success: false,
          rowCount: 0,
          message: "這一頁沒有可供解析的 OCR 文字。"
        });
  
        continue;
      }
  
      // 優先檢查目前頁面是否有自己的完整表頭
      const detectedHeader = findHeaderAnchors(items);
  
      let headerToUse;
  
      if (detectedHeader.success) {
        // 有完整表頭時，使用目前頁面的表頭
        const dimensions = getPageDimensions(page, items);
  
        headerToUse = {
          ...detectedHeader,
          referenceWidth: dimensions.width,
          referenceHeight: dimensions.height
        };
  
        // 更新共用表頭
        sharedHeader = headerToUse;
  
      } else if (sharedHeader) {
        // 沒有表頭時，沿用上一個有效表頭
        headerToUse = scaleHeaderToPage(
          sharedHeader,
          page,
          items
        );
      
        isContinuationPage = true;
  
      } else {
        // 尚未找到任何有效表頭
        pageResults.push({
          pageNumber,
          success: false,
          rowCount: 0,
          message: "尚未找到可供參考的完整經費表表頭。",
          missingHeaders: detectedHeader.missing
        });
  
        continue;
      }
  
      // 使用目前頁面的表頭資訊解析明細
      const parsed = parsePage(page, {
        header: headerToUse,
        ignoreHeaderY: isContinuationPage
      });
  
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
  
      // 更新共用表頭，確保後續頁面以最新頁面尺寸為基準
      sharedHeader = parsed.header;
  
      // 合併該頁的經費資料
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
    parseDocument
  };
})();
