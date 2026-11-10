/**
 * ApplicationOCRParser.js
 *
 * 申請書 OCR 解析器
 */

(function (global) {
  "use strict";

  const FIELD_ALIASES = {
    unitName: [
      "單位名稱",
      "申請單位名稱",
      "申請單位",
      "機關團體名稱",
      "學校名稱"
    ],

    qualification: [
      "申請單位資格",
      "單位資格",
      "申請資格",
      "資格別",
      "資格"
    ],

    leader: [
      "負責人姓名",
      "負責人",
      "代表人姓名",
      "代表人",
      "理事長姓名",
      "校長姓名"
    ],

    registeredAddress: [
      "登記地址",
      "立案地址",
      "設立地址"
    ],

    mailingAddress: [
      "通訊地址",
      "聯絡地址",
      "郵寄地址"
    ],

    totalBudget: [
      "計畫總經費",
      "計畫總預算",
      "活動總經費",
      "總經費",
      "總預算"
    ],

    guidelineGrant: [
      "申請本要點補助金額",
      "本要點補助金額",
      "本要點補助",
      "申請補助金額",
      "申請補助"
    ],

    selfFund: [
      "自籌經費",
      "自籌款",
      "自付經費",
      "自付金額"
    ],

    otherAgency: [
      "其他機關補助金額",
      "其他單位補助金額",
      "其他機關補助",
      "其他單位補助",
      "其他補助金額",
      "其他補助"
    ],

    expectedFee: [
      "預計收費金額",
      "預計收費",
      "預計收入",
      "收費金額",
      "預計收取金額"
    ],

    otherAmount: [
      "其他用途金額",
      "其他經費金額",
      "其他經費",
      "其他金額",
      "其他用途",
      "其他"
    ]
  };

  const FIELD_LABELS = {
    unitName: "單位名稱",
    qualification: "資格",
    leader: "負責人",
    registeredAddress: "登記地址",
    mailingAddress: "通訊地址",
    totalBudget: "總經費",
    guidelineGrant: "本要點補助金額",
    selfFund: "自籌經費",
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

  const QUALIFICATION_OPTIONS = [
    "學校、學校社團",
    "人民團體"
  ];


  // ==========================================
  // 1. 基本文字處理
  // ==========================================

  function normalizeText(text) {
    return String(text ?? "")
      .replace(/\u3000/g, " ")
      .replace(/[：﹕]/g, ":")
      .replace(/[，]/g, ",")
      .replace(/[０-９]/g, char =>
        String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
      )
      .replace(/\r\n?/g, "\n");
  }


  function cleanValue(text) {
    return normalizeText(text)
      .replace(/^[\s:：、，。；;]+/, "")
      .replace(/[\s:：]+$/, "")
      .trim();
  }


  function isEmpty(value) {
    return value === null ||
      value === undefined ||
      String(value).trim() === "";
  }


  // ==========================================
  // 2. OCR 頁面文字取得
  // ==========================================

  function getItemText(item) {
    if (typeof item === "string") {
      return item;
    }

    if (!item || typeof item !== "object") {
      return "";
    }

    return (
      item.text ??
      item.str ??
      item.value ??
      item.content ??
      ""
    );
  }


  function getItemPosition(item) {
    const box = item?.bbox || item?.boundingBox || {};

    const transform = item?.transform;

    const x =
      item?.x ??
      box.x ??
      box.left ??
      (Array.isArray(transform) ? transform[4] : 0);

    const y =
      item?.y ??
      box.y ??
      box.top ??
      (Array.isArray(transform) ? transform[5] : 0);

    return {
      x: Number(x) || 0,
      y: Number(y) || 0
    };
  }


  /**
   * 將 OCR 的文字項目依照位置組合成行。
   * 若沒有位置資訊，則保留原始順序。
   */
  function combineTextItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return "";
    }

    const normalized = items
      .map((item, index) => {
        const position = getItemPosition(item);

        return {
          text: getItemText(item),
          x: position.x,
          y: position.y,
          index
        };
      })
      .filter(item => !isEmpty(item.text));

    if (normalized.length === 0) {
      return "";
    }

    const hasPosition = normalized.some(
      item => item.x !== 0 || item.y !== 0
    );

    if (!hasPosition) {
      return normalized
        .sort((a, b) => a.index - b.index)
        .map(item => item.text)
        .join("\n");
    }

    normalized.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) {
        return b.y - a.y;
      }

      return a.x - b.x;
    });

    const lines = [];

    normalized.forEach(item => {
      let targetLine = lines.find(
        line => Math.abs(line.y - item.y) <= 3
      );

      if (!targetLine) {
        targetLine = {
          y: item.y,
          items: []
        };

        lines.push(targetLine);
      }

      targetLine.items.push(item);
    });

    return lines
      .sort((a, b) => b.y - a.y)
      .map(line => {
        return line.items
          .sort((a, b) => a.x - b.x)
          .map(item => item.text)
          .join(" ");
      })
      .join("\n");
  }


  /**
   * 取得單頁文字。
   *
   * 優先使用 importsOCR.js 已整理好的 page.text。
   * 若沒有，再依序使用其他 OCR 資料。
   */
  function getPageText(page) {
    if (!page || typeof page !== "object") {
      return "";
    }

    if (!isEmpty(page.text)) {
      return normalizeText(page.text);
    }

    const sources = [
      page.textItems,
      page.items,
      page.words
    ];

    for (const source of sources) {
      if (Array.isArray(source) && source.length > 0) {
        const text = combineTextItems(source);

        if (!isEmpty(text)) {
          return normalizeText(text);
        }
      }
    }

    return "";
  }


  /**
   * 整合所有頁面的 OCR 文字。
   */
  function collectDocumentText(document) {
    return document.pages
      .map(page => getPageText(page))
      .filter(text => !isEmpty(text))
      .join("\n");
  }


  // ==========================================
  // 3. 欄位標籤辨識
  // ==========================================

  const ALL_LABELS = [];

  Object.entries(FIELD_ALIASES).forEach(
    ([field, aliases]) => {
      aliases.forEach(alias => {
        ALL_LABELS.push({
          field,
          alias
        });
      });
    }
  );

  // 優先辨識較長的標籤，避免短標籤先匹配。
  ALL_LABELS.sort(
    (a, b) => b.alias.length - a.alias.length
  );


  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }


  /**
   * 判斷一行文字是否包含欄位標籤。
   */
  function findLabelInLine(line) {
    const normalized = cleanValue(line);

    for (const item of ALL_LABELS) {
      const regex = new RegExp(
        "^\\s*" + escapeRegExp(item.alias) +
        "\\s*[:：、]?\\s*(.*)$"
      );

      const match = normalized.match(regex);

      if (!match) {
        continue;
      }

      let value = cleanValue(match[1]);

      // 避免「其他機關補助」被誤判成「其他」。
      if (
        item.field === "otherAmount" &&
        /^機關|^單位|^補助/.test(value)
      ) {
        continue;
      }

      return {
        field: item.field,
        alias: item.alias,
        value
      };
    }

    return null;
  }


  /**
   * 取得所有文字行與其欄位標籤資訊。
   */
  function buildLineData(text) {
    return text
      .split("\n")
      .map((line, index) => {
        const normalized = cleanValue(line);

        return {
          index,
          text: normalized,
          label: findLabelInLine(normalized)
        };
      })
      .filter(line => !isEmpty(line.text));
  }


  // ==========================================
  // 4. 欄位內容擷取
  // ==========================================

  /**
   * 判斷下一行是否為另一個欄位。
   */
  function isAnotherField(line) {
    return Boolean(line?.label);
  }


  /**
   * 從欄位標籤後方取得內容。
   *
   * 如果標籤後面沒有內容，
   * 則嘗試讀取下一行。
   */
  function extractFieldValue(lines, field) {
    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];

      if (!current.label || current.label.field !== field) {
        continue;
      }

      let value = current.label.value;

      if (!isEmpty(value)) {
        return cleanValue(value);
      }

      // 標籤與內容分行的情況。
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];

        if (isAnotherField(next)) {
          break;
        }

        if (!isEmpty(next.text)) {
          return cleanValue(next.text);
        }
      }

      return "";
    }

    return "";
  }


  // ==========================================
  // 5. 跨行文字處理
  // ==========================================

  /**
   * 地址可能因為 OCR 排版而分成多行。
   *
   * 若下一行不是其他欄位標籤，
   * 則將其視為同一欄位的延續。
   */
  function extractMultilineField(lines, field) {
    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];

      if (!current.label || current.label.field !== field) {
        continue;
      }

      const values = [];

      if (!isEmpty(current.label.value)) {
        values.push(current.label.value);
      }

      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];

        if (isAnotherField(next)) {
          break;
        }

        if (!isEmpty(next.text)) {
          values.push(next.text);
        }
      }

      return cleanValue(values.join(""));
    }

    return "";
  }


  // ==========================================
  // 6. 金額處理
  // ==========================================

  /**
   * 從 OCR 文字取得金額。
   *
   * 支援：
   * 10,000
   * 10000
   * $10,000
   * 10000元
   */
  function parseAmount(value) {
    if (isEmpty(value)) {
      return null;
    }

    let text = normalizeText(value)
      .replace(/[,，]/g, "")
      .replace(/[＄$]/g, "")
      .replace(/新臺幣|新台幣|NTD|NT\$|元|圓/gi, "")
      .replace(/\s/g, "");

    // 避免把其他文字中的數字誤當成金額。
    const match = text.match(/-?\d+(?:\.\d+)?/);

    if (!match) {
      return null;
    }

    const amount = Number(match[0]);

    return Number.isFinite(amount) ? amount : null;
  }


  function extractAmount(lines, field) {
    const value = extractFieldValue(lines, field);

    return parseAmount(value);
  }


  // ==========================================
  // 7. 資格勾選辨識
  // ==========================================

  /**
   * 資格欄位目前保留兩種選項：
   *
   * 學校、學校社團
   * 人民團體
   *
   * 只有在 OCR 能確認勾選狀態時才回傳結果。
   * 無法判斷時回傳空字串，交由人工複核。
   */

  function isCheckedOption(text, option) {
    const escaped = escapeRegExp(option);

    const regex = new RegExp(
      "(☑|☒|■|✓|✔|√|☻|\\[x\\]|\\[X\\]|\\(x\\)|\\(X\\)|V)\\s*" +
      escaped +
      "|" +
      escaped +
      "\\s*(☑|☒|■|✓|✔|√|\\[x\\]|\\[X\\]|\\(x\\)|\\(X\\))"
    );

    return regex.test(text);
  }


  function isUncheckedOption(text, option) {
    const escaped = escapeRegExp(option);

    const regex = new RegExp(
      "(□|☐|\\[\\s*\\]|\\(\\s*\\))\\s*" +
      escaped +
      "|" +
      escaped +
      "\\s*(□|☐|\\[\\s*\\]|\\(\\s*\\))"
    );

    return regex.test(text);
  }


  function extractQualification(text, lines) {
    const qualificationLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (
        line.label &&
        line.label.field === "qualification"
      ) {
        qualificationLines.push(line.text);

        // 資格選項可能位於標籤的下一行。
        if (lines[i + 1]) {
          qualificationLines.push(lines[i + 1].text);
        }
      }
    }

    // 也檢查全文，因為勾選框與選項可能被 OCR 分開。
    const source = qualificationLines.length > 0
      ? qualificationLines.join("\n")
      : text;

    const checkedOptions = QUALIFICATION_OPTIONS.filter(
      option => isCheckedOption(source, option)
    );

    const uncheckedOptions = QUALIFICATION_OPTIONS.filter(
      option => isUncheckedOption(source, option)
    );

    if (
      checkedOptions.length === 1 &&
      uncheckedOptions.length >= 1
    ) {
      return checkedOptions[0];
    }

    // 多選或無法確認時，不自行判斷。
    return "";
  }


  // ==========================================
  // 8. 複核資訊
  // ==========================================

  function buildReviewItem(field, reason) {
    return {
      field,
      label: FIELD_LABELS[field],
      reason
    };
  }


  // ==========================================
  // 9. 主要解析流程
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


    // ---------- 整合 OCR 文字 ----------

    const fullText = collectDocumentText(document);

    if (isEmpty(fullText)) {
      throw new Error(
        "ApplicationOCRParser：沒有取得任何 OCR 文字。"
      );
    }

    const lines = buildLineData(fullText);


    // ---------- 建立結果 ----------

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


    // ---------- 一般文字欄位 ----------

    result.unitName = extractFieldValue(
      lines,
      "unitName"
    );

    result.leader = extractFieldValue(
      lines,
      "leader"
    );

    result.registeredAddress = extractMultilineField(
      lines,
      "registeredAddress"
    );

    result.mailingAddress = extractMultilineField(
      lines,
      "mailingAddress"
    );


    // ---------- 資格欄位 ----------

    result.qualification = extractQualification(
      fullText,
      lines
    );


    // ---------- 金額欄位 ----------

    AMOUNT_FIELDS.forEach(field => {
      result[field] = extractAmount(lines, field);
    });


    // ======================================
    // 10. 建立待複核清單
    // ======================================

    TEXT_FIELDS.forEach(field => {
      if (isEmpty(result[field])) {
        result.needsReview.push(
          buildReviewItem(
            field,
            "未能從 OCR 文字中辨識欄位內容"
          )
        );
      }
    });


    if (isEmpty(result.qualification)) {
      result.needsReview.push(
        buildReviewItem(
          "qualification",
          "無法確認資格選項的勾選狀態"
        )
      );
    }


    AMOUNT_FIELDS.forEach(field => {
      if (result[field] === null) {
        result.needsReview.push(
          buildReviewItem(
            field,
            "未能辨識金額，請人工確認"
          )
        );
      }
    });


    // ---------- 回傳 ----------

    return result;
  }


  // ==========================================
  // 對外公開 API
  // ==========================================

  global.ApplicationOCRParser = {
    parseDocument
  };

})(window);
