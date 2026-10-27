(function () {
  "use strict";

  /**
   * 檢查申請書的金額總和是否正確
   * 使用 appState.applicationData 中的資料
   */
  function checkAmount() {
    const appState = window.appState;

    if (!appState || !appState.applicationData) {
      throw new Error("找不到 appState.applicationData，請先載入資料模型。");
    }

    const data = appState.applicationData;

    // B8:B12：五項金額
    // 請依照實際的 dataModel.js 欄位名稱調整
    const amounts = [
      data.guidelineGrant,
      data.otherAgency,
      data.selfFund,
      data.expectedFee,
      data.otherAmount
    ];

    const total = amounts.reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );

    // B13：申請書填寫的總金額
    // 請依照實際的 dataModel.js 欄位名稱調整
    const expected = Number(data.totalBudget || 0);

    const isCorrect = total === expected && expected !== 0;

    const result = {
      status: isCorrect ? "passed" : "error",
      isCorrect,
      total,
      expected,
      message: isCorrect
        ? "✓ 正確"
        : `✗ 不一致（計算結果：${total.toLocaleString("zh-TW")}）`
    };

    // 儲存檢查結果，供之後的結果側欄使用
    appState.checkResults.amount = result;

    return result;
  }

  window.checkAmount = checkAmount;
})();
