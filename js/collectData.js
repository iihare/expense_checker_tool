
/*
 * collectData.js
 *
 * 收集申請書與經費表資料。
 *
 * 金額欄位規則：
 * - 空白 -> 0
 * - "1,000" -> 1000
 * - 無法解析的數值 -> 0
 *
 * 注意：
 * 原本 script.js 將 expenseRows 放在 IIFE 內，
 * 因此需要額外提供 window.getExpenseRows()。
 */

(function () {
  "use strict";

  // 依目前 index.html 確認的申請書欄位
  const APPLICATION_FIELD_IDS = [
    "unitName",
    "qualification",
    "leader",
    "registeredAddress",
    "mailingAddress",
    "totalBudget",
    "guidelineGrant",
    "selfFund",
    "otherAgency",
    "expectedFee",
    "otherAmount"
  ];

  // 需要轉成數字的申請書欄位
  const NUMERIC_FIELDS = new Set([
    "totalBudget",
    "guidelineGrant",
    "selfFund",
    "otherAgency",
    "expectedFee",
    "otherAmount"
  ]);

  /**
   * 將金額或數量轉成數字。
   * 空白或無效內容一律回傳 0。
   */
  function toNumberOrZero(value) {
    const raw = String(value ?? "")
      .replace(/,/g, "")
      .trim();

    if (raw === "") return 0;

    const number = Number(raw);

    return Number.isFinite(number) ? number : 0;
  }

  /**
   * 讀取 HTML 欄位。
   * 若欄位不存在，回傳空字串並提示。
   */
  function getFieldValue(id) {
    const field = document.getElementById(id);

    if (!field) {
      console.warn(
        `[collectData] 找不到 HTML 欄位：#${id}`
      );

      return "";
    }

    return String(field.value ?? "").trim();
  }

  /**
   * 收集申請書資料。
   */
  function collectApplicationData() {
    const collected = {};

    APPLICATION_FIELD_IDS.forEach((id) => {
      const value = getFieldValue(id);

      collected[id] = NUMERIC_FIELDS.has(id)
        ? toNumberOrZero(value)
        : value;
    });

    // 暫時對應舊檢查函式可能使用的欄位名稱。
    // 若舊檢查函式的欄位定義不同，再依實際程式調整。
    collected.associationName = collected.unitName;
    collected.associationAddress =
      collected.registeredAddress;

    Object.assign(
      window.appState.applicationData,
      collected
    );

    return window.appState.applicationData;
  }

  /**
   * 收集經費表資料。
   *
   * 原本的 expenseRows 存放於 script.js 的 IIFE，
   * 透過 window.getExpenseRows() 取得資料副本。
   */
  function collectExpenseData() {
    if (typeof window.getExpenseRows !== "function") {
      throw new Error(
        "[collectData] 找不到 window.getExpenseRows()。" +
        "請先在 script.js 中加入資料讀取函式。"
      );
    }

    const rows = window.getExpenseRows();

    window.appState.expenseItems = rows.map((row) => ({
      id: Number(row.id) || 0,
      item: String(row.item ?? ""),
      unitPrice: toNumberOrZero(row.unitPrice),
      quantity: toNumberOrZero(row.quantity),
      budget: toNumberOrZero(row.budget),
      grant: toNumberOrZero(row.grant),
      agency: toNumberOrZero(row.agency),
      self: toNumberOrZero(row.self),
      other: toNumberOrZero(row.other)
    }));

    return window.appState.expenseItems;
  }

  /**
   * 一次收集所有資料。
   *
   * 不論使用者先填申請書或先填經費表，
   * 按下「開始檢查」時都會重新收集兩邊的最新資料。
   */
  function collectAllData() {
    collectApplicationData();
    collectExpenseData();

    return window.appState;
  }

  // 提供給主程式及檢查腳本呼叫
  window.collectApplicationData = collectApplicationData;
  window.collectExpenseData = collectExpenseData;
  window.collectAllData = collectAllData;
  window.toNumberOrZero = toNumberOrZero;
})();
