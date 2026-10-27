(function () {
  "use strict";

  console.log("associationData.js 已開始執行");

  const MANUAL_SEARCH_URL =
    "https://map.dosw.gov.taipei/taipeiWelfare_map/all_new/corporation_map.aspx#";

  const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxlmZdgzZj_Thxb9wDPRhaROmSIiJrl_BIhp5CmGyDkz7mUvkwQ5TrtZLP-QPxAQWd-wQ/exec";

  /**
   * 檢查人民團體名稱及登記地址
   * 從 appState.applicationData 取得輸入資料，
   * 將檢查結果存入 appState.checkResults.association。
   */
  async function checkAssociationData() {
    const appState = window.appState;

    if (!appState || !appState.applicationData) {
      throw new Error("找不到 appState.applicationData，請先載入資料模型。");
    }

    const applicationData = appState.applicationData;

    const inputName = String(
      applicationData.associationName ||
      applicationData.unitName ||
      ""
    ).trim();

    const inputAddress = String(
      applicationData.associationAddress ||
      applicationData.registeredAddress ||
      ""
    ).trim();

    const result = {
      status: "completed",
      found: false,
      name: "",
      address: "",
      nameMessage: "",
      addressMessage: "",
      manualSearchUrl: MANUAL_SEARCH_URL,
      error: null
    };

    // 沒有輸入單位名稱，不進行查詢
    if (!inputName) {
      result.status = "skipped";
      result.nameMessage = "未輸入單位名稱";
      result.addressMessage = "未進行地址比對";

      appState.checkResults.association = result;
      return result;
    }

    try {
      // 查詢人民團體名冊
      const nameResult = await checkName(inputName);

      result.found = nameResult.found;
      result.name = nameResult.name;
      result.address = nameResult.address;

      if (nameResult.error) {
        throw new Error(nameResult.error);
      }

      if (nameResult.found) {
        result.nameMessage =
          `查詢結果：${nameResult.name}，是臺北市立案之人民團體`;

        // 查詢成功後，比對登記地址
        const addressResult = checkAddress(
          inputAddress,
          nameResult.address
        );

        result.addressMessage = addressResult.message;
        result.addressMatch = addressResult.match;
        result.addressStatus = addressResult.status;

      } else {
        result.nameMessage =
          "查詢結果：未找到相符名稱，請手動搜尋人民團體名冊";

        result.addressMessage = "未進行地址比對";
        result.addressStatus = "not_checked";
      }

    } catch (error) {
      console.error("人民團體資料查詢失敗：", error);

      result.status = "error";
      result.error = error.message || String(error);
      result.nameMessage = "查詢失敗，請確認網路連線後再試";
      result.addressMessage = "未進行地址比對";
      result.addressStatus = "not_checked";
    }

    appState.checkResults.association = result;

    return result;
  }

 
/**
 * 透過 GAS Web App 查詢人民團體名冊
 * GAS 負責呼叫臺北市 API，前端不再直接呼叫臺北市 API。
 */
async function checkName(inputName) {
  const name = String(inputName || "").trim();

  if (!name) {
    return {
      found: false,
      name: "",
      address: "",
      error: null
    };
  }

  try {
    const url = GAS_API_URL + "?name=" + encodeURIComponent(name);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("GAS 請求失敗:HTTP " + response.status);
    }

    const data = await response.json();

    // GAS 本身回報查詢失敗
    if (!data.success) {
      throw new Error(data.message || "GAS 查詢失敗");
    }

    return {
      found: Boolean(data.found),
      name: data.name || "",
      address: data.address || "",
      error: null
    };

  } catch (error) {
    console.error("人民團體名冊查詢失敗:", error);

    return {
      found: false,
      name: "",
      address: "",
      error: error.message || String(error)
    };
  }
}

  /**
   * 比對申請書登記地址與名冊地址
   */
  function checkAddress(inputAddress, resultAddress) {
    const applicationAddress = String(inputAddress || "").trim();
    const registeredAddress = String(resultAddress || "").trim();

    // 申請書沒有填寫地址
    if (!applicationAddress) {
      return {
        status: "skipped",
        match: null,
        message: "未輸入登記地址"
      };
    }

    // 名冊沒有提供地址
    if (!registeredAddress) {
      return {
        status: "not_found",
        match: false,
        message: "名冊未提供地址，請手動確認"
      };
    }

    // 完全相同才判定為相符，保留原本的比對方式
    if (applicationAddress === registeredAddress) {
      return {
        status: "matched",
        match: true,
        message: "✓ 登記地址相符"
      };
    }

    return {
      status: "mismatch",
      match: false,
      message: "登記地址不相符，請手動確認"
    };
  }

  // 提供其他 JS 檔案呼叫
  window.checkAssociationData = checkAssociationData;
  window.checkName = checkName;
  window.checkAddress = checkAddress;

})();
