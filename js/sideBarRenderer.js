// js/summaryRenderer.js
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // 只建立文字節點，不把使用者輸入當成 HTML 執行
  function makeElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }

    return element;
  }

  function formatMoney(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return value == null ? "—" : String(value);
    }

    return number.toLocaleString("zh-TW", {
      maximumFractionDigits: 2
    });
  }

  function getStatus(result) {
    if (typeof result === "boolean") {
      return result ? "passed" : "error";
    }

    if (typeof result === "number") {
      return "warning";
    }

    if (typeof result === "string") {
      if (/不一致|金額不符|錯誤|失敗|✗|false/i.test(result)) {
        return "error";
      }

      if (/警告|待確認|需確認|查無資料|無法確認/i.test(result)) {
        return "warning";
      }

      if (/正確|相符|通過|成功|✓/i.test(result)) {
        return "passed";
      }

      return "warning";
    }

    if (!result || typeof result !== "object") {
      return "warning";
    }

    if (typeof result.isCorrect === "boolean") {
      return result.isCorrect ? "passed" : "error";
    }

    const status = String(result.status ?? "").toLowerCase();

    if (["passed", "pass", "success", "correct"].includes(status)) {
      return "passed";
    }

    if (["error", "failed", "fail", "incorrect"].includes(status)) {
      return "error";
    }

    if (["warning", "pending", "review"].includes(status)) {
      return "warning";
    }

    return getStatus(
      result.message ??
      result.result ??
      result.checkResult ??
      ""
    );
  }

  function getMessage(result, fallback = "") {
    if (typeof result === "string") {
      return result;
    }

    if (typeof result === "boolean") {
      return result ? "檢查通過。" : "檢查未通過，請確認。";
    }

    if (result && typeof result === "object") {
      return String(
        result.message ??
        result.result ??
        result.checkResult ??
        fallback ??
        "請人工確認此項目。"
      );
    }

    return fallback || "請人工確認此項目。";
  }

  // 統一清單項目的資料格式
  function normalizeResult(result, title, location, field = null) {
    return {
      id: result && typeof result === "object"
        ? result.id ?? null
        : null,
  
      field: field ?? null,
  
      status: getStatus(result),
      title:
        result && typeof result === "object"
          ? String(result.item ?? result.name ?? result.title ?? title)
          : title,
      message: getMessage(result),
      location
    };
  }

  function renderIssueCard(item) {
    const card = makeElement("article", "issue-card");
    const stripe = makeElement(
      "div",
      `issue-stripe ${item.status === "error" ? "error" : "warning"}`
    );
    const content = makeElement("div", "issue-content");
    const titleLine = makeElement("div", "issue-title-line");

    titleLine.append(
      makeElement("span", "issue-title", item.title)
    );

    content.append(titleLine);

    content.append(
      makeElement("p", "issue-message", item.message)
    );

    if (item.location) {
      content.append(
        makeElement("p", "issue-message", `檢查位置：${item.location}`)
      );
    }

    // 網站沒有試算表儲存格跳轉功能。
    // 保留原本的「前往經費表」操作，切換到網站中的經費表頁籤。
    if (item.location === "經費表") {
      const button = makeElement(
        "button",
        "issue-link",
        "前往經費表"
      );

      button.type = "button";
      button.dataset.goto = "expenses";

      button.addEventListener("click", () => {
        const target = document.querySelector(
          '[data-tab="expenses"], [data-page="expenses"]'
        );

        if (target) {
          target.click();
        }
      });

      content.append(button);
    }

    card.append(stripe, content);
    return card;
  }

  function renderIssueList(containerId, items, status) {
    const container = $(containerId);
    if (!container) return;

    container.replaceChildren();

    const filtered = items.filter(item => item.status === status);

    if (filtered.length === 0) {
      container.append(
        makeElement(
          "p",
          "demo-note",
          status === "error"
            ? "目前沒有錯誤項目。"
            : "目前沒有待確認項目。"
        )
      );
      return;
    }

    filtered.forEach(item => {
      container.append(renderIssueCard(item));
    });
  }

  function renderComparisonCard(item) {
    const card = makeElement("div", "comparison-card");

    card.append(
      makeElement("h4", "", item.name || "申請書與經費表")
    );

    const rows = [
      ["申請書金額", item.applicationAmount],
      ["經費表金額", item.expenseAmount],
      ["差額（申請書－經費表）", item.difference]
    ];

    rows.forEach(([label, value]) => {
      const row = makeElement("div", "comparison-row");

      row.append(
        makeElement("span", "", label),
        makeElement(
          "strong",
          "",
          value == null ? "—" : formatMoney(value)
        )
      );

      card.append(row);
    });

    const basis = item.basis || item.calculationBasis || "";

    card.append(
      makeElement(
        "div",
        "comparison-basis",
        basis
          ? `計算依據：${basis}`
          : item.message || "依申請書及經費表的對應金額進行比對。"
      )
    );

    return card;
  }

  function renderComparisons(summary) {
    const container = $("comparisonList");
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(summary) || summary.length === 0) {
      container.append(
        makeElement("p", "demo-note", "目前沒有可顯示的金額比對結果。")
      );
      return;
    }

    summary.forEach(item => {
      container.append(renderComparisonCard(item));
    });
  }

  // 將檢查函式的結果整理成側邊欄項目
  function collectCheckItems(results) {
    const items = [];

    function add(result, title, location, field = null) {
      if (result == null) return;

      // 單筆檢查結果
      if (!Array.isArray(result) && typeof result !== "object") {
        items.push(normalizeResult(result, title, location, field));
        return;
      }

      // 陣列：逐筆處理
      if (Array.isArray(result)) {
        result.forEach((entry, index) => {
          add(
            entry,
            entry?.item || entry?.name || `${title}（${index + 1}）`,
            location,
            field
          );
        });
        return;
      }

      // 已知的標準化結果物件
      const hasResultFields = [
        "status",
        "isCorrect",
        "message",
        "result",
        "checkResult"
      ].some(key => key in result);

      if (hasResultFields) {
        items.push(normalizeResult(result, title, location, field));
        return;
      }

      // 分類型結果物件，例如 { unitPrice: ..., funding: ... }
      Object.entries(result).forEach(([key, value]) => {
        if (
          ["totals", "total", "summary", "itemType"].includes(key) ||
          value == null
        ) {
          return;
        }

        const labelMap = {
          unitPrice: "單價 × 數量與預算金額",
          funding: "經費分配合計",
          name: "人民團體名稱",
          address: "人民團體登記地址"
        };

        add(value, labelMap[key] || `${title}－${key}`, location, field);
      });
    }

    // 人民團體檢查
    if (results.association) {
      add(results.association, "人民團體資料檢查", "申請書");
    }

    // 申請書金額檢查
    if (results.amount != null) {
      add(results.amount, "申請書經費合計", "申請書");
    }

    // 經費表檢查
    if (results.expense) {
      const expense = results.expense;

      if (expense.unitPrice != null) {
        add(
          expense.unitPrice,
          "單價 × 數量與預算金額",
          "經費表",
          "budget"
        );
      }
      
      if (expense.funding != null) {
        add(
          expense.funding,
          "經費分配合計",
          "經費表",
          "budget"
        );
      }

      // 文件提醒：需依實際 itemType 格式確認欄位
      if (Array.isArray(expense.itemType)) {
        expense.itemType.forEach(item => {
          const checked = item.checked === true ||
            item.isChecked === true;

          items.push({
            status: checked ? "passed" : "warning",
            title: item.label || item.item || "文件提醒",
            message: checked
              ? "已確認此項文件提醒。"
              : item.message || item.label || "請確認相關文件是否備妥。",
            location: "經費表"
          });
        });
      }
    }

    return items;
  }

  function renderCheckSummary() {
    const results = window.appState?.checkResults;

    if (!results) {
      clearCheckSummary();
      return;
    }

    // 有檢查結果時，才顯示側邊欄
    //document.getElementById("summaryPane")?.classList.add("visible");
    // 顯示摘要與拖曳分隔線
    $("summaryPane").classList.add("visible");
    $("splitter").classList.add("visible");
    
    const items = collectCheckItems(results);

    const comparisons = Array.isArray(results.summary)
      ? results.summary
      : results.summary?.comparisons || results.summary?.results || [];

    // 將跨頁比對納入問題數統計
    comparisons.forEach(item => {
      items.push({
        status: getStatus(item),
        title: item.name || "跨頁金額比對",
        message: item.message || "請確認申請書與經費表的金額。",
        location: "申請書與經費表"
      });
    });

    const errors = items.filter(item => item.status === "error");
    const warnings = items.filter(item => item.status === "warning");
    const passed = items.filter(item => item.status === "passed");

    renderIssueList("errorList", errors, "error");
    renderIssueList("warningList", warnings, "warning");
    renderComparisons(comparisons);

    $("issueTotal").textContent = errors.length + warnings.length;

    // 以經費表的項目名稱去重，計算受影響經費筆數
    const affectedItems = new Set(
      [...errors, ...warnings]
        .filter(item => item.location === "經費表")
        .map(item => item.title)
    );

    $("affectedCount").textContent = affectedItems.size;
    $("passedCount").textContent = passed.length;

    $("summaryStatus").textContent = "檢查完成";
  }

  function clearCheckSummary() {
    $("issueTotal").textContent = "0";
    $("affectedCount").textContent = "0";
    $("passedCount").textContent = "0";

    $("errorList").replaceChildren(
      makeElement("p", "demo-note", "尚未執行檢查。")
    );

    $("warningList").replaceChildren(
      makeElement("p", "demo-note", "尚未執行檢查。")
    );

    $("comparisonList").replaceChildren(
      makeElement("p", "demo-note", "尚未執行檢查。")
    );

    $("summaryStatus").textContent = "尚未檢查";
  }

  window.renderCheckSummary = renderCheckSummary;
  window.clearCheckSummary = clearCheckSummary;
})();
