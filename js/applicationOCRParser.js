/**
 * ApplicationOCRParser.js
 *
 * 申請書 OCR 解析器
 *
 * 主要解析方式：
 * 1. 優先使用 OCR item 的 poly 座標判斷欄位位置。
 * 2. 依照標籤與內容的相對位置擷取文字及金額。
 * 3. 沒有座標資料時，使用文字解析作為備援。
 */

(function (global) {
  "use strict";


  // ==========================================
  // 1. 基本設定
  // ==========================================

  const FIELD_LABELS = {
    unitName: "單位名稱",
    qualification: "資格",
    leader: "負責人",
    registeredAddress: "登記地址",
    mailingAddress: "通訊地址",
    totalBudget: "總經費",
    guidelineGrant: "本要點補助金額",
    selfFund: "自付經費",
    otherAgency: "其他機關補助",
    expectedFee: "預計收費",
    otherAmount: "其他金額"
  };

  const TEXT_FIELDS = [
    "unitName",
    "leader",
    "registeredAddress",
    "mailingAddress"
  ];

  const AMOUNT_FIELDS = [
    "totalBudget",
    "guidelineGrant",
    "selfFund",
    "otherAgency",
    "expectedFee",
    "otherAmount"
  ];


  // ==========================================
  // 2. 基本文字處理
  // ==========================================

  function normalizeText(text) {
    return String(text ?? "")
      .replace(/\u3000/g, " ")
      .replace(/[：﹕]/g, ":")
      .replace(/[，]/g, ",")
      .replace(/[０-９]/g, char =>
        String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
      )
      .replace(/\r\n?/g, "\n")
      .trim();
  }


  function normalizeLabel(text) {
    return normalizeText(text)
      .replace(/\s/g, "")
      .replace(/[：:、，,。；;]/g, "");
  }


  function cleanValue(text) {
    return normalizeText(text)
      .replace(/^[\s:：、，。；;]+/, "")
      .replace(/[\s:：]+$/, "")
      .trim();
  }


  function cleanFieldValue(text) {
    return cleanValue(text)
      // 移除欄位後方的填寫提示
      .replace(/[（(].*$/, "")
      .trim();
  }


  function isEmpty(value) {
    return value === null ||
      value === undefined ||
      String(value).trim() === "";
  }


  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }


  // ==========================================
  // 3. OCR 座標整理
  // ==========================================

  /**
   * 從 OCR item 取得文字。
   */
  function getItemText(item) {
    if (typeof item === "string") {
      return item;
    }

    if (!item || typeof item !== "object") {
      return "";
    }

    return String(
      item.text ??
      item.str ??
      item.value ??
      item.content ??
      ""
    );
  }


  /**
   * 取得 OCR item 的座標範圍。
   *
   * PaddleOCR:
   * item.poly = [
   *   [x1, y1],
   *   [x2, y2],
   *   [x3, y3],
   *   [x4, y4]
   * ]
   */
  function getItemBounds(item) {

    // PaddleOCR polygon
    if (
      Array.isArray(item?.poly) &&
      item.poly.length > 0
    ) {
      const points = item.poly.filter(
        point =>
          Array.isArray(point) &&
          point.length >= 2
      );

      if (points.length > 0) {
        const xs = points.map(point => Number(point[0]));
        const ys = points.map(point => Number(point[1]));

        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);

        return {
          left,
          right,
          top,
          bottom,
          x: (left + right) / 2,
          y: (top + bottom) / 2,
          width: right - left,
          height: bottom - top
        };
      }
    }


    // 其他可能的座標格式
    const box = item?.bbox || item?.boundingBox || {};

    const transform = item?.transform;

    const x =
      item?.x ??
      box.x ??
      box.left ??
      (Array.isArray(transform) ? transform[4] : null);

    const y =
      item?.y ??
      box.y ??
      box.top ??
      (Array.isArray(transform) ? transform[5] : null);

    if (x === null || y === null) {
      return null;
    }

    const width = Number(item?.width ?? box.width ?? 0);
    const height = Number(item?.height ?? box.height ?? 0);

    return {
      left: Number(x),
      right: Number(x) + width,
      top: Number(y),
      bottom: Number(y) + height,
      x: Number(x) + width / 2,
      y: Number(y) + height / 2,
      width,
      height
    };
  }


  /**
   * 將單頁 OCR items 整理成統一格式。
   */
  function getPositionedItems(page) {

    if (!page || typeof page !== "object") {
      return [];
    }

    const sources = [
      page.items,
      page.words,
      page.textItems
    ];

    let source = sources.find(
      items =>
        Array.isArray(items) &&
        items.length > 0
    );

    if (!source) {
      return [];
    }

    return source
      .map((item, index) => {
        const bounds = getItemBounds(item);

        return {
          text: cleanValue(getItemText(item)),
          normalizedText: normalizeLabel(getItemText(item)),
          index,
          bounds
        };
      })
      .filter(item =>
        !isEmpty(item.text) &&
        item.bounds !== null
      );
  }


  /**
   * 依文字內容尋找 OCR item。
   */
  function findItem(items, predicate) {
    return items.find(item =>
      predicate(item.normalizedText, item.text)
    ) || null;
  }


  /**
   * 尋找符合文字條件的所有 OCR items。
   */
  function findItems(items, predicate) {
    return items.filter(item =>
      predicate(item.normalizedText, item.text)
    );
  }


  // ==========================================
  // 4. 第一頁文字欄位解析
  // ==========================================

  /**
   * 取得標籤右側、同一行的文字。
   *
   * 例如：
   * 申請單位全銜 → 國立青年局大學合唱團
   */
  function findRightText(
    items,
    labelItem,
    options = {}
  ) {

    if (!labelItem) {
      return "";
    }

    const maxYDistance = options.maxYDistance ?? 22;
    const maxXDistance = options.maxXDistance ?? 1000;

    const candidates = items
      .filter(item => {

        if (item.index === labelItem.index) {
          return false;
        }

        const dx =
          item.bounds.left - labelItem.bounds.right;

        const dy =
          Math.abs(item.bounds.y - labelItem.bounds.y);

        return (
          dx > 0 &&
          dx <= maxXDistance &&
          dy <= maxYDistance
        );
      })
      .sort((a, b) => {

        const distanceA =
          Math.abs(a.bounds.y - labelItem.bounds.y) * 5 +
          (a.bounds.left - labelItem.bounds.right);

        const distanceB =
          Math.abs(b.bounds.y - labelItem.bounds.y) * 5 +
          (b.bounds.left - labelItem.bounds.right);

        return distanceA - distanceB;
      });

    if (candidates.length === 0) {
      return "";
    }

    return cleanFieldValue(candidates[0].text);
  }


  /**
   * 取得單位名稱。
   */
  function extractUnitName(items) {

    const label = findItem(
      items,
      text =>
        text === "申請單位全銜" ||
        text === "單位全銜"
    );

    return findRightText(items, label);
  }


  /**
   * 取得單位負責人姓名。
   *
   * 特別限制在「單位負責人」附近，
   * 避免誤抓到下方「聯絡人」的姓名。
   */
  function extractLeader(items) {

    const leaderLabel = findItem(
      items,
      text => text.includes("單位負責人")
    );

    if (!leaderLabel) {
      return "";
    }

    const nameLabel = items
      .filter(item => {

        return (
          item.normalizedText === "姓名" &&
          Math.abs(
            item.bounds.y - leaderLabel.bounds.y
          ) <= 80
        );
      })
      .sort((a, b) => {

        return (
          Math.abs(a.bounds.y - leaderLabel.bounds.y) -
          Math.abs(b.bounds.y - leaderLabel.bounds.y)
        );
      })[0];

    if (!nameLabel) {
      return "";
    }

    return findRightText(items, nameLabel);
  }


  /**
   * 取得地址。
   */
  function extractAddress(items, labelText) {

    const label = findItem(
      items,
      text => text === labelText
    );

    return findRightText(items, label);
  }


  // ==========================================
  // 5. 第二頁金額解析
  // ==========================================

  /**
   * 將 OCR 文字轉換成金額。
   */
  function parseAmount(value) {
    if (isEmpty(value)) {
      return null;
    }
  
    const text = normalizeText(value)
      .replace(/[,，]/g, "")
      .replace(/[＄$]/g, "")
      .replace(/新臺幣|新台幣|NTD|NT\$|元|圓/gi, "")
      .replace(/\s/g, "");
  
    // 從文字中擷取金額，不要求整段文字都是數字。
    const match = text.match(/-?\d+(?:\.\d+)?/);
  
    if (!match) {
      return null;
    }
  
    const amount = Number(match[0]);
  
    return Number.isFinite(amount) ? amount : null;
  }


  /**
   * 取得 OCR item 是否為金額。
   */
  function isAmountItem(item) {
  
    const text = normalizeText(item.text);
  
    // 純數字，或包含「元／圓」的金額文字。
    const isPlainAmount =
      /^-?[\d,]+(?:\.\d+)?$/.test(text);
  
    const hasCurrencyUnit =
      /元|圓/.test(text) &&
      /-?\d[\d,]*(?:\.\d+)?/.test(text);
  
    return isPlainAmount || hasCurrencyUnit;
  }


  /**
   * 依標籤位置尋找右側附近的金額。
   *
   * 不依賴 OCR items 的原始排列順序。
   */
  function findAmountNearLabel(
    items,
    labelItem,
    options = {}
  ) {

    if (!labelItem) {
      return null;
    }

    const maxXDistance = options.maxXDistance ?? 400;
    const maxYDistance = options.maxYDistance ?? 65;

    const candidates = items
      .filter(item => {

        if (!isAmountItem(item)) {
          return false;
        }

        const dx =
          item.bounds.x - labelItem.bounds.x;

        const dy =
          Math.abs(item.bounds.y - labelItem.bounds.y);

        return (
          dx > 0 &&
          dx <= maxXDistance &&
          dy <= maxYDistance
        );
      })
      .sort((a, b) => {

        const scoreA =
          Math.abs(a.bounds.y - labelItem.bounds.y) * 2 +
          Math.abs(a.bounds.x - labelItem.bounds.x) * 0.1;

        const scoreB =
          Math.abs(b.bounds.y - labelItem.bounds.y) * 2 +
          Math.abs(b.bounds.x - labelItem.bounds.x) * 0.1;

        return scoreA - scoreB;
      });

    if (candidates.length === 0) {
      return null;
    }

    return parseAmount(candidates[0].text);
  }


  /**
   * 第二頁各欄位金額。
   *
   * 每個欄位使用自己的標籤定位，
   * 避免相鄰欄位的金額互相誤認。
   */
  function extractAmounts(items) {

    const result = {
      totalBudget: null,
      guidelineGrant: null,
      selfFund: null,
      otherAgency: null,
      expectedFee: null,
      otherAmount: null
    };


    // 計畫總經費
    const totalBudgetLabel = findItem(
      items,
      text => text === "計畫總經費"
    );

    result.totalBudget = findAmountNearLabel(
      items,
      totalBudgetLabel
    );


    // 自付經費
    const selfFundLabel = findItem(
      items,
      text => text === "自付經費"
    );

    result.selfFund = findAmountNearLabel(
      items,
      selfFundLabel
    );


    // 其他政府機關補助經費
    // 此標籤在 OCR 中可能被拆成兩行，
    // 因此使用第一行作為定位依據。
    const otherAgencyLabel = findItem(
      items,
      text =>
        text.includes("申請") &&
        text.includes("其他政府機")
    );

    result.otherAgency = findAmountNearLabel(
      items,
      otherAgencyLabel,
      {
        maxXDistance: 400,
        maxYDistance: 65
      }
    );


    // 本要點補助經費
    const guidelineGrantLabel = findItem(
      items,
      text =>
        text.includes("申請") &&
        text.includes("本要點")
    );

    result.guidelineGrant = findAmountNearLabel(
      items,
      guidelineGrantLabel
    );


    // 預計收費金額
    const expectedFeeLabel = findItem(
      items,
      text => text === "預計收費金額"
    );

    result.expectedFee = findAmountNearLabel(
      items,
      expectedFeeLabel,
      {
        maxXDistance: 400,
        maxYDistance: 65
      }
    );


    // 其他
    // 使用右側金額區域的「其他」標籤，
    // 不使用全文搜尋，以免誤認其他機關補助。
    const otherAmountLabel = findItem(
      items,
      text => text === "其他"
    );

    result.otherAmount = findAmountNearLabel(
      items,
      otherAmountLabel
    );


    return result;
  }


  // ==========================================
  // 6. 文字解析備援
  // ==========================================

  /**
   * 當 OCR 沒有提供座標資料時，
   * 才使用文字內容進行簡單解析。
   *
   * 注意：
   * 文字備援不保證能正確處理多欄表格。
   */
  function collectPageText(page) {

    if (!page || typeof page !== "object") {
      return "";
    }

    if (!isEmpty(page.text)) {
      return normalizeText(page.text);
    }

    const source =
      page.items ||
      page.words ||
      page.textItems ||
      [];

    if (!Array.isArray(source)) {
      return "";
    }

    return source
      .map(getItemText)
      .filter(text => !isEmpty(text))
      .join("\n");
  }


  function findTextValue(text, aliases) {

    const lines = normalizeText(text)
      .split("\n")
      .map(cleanValue);

    for (const alias of aliases) {

      const escaped = escapeRegExp(alias);

      const regex = new RegExp(
        "^\\s*" + escaped +
        "\\s*[:：、]?\\s*(.*)$"
      );

      for (let i = 0; i < lines.length; i++) {

        const match = lines[i].match(regex);

        if (!match) {
          continue;
        }

        if (!isEmpty(match[1])) {
          return cleanFieldValue(match[1]);
        }

        if (
          lines[i + 1] &&
          !isEmpty(lines[i + 1])
        ) {
          return cleanFieldValue(lines[i + 1]);
        }
      }
    }

    return "";
  }


  function findTextAmount(text, aliases) {

    const value = findTextValue(text, aliases);

    return parseAmount(value);
  }


  function extractTextFallback(pages) {

    const page1 = collectPageText(pages[0]);
    const page2 = collectPageText(pages[1] || {});

    return {
      unitName: findTextValue(page1, [
        "申請單位全銜",
        "單位全銜"
      ]),

      leader: "",

      registeredAddress: findTextValue(page1, [
        "登記地址"
      ]),

      mailingAddress: findTextValue(page1, [
        "通訊地址"
      ]),

      totalBudget: findTextAmount(page2, [
        "計畫總經費"
      ]),

      guidelineGrant: findTextAmount(page2, [
        "申請本要點補助經費",
        "申請本要點補助金額"
      ]),

      selfFund: findTextAmount(page2, [
        "自付經費"
      ]),

      otherAgency: findTextAmount(page2, [
        "其他政府機關補助經費"
      ]),

      expectedFee: null,

      otherAmount: null
    };
  }


  // ==========================================
  // 7. 複核資訊
  // ==========================================

  function buildReviewItem(field, reason) {
    return {
      field,
      label: FIELD_LABELS[field],
      reason
    };
  }


  // ==========================================
  // 8. 主要解析流程
  // ==========================================

  function parseDocument(document) {

    // ---------- 驗證輸入 ----------

    if (!document || typeof document !== "object") {
      throw new Error(
        "ApplicationOCRParser：document 格式錯誤。"
      );
    }

    if (!Array.isArray(document.pages)) {
      throw new Error(
        "ApplicationOCRParser：找不到 pages 陣列。"
      );
    }

    if (document.pages.length === 0) {
      throw new Error(
        "ApplicationOCRParser：文件沒有可解析的頁面。"
      );
    }


    // ---------- 初始化結果 ----------

    const result = {
      unitName: "",
      qualification: "",
      leader: "",
      registeredAddress: "",
      mailingAddress: "",

      totalBudget: null,
      guidelineGrant: null,
      selfFund: null,
      otherAgency: null,
      expectedFee: null,
      otherAmount: null,

      needsReview: [],

      fileName: document.fileName || ""
    };


    // ---------- 取得各頁座標資料 ----------

    const page1Items = getPositionedItems(
      document.pages[0]
    );

    const page2Items = getPositionedItems(
      document.pages[1] || {}
    );


    // ---------- 第一頁文字欄位 ----------

    if (page1Items.length > 0) {

      result.unitName = extractUnitName(
        page1Items
      );

      result.leader = extractLeader(
        page1Items
      );

      result.registeredAddress = extractAddress(
        page1Items,
        "登記地址"
      );

      result.mailingAddress = extractAddress(
        page1Items,
        "通訊地址"
      );

    } else {

      // 沒有座標資料時使用文字備援。
      const fallback = extractTextFallback(
        document.pages
      );

      result.unitName = fallback.unitName;
      result.leader = fallback.leader;
      result.registeredAddress = fallback.registeredAddress;
      result.mailingAddress = fallback.mailingAddress;
    }


    // ---------- 第二頁金額欄位 ----------

    if (page2Items.length > 0) {

      const amounts = extractAmounts(
        page2Items
      );

      Object.assign(result, amounts);

    } else {

      const fallback = extractTextFallback(
        document.pages
      );

      AMOUNT_FIELDS.forEach(field => {
        result[field] = fallback[field];
      });
    }


    // ---------- 資格欄位 ----------

    // 目前 OCR 無法可靠判斷勾選狀態。
    // 不依照選項文字是否出現來猜測。
    result.qualification = "";


    // ======================================
    // 9. 建立待複核清單
    // ======================================

    TEXT_FIELDS.forEach(field => {

      if (isEmpty(result[field])) {

        result.needsReview.push(
          buildReviewItem(
            field,
            "未能從 OCR 座標中辨識欄位內容"
          )
        );
      }
    });


    // 資格固定需要人工確認。
    result.needsReview.push(
      buildReviewItem(
        "qualification",
        "無法僅從 OCR 文字確認資格選項的勾選狀態"
      )
    );


    AMOUNT_FIELDS.forEach(field => {

      if (result[field] === null) {

        result.needsReview.push(
          buildReviewItem(
            field,
            "未能依照欄位位置辨識金額，請人工確認"
          )
        );
      }
    });


    // ---------- 回傳 ----------

    return result;
  }


  // ==========================================
  // 10. 對外公開 API
  // ==========================================

  global.ApplicationOCRParser = {
    parseDocument
  };

})(window);
