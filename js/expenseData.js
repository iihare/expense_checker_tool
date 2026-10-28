
(function () {
  "use strict";

  // 經費項目欄位
  const EXPENSE_FIELDS = [
    "item",
    "unitPrice",
    "quantity",
    "budget",
    "grant",
    "agency",
    "self",
    "other"
];

  // 需要提醒使用者準備的文件
  const ITEM_RULES = [
    {
      keyword: "鐘點費",
      label: "請提供講師名單、簡歷"
    },
    {
      keyword: "裁判費",
      label: "請提供裁判名單、簡歷"
    },
    {
      keyword: "住宿費",
      label: "請提供合法住宿地證明"
    }
  ];

  /**
   * 將金額轉換成數字。
   * 同時支援數字、數字字串及含千分位逗號的字串。
   */
  function toNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return 0;
    }

    if (typeof value === "string") {
      value = value.replace(/,/g, "").trim();

      if (value === "") return 0;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
  }

  /**
   * 判斷是否為整筆空白的經費資料。
   */
  function isEmptyExpenseItem(item) {
    return EXPENSE_FIELDS.every(field => {
      const value = item[field];

      return (
        value === null ||
        value === undefined ||
        value === ""
      );
    });
  }

  /**
   * 取得目前的經費資料。
   */
  function getExpenseItems() {
    const appState = window.appState;

    if (!appState || !Array.isArray(appState.expenseItems)) {
      throw new Error(
        "找不到 appState.expenseItems，請先載入經費資料。"
      );
    }

    return appState.expenseItems.filter(
      item => !isEmptyExpenseItem(item)
    );
  }

  /**
   * 檢查單價 × 數量是否等於預算金額。
   */
  function checkUnitPrice(items) {
    return items.map((item, index) => {
      const unitPrice = toNumber(item.unitPrice);
      const quantity = toNumber(item.quantity);
      const budget = toNumber(item.budget);

      const calculated = unitPrice * quantity;
      const isCorrect = calculated === budget;

      return {
        index,
        item: item.item || "",
        isCorrect,
        calculated,
        expected: budget,
        message: isCorrect
          ? "正確"
          : `金額不符（計算值：${calculated.toLocaleString("zh-TW")}）`
      };
    });
  }

  /**
   * 檢查經費來源加總是否等於預算金額。
   */
  
function checkFunding(items) {
  return items.map((item, index) => {
    const budget = toNumber(item.budget);

    const fundingTotal =
      toNumber(item.grant) +
      toNumber(item.agency) +
      toNumber(item.self) +
      toNumber(item.other);

    const isCorrect = fundingTotal === budget;

    return {
      index,
      item: item.item || "",
      isCorrect,
      calculated: fundingTotal,
      expected: budget,
      message: isCorrect
        ? "正確"
        : `金額不符（計算值：${fundingTotal.toLocaleString("zh-TW")}）`
    };
  });
}

  /**
   * 計算經費表各欄位合計。
   */
  
function calculateTotals(items) {
  return items.reduce((totals, item) => {
    totals.budget += toNumber(item.budget);
    totals.ourGrant += toNumber(item.grant);
    totals.otherGrant += toNumber(item.agency);
    totals.selfFunded += toNumber(item.self);
    totals.other += toNumber(item.other);

    return totals;
  }, {
    budget: 0,
    ourGrant: 0,
    otherGrant: 0,
    selfFunded: 0,
    other: 0
  });
}

  /**
   * 根據經費項目產生文件提醒。
   * 保留先前已勾選的狀態。
   */
  function checkItemType(items) {
    const appState = window.appState;

    if (!appState.expenseItemChecks) {
      appState.expenseItemChecks = {};
    }

    const expenseNames = items.map(item =>
      String(item.item || "")
    );

    const required = ITEM_RULES.filter(rule =>
      expenseNames.some(name => name.includes(rule.keyword))
    );

    return required.map(rule => ({
      keyword: rule.keyword,
      label: rule.label,
      checked: appState.expenseItemChecks[rule.label] === true
    }));
  }

  /**
   * 經費表檢查入口。
   * 統一執行乘算、經費來源、合計及文件提醒。
   */
  function checkBudgetData() {
    const appState = window.appState;

    if (!appState || !appState.checkResults) {
      throw new Error(
        "找不到 appState.checkResults，請先載入資料模型。"
      );
    }

    const items = getExpenseItems();

    const unitPriceResults = checkUnitPrice(items);
    const fundingResults = checkFunding(items);
    const totals = calculateTotals(items);
    const itemTypeResults = checkItemType(items);

    const result = {
      unitPrice: unitPriceResults,
      funding: fundingResults,
      totals,
      itemType: itemTypeResults
    };

    // 儲存經費表檢查結果
    appState.checkResults.expense = result;

    return result;
  }

  // 提供其他 JS 檔案呼叫
  window.checkUnitPrice = checkUnitPrice;
  window.checkFunding = checkFunding;
  window.calculateTotals = calculateTotals;
  window.checkItemType = checkItemType;
  window.checkBudgetData = checkBudgetData;
})();
