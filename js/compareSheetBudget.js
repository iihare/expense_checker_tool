(function () {
  "use strict";

  /**
   * 比較申請書與經費表的金額。
   */
  function compareSummary() {
    const appState = window.appState;

    if (
      !appState ||
      !appState.applicationData ||
      !appState.checkResults ||
      !appState.checkResults.expense
    ) {
      throw new Error(
        "缺少申請書或經費表檢查資料，無法進行交叉比對。"
      );
    }

    const application = appState.applicationData;
    const totals = appState.checkResults.expense.totals;

    // 避免空白或字串金額影響比較
    function toNumber(value) {
      if (value === null || value === undefined || value === "") {
        return 0;
      }

      if (typeof value === "string") {
        value = value.replace(/,/g, "").trim();
        if (value === "") return 0;
      }

      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }

    const applicationUnitName =
      String(application.unitName ?? "").trim();
    
    const expenseUnitName =
      String(appState.expenseData.unitName ?? "").trim();
    
    // 申請書金額與經費表合計的對應關係
    const comparisons = [
      {
        name: "申請單位全銜",
        applicationAmount: applicationUnitName,
        expenseAmount: expenseUnitName,
        isTextComparison: true
      },
      {
        name: "自付經費",
        applicationAmount: toNumber(application.selfFund),
        expenseAmount: toNumber(totals.selfFunded)
      },
      {
        name: "申請其他機關補助",
        applicationAmount: toNumber(application.otherAgency),
        expenseAmount: toNumber(totals.otherGrant)
      },
      {
        name: "申請本要點補助",
        applicationAmount: toNumber(application.guidelineGrant),
        expenseAmount: toNumber(totals.ourGrant)
      },
      {
        name: "計畫總經費",
        applicationAmount: toNumber(application.totalBudget),
        expenseAmount: toNumber(totals.budget)
      }
      // 預計收費
      {
        name: "預計收費",
        applicationAmount: toNumber(application.expectedFee),
        expenseAmount: toNumber(totals.expectedFee)
      },
      // 其他
      {
        name: "其他",
        applicationAmount: toNumber(application.otherAmount),
        expenseAmount: toNumber(totals.other)
      }
    ];

    const results = comparisons.map((item) => {
      const isCorrect = item.isTextComparison
        ? item.applicationAmount !== "" &&
          item.expenseAmount !== "" &&
          item.applicationAmount === item.expenseAmount
        : item.applicationAmount === item.expenseAmount;
    
      const difference = item.isTextComparison
        ? null
        : item.applicationAmount - item.expenseAmount;
    
      return {
        ...item,
        difference,
        isCorrect,
        status: isCorrect ? "passed" : "error",
        message: isCorrect
          ? "正確"
          : item.isTextComparison
            ? "單位全銜不一致或資料缺漏"
            : "金額不符"
      };
    });

    // 儲存交叉比對結果
    appState.checkResults.summary = results;

    return results;
  }

  window.compareSummary = compareSummary;
})();
