
/*
 * dataModel.js
 *
 * 共用資料模型：
 * applicationData：申請書資料
 * expenseItems：經費表資料
 * checkResults：各項檢查結果
 *
 * 請在 index.html 中先載入此檔案。
 */

(function () {
  "use strict";

  window.appState = {
    // 申請書資料：欄位 ID 已依目前的 index.html 確認
    applicationData: {
      // 基本資料
      unitName: "",
      qualification: "",
      leader: "",
      registeredAddress: "",
      mailingAddress: "",

      // 金額資料：預設為 0
      totalBudget: 0,
      guidelineGrant: 0,
      selfFund: 0,
      otherAgency: 0,
      expectedFee: 0,
      otherAmount: 0,

      // 舊檢查函式可能使用的別名
      // 實際用途仍需依檢查腳本確認
      associationName: "",
      associationAddress: ""
    },

    // 經費清單
    // 每筆資料的欄位對應原本 script.js 的 expenseRows
    expenseItems: [],

    // 檢查結果
    checkResults: {
      association: null,
      amount: null,
      expense: null,
      summary: null
    }
  };
})();
